# Shucker

A private family PWA to log Oyster Dates, rate each oyster separately, keep The Photo, and map where the oysters came from. See [SPEC.md](SPEC.md).

Vue 3 + Vite, Neon (Postgres/PostGIS, Neon Auth, Data API), MapLibre on OpenFreeMap, offline write queue in IndexedDB.

## Local dev

```bash
npm install
cp .env.example .env   # fill in the Neon URLs
npm run dev
```

## Neon setup (one time)

1. Create a Neon project with Auth, then enable the Data API with **Use Neon Auth** on and **Grant public schema access** off.
2. Apply `db/neon_baseline.sql`, then `db/seed.sql`, to the `DATABASE_URL` connection.
3. Add every site domain under Neon Auth's trusted origins.
4. Create the logins (see below), then turn off email sign-ups. **Also turn off Google sign-in, which Neon enables by default.** Any signed-in user can read the family's data, so nobody else should be able to get an account.

Schema changes are new SQL files in `db/`. Never change the schema only through the console.

## Adding a family member

The console's Add user creates someone with no password, so they could never sign in. Instead:

1. Turn email sign-ups on in Neon Auth.
2. Run this, which asks for the password with hidden typing (8 characters minimum):
   ```bash
   node --env-file=.env scripts/create-neon-users.mjs "Name" name@example.com
   ```
3. Turn email sign-ups back off.
4. Add their profile in Neon's SQL Editor. They can't save anything without one:
   ```sql
   insert into public.profiles (id, display_name, color)
   select id, '<Name>', '<#hex color>' from neon_auth."user" where email = 'name@example.com';
   ```

Family colors should be distinct, bold, and readable with white text on them.

## How sign-in works

The app signs in through Neon Auth and sends its short-lived token with each Data API request. Postgres runs the query as the `authenticated` role, and `auth.uid()` reads the user id from the token for the RLS policies. Logins live in the `neon_auth` schema of the same database. Sessions last about 7 days.

Neon Auth keeps the session in a cookie on its own domain. That works in iPhone Safari and installed home-screen apps as tested in 2026-11; if sign-ins ever stop sticking on iPhones, first try proxying the auth URL through the site's own domain with a Netlify rewrite.

## Deploy (Netlify)

Connect the repo, build `npm run build`, publish `dist` (already in `netlify.toml`, including the SPA redirect). Set `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL` in Netlify's environment variables, with scopes including Builds and Functions (the default), since the oyster-lookup function reads them too. Also set `ANTHROPIC_API_KEY` (secret) for the oyster lookup; without it in the Deploy Previews context, lookups fail on previews. Never give it a `VITE_` prefix: those are compiled into the app.

On each iPhone: open the site in Safari → Share → Add to Home Screen.

Pushing to `main` deploys. A pull request gets a Deploy Preview at `deploy-preview-<number>--shuckers.netlify.app`, which uses the same production database, so add that URL to Neon Auth's trusted origins to sign in there, and remember that what you do on a preview is real.

## How offline works

- Every write goes through `src/composables/useQueue.js`, persisted in IndexedDB, flushed FIFO on `online`, focus, and a 15s timer while anything is pending.
- Ids are generated on the phone, so children can point at parents that only exist locally.
- Visits, tastings and new oysters are created via `find_or_create_*` RPCs. If the server already has one (the other phone got there first), the server id comes back and the local id is rewritten on every queued item.
- Local writes also live as "shadow" records (`src/lib/data.js`) merged over server data until they sync, so everything shows up immediately.
- Photos are resized on the phone (1600px + 400px thumb), kept in IndexedDB, shown from the local blob, then uploaded to the `photo_files` table. Phones keep every image they've seen, which saves on transfer, so viewed photos also work offline.

## Backups

Neon's free plan keeps about 6 hours of history. Photos are in the database, so `pg_dump` of `DATABASE_URL` captures everything, logins included. Keep any dump out of the repo: this repo is public, and `backups/` is git-ignored.

## Icons

Drop the square logo (1024px+) at `src/assets/shucker.png`, then `npm run icons` re-renders the favicon and all PWA/iOS icons from it.
