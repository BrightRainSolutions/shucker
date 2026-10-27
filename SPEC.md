# Shucker: Build Spec (MVP)

A private family PWA (any number of family members) to log oyster dates, rate each oyster separately, keep The Photo, and map where the oysters came from and where we ate them.

Family members only, accounts added by hand. Everyone sees all visits. No public access. iPhone home-screen install is the primary target; desktop browser should also work.

---

## 1. Stack

| Piece | Choice | Notes |
|---|---|---|
| Frontend | Vue 3 + Vite, Vue Router | Composition API, `<script setup>`. No Pinia or Vuex: shared state (auth session, profiles, offline queue status) lives in plain composables with module-level `ref`/`reactive` (e.g. `useAuth()`, `useQueue()`). |
| PWA | `vite-plugin-pwa` (Workbox) | Installable, app shell cached, offline queue (see 7) |
| Backend | Supabase (free tier) | Postgres + PostGIS, Auth, Storage, `@supabase/supabase-js` v2 client. No custom server code. |
| Map | MapLibre GL JS | Basemap: OpenFreeMap Liberty style (`https://tiles.openfreemap.org/styles/liberty`). Do NOT use the default OSM raster tiles. |
| Geocoding | Nominatim (OSM) | Search-to-fly only. Max 1 request/sec, debounce input, show OSM attribution. |
| Local storage | `idb-keyval` | Offline queue for photos and pending writes |
| Hosting | Netlify (static) | SPA redirect: `/* /index.html 200` |
| Repo | `BrightRainSolutions/shucker` | Public (Netlify's free plan won't build private org repos). No secrets in the repo. |

Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The anon key is safe in the client because RLS does the gating. `ANTHROPIC_API_KEY` (Netlify only, secret, never `VITE_`-prefixed) for the oyster lookup (see 6).

---

## 2. Vocabulary

- **Oyster Date** (UI) = `visits` (DB). One trip to one place on one day.
- **Tasting** = one oyster type eaten on one Oyster Date. Shared fact.
- **Rating** = one person's opinion of one tasting. At most one per person per tasting. Ratings are per night on purpose: the same oyster can score differently depending on what else was on the plate. "Your last/latest" is a display of the most recent one, not a single stored rating.
- **The Photo** = the visit's cover photo (the presentation shot). Required in spirit, skippable in practice.

---

## 3. Data model

Enable the `postgis` extension. All ids are `uuid` with `default gen_random_uuid()`, but the client generates ids itself (`crypto.randomUUID()`) so records created offline keep stable ids.

Locations are stored as plain `lat`/`lng` numeric columns (easy for the JS client to write) with a PostGIS generated column alongside for spatial queries:

```sql
location geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored
```

### profiles
| column | type | notes |
|---|---|---|
| id | uuid PK | = `auth.users.id` |
| display_name | text | |
| color | text | hex; used for this person's scores in charts and lists |

### oysters (catalog)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | e.g. "Kusshi", "Hama Hama" |
| grower | text | |
| growing_area | text | e.g. "Hood Canal", "Duxbury Bay" |
| region | text | e.g. "Puget Sound", "Cape Cod" |
| country | text | default 'USA' |
| species | enum `oyster_species` | `pacific`, `atlantic`, `kumamoto`, `olympia`, `european_flat` |
| cultivation | text | optional: beach, tumbled, suspended, bottom |
| lat, lng | numeric(9,6) | nullable. Null = "needs a pin" |
| location | geography | generated, see above |
| location_approx | boolean | default true for seeded rows |
| oysterater_url | text | optional link out |
| notes | text | |
| created_by | uuid → profiles | |
| created_at | timestamptz | default now() |

Unique on `(lower(name), coalesce(grower, ''))`.

### places
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | |
| city | text | |
| address | text | |
| url | text | |
| lat, lng | numeric(9,6) | |
| location | geography | generated |
| created_by, created_at | | |

### visits (Oyster Dates)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| place_id | uuid → places | nullable = a home night |
| visited_on | date not null | default current_date (client sends local date, not UTC) |
| notes | text | |
| cover_photo_id | uuid → photos | nullable, `on delete set null` |
| created_by, created_at | | |

`unique nulls not distinct (place_id, visited_on)`. This is what makes "New Oyster Date" a find-or-create.

### tastings
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| visit_id | uuid → visits | `on delete cascade` |
| oyster_id | uuid → oysters | |
| price_each | numeric(6,2) | optional |
| created_by, created_at | | |

`unique (visit_id, oyster_id)`. If two people add the Kusshi, it's one tasting.

