// One-off for the move to Neon: recreates the family's logins. Run it yourself
// so passwords stay out of logs and chat. Names and emails come from the
// gitignored Supabase backup; passwords are typed here, hidden, and go straight
// to Neon Auth.
//   node --env-file=.env scripts/create-neon-users.mjs
import { readFileSync } from 'node:fs'
import readline from 'node:readline'

const BACKUP = 'backups/supabase-2026-11-04'
const read = (f) => JSON.parse(readFileSync(`${BACKUP}/${f}`, 'utf8'))
const emails = new Map(read('auth-users.json').map((u) => [u.id, u.email]))
const people = read('tables/profiles.json').map((p) => ({ name: p.display_name, email: emails.get(p.id) }))

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
    rl._writeToOutput = (s) => {
      if (s.startsWith(prompt)) rl.output.write(prompt)
    }
  })
}

for (const { name, email } of people) {
  for (;;) {
    const password = await askHidden(`Password for ${name} (${email}), typing is hidden: `)
    const res = await fetch(`${process.env.NEON_AUTH_BASE_URL}/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ name, email, password }),
    })
    if (res.ok) {
      console.log(`  created ${name}`)
      break
    }
    const body = await res.json().catch(() => ({}))
    console.log(`  not created: ${body.message || body.code || res.status}`)
    if (body.code === 'USER_ALREADY_EXISTS' || body.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') break
  }
}
console.log('Done. Tell Claude "done".')
