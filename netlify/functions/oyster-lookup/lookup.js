// Looks up one oyster with Claude + web search. Shared by the background
// function and scripts/try-lookup.mjs: pass in an Anthropic client and the
// text of domain.md.
//
// Pass 1 searches only oysterater.com; pass 2 (only if pass 1 found nothing)
// searches the open web. Claude ends each pass by calling record_oyster, whose
// strict schema guarantees the shape. Nothing here writes to the database.

export const MODEL = 'claude-opus-5-5'

const str = { type: ['string', 'null'] }
const num = { type: ['number', 'null'] }
const oneOf = (values) => ({ anyOf: [{ type: 'string', enum: values }, { type: 'null' }] })

const RECORD_OYSTER = {
  name: 'record_oyster',
  description: 'Record what you found about the oyster. Call exactly once, when you are done searching.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'found', 'canonical_name', 'grower', 'growing_area', 'region', 'country', 'species', 'cultivation',
      'lat', 'lng', 'oysterater_url', 'fact', 'fact_url', 'source_url', 'confidence',
    ],
    properties: {
      found: { type: 'boolean' },
      canonical_name: str,
      grower: str,
      growing_area: str,
      region: str,
      country: str,
      species: oneOf(['pacific', 'atlantic', 'kumamoto', 'olympia', 'european_flat']),
      cultivation: oneOf(['beach', 'tumbled', 'suspended', 'bottom']),
      lat: num,
      lng: num,
      oysterater_url: str,
      fact: str,
      fact_url: str,
      source_url: str,
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  },
}

const searchTool = (domains) => ({
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: domains ? 3 : 5,
  ...(domains ? { allowed_domains: domains } : {}),
})

async function pass(client, domain, name, domains) {
  const where = domains ? 'Search only Oysterater for this pass.' : 'Oysterater had nothing; search the open web.'
  const messages = [{ role: 'user', content: `Oyster name as typed: ${JSON.stringify(name)}\n\n${where}` }]
  const usage = { input: 0, output: 0, cache_read: 0, searches: 0 }

  for (let turn = 0; turn < 6; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: domain, cache_control: { type: 'ephemeral' } }],
      tools: [searchTool(domains), RECORD_OYSTER],
      messages,
    })
    usage.input += res.usage.input_tokens
    usage.output += res.usage.output_tokens
    usage.cache_read += res.usage.cache_read_input_tokens || 0
    usage.searches += res.usage.server_tool_use?.web_search_requests || 0

    const call = res.content.find((b) => b.type === 'tool_use' && b.name === 'record_oyster')
    if (call) return { result: call.input, usage }
    if (res.stop_reason === 'refusal') return { result: null, usage, error: 'refused' }

    messages.push({ role: 'assistant', content: res.content })
    // pause_turn: the server resumes its search loop when we re-send as is.
    // end_turn without the call: auto tool choice doesn't guarantee one, so ask.
    if (res.stop_reason !== 'pause_turn') {
      messages.push({ role: 'user', content: 'Call record_oyster now with what you found.' })
    }
  }
  return { result: null, usage, error: 'no record_oyster call' }
}

const trustworthy = (r) => r && r.found && r.confidence !== 'low'

// Returns { result, usage, passes, error }. result is record_oyster's input
// (validated), or null when nothing usable was found.
export async function lookupOyster(client, domain, name) {
  const first = await pass(client, domain, name, ['oysterater.com'])
  let { result, usage, error } = first
  let passes = 1
  if (!trustworthy(result) && !error) {
    const second = await pass(client, domain, name, null)
    passes = 2
    for (const k of Object.keys(usage)) usage[k] += second.usage[k]
    ;({ result, error } = second)
  }
  return { result: trustworthy(result) ? clean(result) : null, raw: result, usage, passes, error }
}

// What the schema can't express: ranges, and URLs that must point where they claim.
function clean(r) {
  const out = { ...r }
  const okCoord = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim
  if (!okCoord(out.lat, 90) || !okCoord(out.lng, 180)) out.lat = out.lng = null
  const isUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u)
  if (!isUrl(out.oysterater_url) || !/^https?:\/\/(www\.)?oysterater\.com\/oyster\//.test(out.oysterater_url)) out.oysterater_url = null
  for (const k of ['fact_url', 'source_url']) if (!isUrl(out[k])) out[k] = null
  if (!out.fact_url) out.fact = null
  for (const k of Object.keys(out)) if (typeof out[k] === 'string' && !out[k].trim()) out[k] = null
  return out
}
