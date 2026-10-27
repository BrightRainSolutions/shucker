// Renders the app icons and favicon from the Shucker logo PNG (square, 1024px+).
// Run: npm run icons            (uses src/assets/shucker.png)
//      npm run icons -- other.png
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const src = process.argv[2] || fileURLToPath(new URL('../src/assets/shucker.png', import.meta.url))
const logo = sharp(src)
const { width, height } = await logo.metadata()
if (width !== height) console.warn(`warning: logo is ${width}x${height}, not square; it will be letterboxed`)

// Pad and flatten with the average color of the logo's top and left edges (the knife runs off the right and bottom).
const edge = Math.max(4, Math.round(width * 0.03))
const strips = [
  { left: 0, top: 0, width, height: edge },
  { left: 0, top: 0, width: edge, height },
]
// stats() reads the input, not the pipeline, so extract to a buffer first.
const stripMean = async (r) => (await sharp(await sharp(src).extract(r).toBuffer()).stats()).channels.slice(0, 3).map((c) => c.mean)
const means = await Promise.all(strips.map(stripMean))
const [r, g, b] = [0, 1, 2].map((i) => Math.round(means.reduce((sum, m) => sum + m[i], 0) / means.length))
const bg = { r, g, b }

const pub = (file) => fileURLToPath(new URL(`../public/${file}`, import.meta.url))

// scale < 1 shrinks the logo inside the tile (maskable safe zone); opaque for iOS, which blackens transparency.
const out = async (file, size, { scale = 1, opaque = false } = {}) => {
  const inner = Math.round(size * scale)
  let img = sharp(src).resize(inner, inner, { fit: 'contain', background: { ...bg, alpha: opaque ? 1 : 0 } })
  if (scale < 1) {
    const pad = Math.floor((size - inner) / 2)
    img = sharp(await img.png().toBuffer()).extend({ top: pad, left: pad, bottom: size - inner - pad, right: size - inner - pad, background: { ...bg, alpha: 1 } })
  }
  if (opaque) img = img.flatten({ background: bg })
  // Palette PNGs keep the painted icons small enough to precache.
  await img.png({ palette: true, quality: 90, effort: 10 }).toFile(pub(file))
  console.log('wrote', file)
}

await out('favicon.png', 64)
await out('pwa-192.png', 192)
await out('pwa-512.png', 512)
await out('pwa-maskable-512.png', 512, { scale: 0.8, opaque: true })
await out('apple-touch-icon.png', 180, { opaque: true })
