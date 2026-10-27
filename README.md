# Shucker

A private family PWA to log Oyster Dates, rate each oyster separately, keep The Photo, and map where the oysters came from. See [SPEC.md](SPEC.md).

Vue 3 + Vite, Supabase (Postgres/PostGIS, Auth, Storage), MapLibre on OpenFreeMap, offline write queue in IndexedDB.

## Local dev

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## Supabase setup (one time)

1. Create a free project. Note the project ref and database password.
2. Link and push the schema plus the seed data:
   ```bash
   npx supabase login            # personal access token
   npx supabase link --project-ref <ref>
   npx supabase db push --include-seed
   ```
3. Auth → Providers → Email: turn **off** "Allow new users to sign up".
4. Auth → Users → "Add user" for each family member (auto-confirm). Signups stay off; adding someone later is the same two steps. Then in the SQL editor, one row per person with a distinct color:
   ```sql
   insert into public.profiles (id, display_name, color) values
     ('<user-uuid>',       '<Name>', '#ff6b5a'),
     ('<user-uuid>',       '<Name>', '#2bb3a3'),
     ...;
   ```
   Colors that read well together: `#ff6b5a` `#2bb3a3` `#f2a91e` `#7a5cff` `#3f7a52` `#e05297` `#1d74a8` `#a8642a`.

Schema changes go in `supabase/migrations/` and are applied with `npx supabase db push`. Never change the schema only through the dashboard.

## Deploy (Netlify)

Connect the repo, build `npm run build`, publish `dist` (already in `netlify.toml`, including the SPA redirect). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify's environment variables, with scopes including Builds and Functions (the default), since the keep-alive function reads them too.

On each iPhone: open the site in Safari → Share → Add to Home Screen.

## Keep-alive

Free Supabase projects pause after about a week of quiet. `netlify/functions/keepalive.mjs` is a Netlify Scheduled Function that reads the anon-readable `keepalive` table once a day. It reuses the site's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, so there's nothing else to configure. Check it under Netlify → Logs → Functions → keepalive, where "Run now" triggers it by hand. Scheduled functions only run on the published production deploy.

## How offline works

- Every write goes through `src/composables/useQueue.js`, persisted in IndexedDB, flushed FIFO on `online`, focus, and a 15s timer while anything is pending.
- Ids are generated on the phone, so children can point at parents that only exist locally.
- Visits, tastings and new oysters are created via `find_or_create_*` RPCs. If the server already has one (the other phone got there first), the server id comes back and the local id is rewritten on every queued item.
- Local writes also live as "shadow" records (`src/lib/data.js`) merged over server data until they sync, so everything shows up immediately.
- Photos are resized on the phone (1600px + 400px thumb), kept in IndexedDB, shown from the local blob, then uploaded to the private `photos` bucket.

## Icons

Drop the square logo (1024px+) at `src/assets/shucker.png`, then `npm run icons` re-renders the favicon and all PWA/iOS icons from it.
