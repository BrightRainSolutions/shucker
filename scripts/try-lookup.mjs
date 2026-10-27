// Tries the oyster lookup locally without touching the database.
// Needs ANTHROPIC_API_KEY in .env. Run: node --env-file=.env scripts/try-lookup.mjs "Barron Point" "Kushi"
import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { lookupOyster } from '../netlify/functions/oyster-lookup/lookup.js'

const domain = await readFile(new URL('../netlify/functions/oyster-lookup/domain.md', import.meta.url), 'utf8')
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

for (const name of process.argv.slice(2)) {
  const t = Date.now()
  const { result, raw, usage, passes, error } = await lookupOyster(client, domain, name)
  console.log(`\n=== ${name}  (${((Date.now() - t) / 1000).toFixed(1)}s, ${passes} pass, ${JSON.stringify(usage)})`)
  if (error) console.log('error:', error)
  console.log(JSON.stringify(result ?? { saved: false, raw }, null, 2))
}
