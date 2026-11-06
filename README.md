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
2. Apply `db/neon_baseline.sql` to the `DATABASE_URL` connection.
3. Add the site's domains under Neon Auth's trusted origins.
4. Create logins by calling the auth API, not with the console's Add user, which sets no password: `node --env-file=.env scripts/create-neon-users.mjs`. Then turn sign-ups off.
5. Add one `profiles` row per person, using their `neon_auth."user"` id and a distinct color.

Schema changes are new SQL files in `db/`. Never change the schema only through the console.

## Deploy (Netlify)

Connect the repo, build `npm run build`, publish `dist` (already in `netlify.toml`, including the SPA redirect). Set `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL` in Netlify's environment variables, with scopes including Builds and Functions (the default), since the oyster-lookup function reads them too. Also set `ANTHROPIC_API_KEY` (secret; Production context is enough) for the oyster lookup. Never give it a `VITE_` prefix: those are compiled into the app.

On each iPhone: open the site in Safari → Share → Add to Home Screen.

## How offline works

- Every write goes through `src/composables/useQueue.js`, persisted in IndexedDB, flushed FIFO on `online`, focus, and a 15s timer while anything is pending.
- Ids are generated on the phone, so children can point at parents that only exist locally.
- Visits, tastings and new oysters are created via `find_or_create_*` RPCs. If the server already has one (the other phone got there first), the server id comes back and the local id is rewritten on every queued item.
- Local writes also live as "shadow" records (`src/lib/data.js`) merged over server data until they sync, so everything shows up immediately.
- Photos are resized on the phone (1600px + 400px thumb), kept in IndexedDB, shown from the local blob, then uploaded to the `photo_files` table. The phone keeps its copy.

## Icons

Drop the square logo (1024px+) at `src/assets/shucker.png`, then `npm run icons` re-renders the favicon and all PWA/iOS icons from it.
