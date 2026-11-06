// Creates a login through Neon Auth's sign-up API. Run it yourself so passwords
// stay out of logs and chat: they're typed here, hidden, and go straight to
// Neon Auth. Email sign-ups must be on while it runs.
//   node --env-file=.env scripts/create-neon-users.mjs "Name" name@example.com
import readline from 'node:readline'

const [name, email] = process.argv.slice(2)
if (!name || !email) {
  console.log('Usage: node --env-file=.env scripts/create-neon-users.mjs "Name" name@example.com')
  process.exit(1)
}

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
  if (body.code !== 'PASSWORD_TOO_SHORT') break
}
