import { get, set } from 'idb-keyval'
import { db } from './db'

const FULL = 1600
const THUMB = 400

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Older Safari: fall back to an <img>, which also honors EXIF orientation.
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

function resize(source, longEdge) {
  const w = source.width
  const h = source.height
  const scale = Math.min(1, longEdge / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.8),
  )
}

export async function processPhoto(file) {
  let bmp
  try {
    bmp = await decode(file)
  } catch (e) {
    // Typically an iPhone HEIC picked on a desktop browser that can't decode it.
    throw Object.assign(new Error('Could not decode image'), {
      cause: e,
      userMessage: "Couldn't open that photo. If it's a HEIC from an iPhone, add it from the phone or use a JPEG.",
    })
  }
  const full = await resize(bmp, FULL)
  const thumb = await resize(bmp, THUMB)
  bmp.close?.()
  return { full, thumb }
}

const key = (id, kind) => `oc:photo:${id}:${kind}`
export const saveLocalPhoto = (id, { full, thumb }) => Promise.all([set(key(id, 'full'), full), set(key(id, 'thumb'), thumb)])
export const getLocalPhoto = (id, kind) => get(key(id, kind))

// Object URLs for local blobs, kept for the life of the page.
const objectUrls = new Map()
export async function localPhotoUrl(id, kind) {
  const k = key(id, kind)
  if (objectUrls.has(k)) return objectUrls.get(k)
  const blob = await get(k)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  objectUrls.set(k, url)
  return url
}

// Postgres bytea travels through the Data API as "\\x" + hex.
export async function blobToHex(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let hex = '\\x'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

function hexToBlob(hex) {
  const bytes = new Uint8Array((hex.length - 2) / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2 + 2, 2), 16)
  return new Blob([bytes], { type: 'image/jpeg' })
}

// A photo from this device if we have it, otherwise from the database, keeping
// a copy here so it isn't downloaded again. Kept copies also save on transfer.
const fetching = new Map()
export async function photoUrl(id, kind) {
  const local = await localPhotoUrl(id, kind)
  if (local) return local
  const k = key(id, kind)
  if (!fetching.has(k)) {
    fetching.set(k, downloadPhoto(id, kind).finally(() => fetching.delete(k)))
  }
  return fetching.get(k)
}

async function downloadPhoto(id, kind) {
  const column = `${kind}_jpeg`
  const { data, error } = await db.from('photo_files').select(column).eq('photo_id', id).maybeSingle()
  if (error || !data?.[column]) return null
  const blob = hexToBlob(data[column])
  const k = key(id, kind)
  await set(k, blob).catch(() => {}) // showing it matters more than keeping it
  const url = URL.createObjectURL(blob)
  objectUrls.set(k, url)
  return url
}