### ratings
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| tasting_id | uuid → tastings | `on delete cascade` |
| user_id | uuid → profiles | default `auth.uid()` |
| overall | smallint | 1 to 5 |
| brininess | smallint | 1 to 5, nullable |
| smell_of_the_sea | smallint | 1 to 5, nullable |
| sweetness | smallint | 1 to 5, nullable |
| creaminess | smallint | 1 to 5, nullable (labeled "Butteriness" in the UI) |
| minerality | smallint | 1 to 5, nullable |
| brightness | smallint | 1 to 5, nullable |
| texture | smallint | 1 to 5, nullable |
| size | smallint | 1 to 5, nullable |
| would_order_again | boolean | |
| note | text | |
| updated_at | timestamptz | |

`unique (tasting_id, user_id)`. Check constraints `between 1 and 5` on every score column.

### photos
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| visit_id | uuid → visits | not null, `on delete cascade` |
| tasting_id | uuid → tastings | nullable; set when the photo is a close-up of one oyster |
| storage_path | text | full image |
| thumb_path | text | ~400px thumbnail |
| taken_by | uuid → profiles | |
| created_at | timestamptz | |

### Views
- **`oyster_stats`**: per oyster per person: `avg_overall`, `tasting_count`, `last_tasted`, `would_order_again_pct`. Plus a combined row (or a second view `oyster_stats_combined`). Drives map colors and oyster detail.
- **`visit_summary`**: visit + place name + cover photo thumb path + tasting count + each rater's avg overall for that night. Drives the Oyster Dates list.

### Attribute definitions (UI labels)
Slider endpoints, low to high. Keep the copy playful.

| attribute | 1 | 5 |
|---|---|---|
| Overall | meh | marry it |
| Brininess | pond | ocean spray |
| Smell of the Sea | tap water | Hood Canal at low tide |
| Sweetness | none | candy |
| Butteriness (column `creaminess`) | lean | butter |
| Minerality | none | licking a penny |
| Brightness | flat | squeeze of lemon |
| Texture | soft | crunchy |
| Size | petite | whopper |

### Schema management
- Supabase CLI migrations are the source of truth: SQL files in `supabase/migrations/`, applied with `supabase db push` against the linked project. Seed data in `supabase/seed.sql`.
- Never change schema only through the dashboard or MCP. If a change is made that way for debugging, capture it as a migration before committing.
- The Supabase MCP server, if configured, runs read-only and scoped to this project; use it for inspection and debugging.
- The project owner provides the project ref, database password, and a personal access token.

---

## 4. Auth and security

- Supabase Auth, email + password only (no magic links: Supabase's built-in mailer only emails org members, and iOS home-screen apps don't share Safari's session). **Signups disabled** in the dashboard. The project owner creates each family member's account by hand and inserts their `profiles` row (distinct color per person).
- RLS on every table:
  - `oysters`, `places`, `visits`, `tastings`, `photos`: any authenticated user can select, insert, update. Delete only by `created_by`.
  - `ratings`: any authenticated user can select. Insert, update, delete only where `user_id = auth.uid()`.
- Storage bucket `photos`: **private**. Authenticated users can read and write. Display via `createSignedUrl` (cache signed URLs in memory for their lifetime). Do not rely on Supabase image transformations (paid tier only); thumbnails are generated client-side.

---

## 5. Screens and flows

### Landing
Two big buttons, nothing else (plus a small profile/sign-out affordance):
- **Add Oyster Date** → becomes **Join Tonight at {place}** if a visit already exists for today. Tapping it goes straight into that visit.
- **See Oyster Dates**

### Add Oyster Date (stepper, 4 steps)
1. **Where and when.** Place combobox: existing places, sorted nearest-first if geolocation is granted, else most recent. Last option: **+ Add place** (inline form: name, city, pin defaults to current location, editable on a small map). Date defaults to today. Also a "Home" toggle that clears place. On continue: upsert visit on `(place_id, visited_on)` and use whatever id comes back.
2. **The Photo.** Big "Add The Photo" button (`<input type="file" accept="image/*">`, deliberately no `capture`, so phones offer camera or photo library: the shot may already be taken). Show the photo immediately from the local blob. Skippable. Becomes `cover_photo_id`.
3. **What we ate.** Oyster combobox (search by name, grower, growing area), multi-add as chips. It stays focused after each pick, so a whole tray goes in by typing names in a row. A near miss ("Kushi") is offered as "Did you mean Kusshi" and Enter picks it, to avoid duplicates. Last option: **+ Add "<name>"** adds the oyster by name alone, with no form; the rest is looked up in the background (see 6), and the chip says "looking it up…" until it lands. Each chip creates a tasting (upsert on `visit_id, oyster_id`). Optional price per tasting.
4. **Rate.** One card per tasting. Overall (big, 1 to 5 shell icons) and Would Order Again (toggle) up top. The other eight attributes always visible as 1–5 sliders with tick marks. An unrated slider parks a hollow knob in the middle on a grey track with a "Not rated" tag, so it can't be mistaken for a 3. The first deliberate touch sets it (a tap on the parked knob means 3; vertical scrolling never sets a score), and the live word beside the value tracks the end labels ("leaning ocean spray"). An × clears it. Untouched means no score is saved; no prompts about unrated attributes. If you've rated this oyster on another night and tonight's card is still blank, show "Your last: 5 · Oct 13" with a **Start from it** button that copies those scores and Would Order Again (not the note). Never applied automatically. Note field. Small camera button per card for a close-up photo (`tasting_id` set). If other family members have already rated, show each one's overall as a small badge in their color, but not their full scores until you've saved yours (no anchoring).

Everything autosaves. No final Submit button.

### See Oyster Dates (List / Map toggle)
- **List:** photo cards, newest first. Thumbnail, place, date, number of oysters, each rater's average overall in their colors.
- **Map:** MapLibre, two toggleable layers:
  - **Origins:** oysters with a pin. Circle color by combined `avg_overall` (sequential ramp), size by tasting count. Tap → oyster detail.
  - **Places:** where we've eaten. Distinct symbol. Tap → list of visits there.
  - Fit bounds to data on load. Keep it crisp and modern; no default OSM look.

### Visit detail
The Photo full width. Place, date, notes. Each tasting: oyster name and growing area, one row per person who rated, in their profile color, with grouped bars per attribute (one bar per rater), Would Order Again for each, notes, close-up photos. Add another oyster or photo from here. Each oyster you haven't rated that night shows "You haven't rated it tonight · Your last: 5 · Oct 13" and a Rate button that opens that card.

### Oyster detail
Name, grower, growing area, species, Oysterater link (the saved page if set, otherwise an Oysterater search for the name). Mini map of origin (or "Needs a pin" button). Averages per person who has rated it, across all tastings (grouped bars, one per person). "Your latest: 5 · Oct 13" near the top. Every time we've had it: date, place, each rater's overall, thumbnail; nights you haven't rated get a Rate button (no edit buttons; true errors are fixed in the backend).

### Pin picker (oyster origin)
Full-screen MapLibre view with a draggable marker. Tap to drop, drag to adjust. Search box flies to a Nominatim result (debounced, 1 req/sec, attribution shown). **Growing area reuse:** if the oyster's `growing_area` matches another oyster that already has a pin, offer "Use the Hood Canal pin" as a one-tap option. Saving sets `location_approx = false`.

---

## 6. Oyster lookup and origin locations

- A new oyster is saved with its name only and `lookup_status = 'pending'`. Whenever an oyster reaches the server, the phone POSTs its id to `netlify/functions/oyster-lookup`, a Netlify Background Function (202 at once, runs up to 15 min), with the signed-in person's Supabase token. Every database call in the function runs as that person, so RLS applies.
- The function claims the oyster (`claim_oyster_lookup`: only one lookup at a time; a run stuck for 5 minutes is retried), then asks Claude (`claude-opus-5-5`) with web search: first limited to oysterater.com, then the open web if that finds nothing trustworthy. Claude ends by calling a strict `record_oyster` tool, so the answer always has the same shape. The rules it follows are in `netlify/functions/oyster-lookup/domain.md`.
- `finish_oyster_lookup` fills **only empty fields** (country excepted, since it defaults to USA), fixes the name's case when it only differs in case, sets a pin only if there is none (`location_approx` stays true), stores the Shucker fact with its source, and flags the oyster `needs_review`. Low-confidence answers aren't saved. Names that cover many farms (Kumamoto) get only what's true of all of them.
- Failed lookups are not retried automatically, so a persistent error can't keep spending; the oyster page has **Try again**. Facts and links only: no descriptions or reviews are copied from any source.
- **Shucker fact**: one sourced sentence, shown on the rating card and the oyster page.
- Oyster detail shows "Looked up automatically from <site>. Look right?" with **Looks right** (clears the flag) and **Not this oyster** (clears the looked-up fields).

- Location is **optional** when adding an oyster at the table. Unpinned oysters get a "Needs a pin" badge in lists and on oyster detail.
- A small "To check (3)" link on the Oyster Dates screen goes to couch-time homework: looked-up details to confirm, oysters the lookup couldn't find, and oysters that need a pin.

---

## 7. Photos and offline

Oyster bars have bad signal. Writes must not fail just because the network is gone.

**Photo pipeline (all browser built-ins):**
1. `createImageBitmap(file)` (respects EXIF orientation in current Safari).
2. Draw to `<canvas>`, scale to 1600px long edge → `canvas.toBlob(cb, 'image/jpeg', 0.8)`.
3. Same again at 400px for the thumbnail.
4. Store both blobs in IndexedDB (`idb-keyval`) keyed by photo id, render from local blob immediately.
5. Upload in background to `photos/{visit_id}/{photo_id}.jpg` and `.../{photo_id}_thumb.jpg`, then insert the `photos` row. Delete local blobs after confirmed upload.

**Write queue:**
- All inserts and updates go through a small queue persisted in IndexedDB. Client-generated UUIDs mean children (tastings, ratings, photos) can reference a parent before it exists on the server.
- Flush on `online` event, on app focus, and on a timer while pending items exist.
- **Visit conflict:** if a queued visit upsert hits the `(place_id, visited_on)` constraint (two people created it offline), take the server's id and rewrite the local id on all queued children before flushing them. Same pattern for tastings on `(visit_id, oyster_id)`.
- Show a subtle "3 pending" indicator when the queue isn't empty. Never block the UI on it.

---

## 8. Seed data

- **Places:** Jax Fish House (Fort Collins, CO) and Elliott's Oyster House (Seattle waterfront, Pier 56). Look up real coordinates at build time; do not guess.
- **Oysters:** ~30 commonly served oysters, weighted toward Puget Sound / Hood Canal / BC (Elliott's menu territory), plus a handful of common East Coast names. Bay-level approximate coordinates, `location_approx = true`. Put this in a seed SQL file, not a migration.

---

## 9. Keep-alive

Supabase free projects pause after about a week of low activity. Use a Netlify Scheduled Function (`netlify/functions/keepalive.mjs`), not a GitHub Action: GitHub disables scheduled workflows on public repos after 60 days without commits, and this needs zero babysitting.
- Cron daily (pick an odd minute, not :00).
- Call `rpc/keepalive_ping` via the REST endpoint with the anon key, reusing the site's `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars. It stamps `keepalive.pinged_at`: a write, because a plain read did not count as activity. anon may execute only that function, so the anon key can't read or change real data.

---

## 10. Design direction

This should not look like a default CRUD app. It needs pop and personality:
- Coastal palette: deep sea blue, shell cream, kelp green, a bright accent (lemon or coral). Each person's color is distinct and used consistently.
- Shell icons for Overall, playful slider copy (see attribute table), fun loading and empty-state messages ("No oysters yet. Tragic.").
- Big touch targets; this gets used one-handed at a bar with a cocktail fork in the other hand.
- Photo-forward: The Photo is the hero of every Oyster Date.
- App icon: an oyster knife over an open half shell (original illustration, simple shape).
- Respect dark mode.

---

## 11. Out of scope for MVP (phase 2)

- Admin screens for managing places and oysters (edit, merge duplicates, delete).
- Visit-level stats and trends ("our brininess preference over time").
- Shipped-oyster tracking, grower links, sharing.

---

## 12. Build order

0. Init the local git repo, create the private repo `BrightRainSolutions/shucker` on GitHub (under the org, not a personal account, e.g. `gh repo create BrightRainSolutions/shucker --private --source=. --push`), and push.
1. Supabase project, schema migration, RLS, storage bucket, keepalive table. Seed file.
2. Vue scaffold, PWA config, auth, landing.
3. Add Oyster Date flow online-only, including photo resize and upload.
4. See Oyster Dates list, visit detail, oyster detail.
5. Map: list/map toggle, both layers, pin picker with Nominatim.
6. Offline queue and conflict remapping.
7. Netlify deploy (with the keep-alive scheduled function), test install on family members' phones.

## 13. Acceptance checks

- Each family member's phone can install to home screen and sign in.
- Creating the same place + date from two phones yields one visit.
- Photo taken in airplane mode appears immediately and uploads after reconnecting.
- Ratings from one user cannot be edited by any other (verify via RLS, not just UI).
- Map shows origins colored by rating and both seeded places.
- Keep-alive function runs green in Netlify's function logs.
