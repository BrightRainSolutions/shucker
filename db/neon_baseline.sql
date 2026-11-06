-- Shucker schema on Neon: the baseline after moving off Supabase.
-- Consolidates the old Supabase migrations (see git history), without Supabase Storage
-- or the keep-alive table (Neon doesn't pause idle projects). Users live in
-- neon_auth."user" and auth.uid() comes from the Data API's JWT.

-- OysterCatcher initial schema
-- Tables, generated PostGIS columns, RLS, views and find-or-create RPCs.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- auth.uid() reads the Data API JWT; signed-in users need the schema for column defaults.
grant usage on schema auth, extensions to authenticated;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.oyster_species as enum (
  'pacific', 'atlantic', 'kumamoto', 'olympia', 'european_flat'
);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references neon_auth."user" (id) on delete cascade,
  display_name text not null,
  color        text not null default '#ff6b5a'
);

-- ---------------------------------------------------------------------------
-- oysters (catalog)
-- ---------------------------------------------------------------------------
create table public.oysters (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  grower          text,
  growing_area    text,
  region          text,
  country         text default 'USA',
  species         public.oyster_species,
  cultivation     text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  location        extensions.geography(Point, 4326)
    generated always as (
      case when lat is not null and lng is not null
        then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
      end
    ) stored,
  location_approx boolean not null default true,
  oysterater_url  text,
  notes           text,
  created_by      uuid references public.profiles (id) default auth.uid(),
  created_at      timestamptz not null default now()
);

create unique index oysters_name_grower_key
  on public.oysters (lower(name), coalesce(grower, ''));
create index oysters_location_idx on public.oysters using gist (location);

-- ---------------------------------------------------------------------------
-- places
-- ---------------------------------------------------------------------------
create table public.places (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  city       text,
  address    text,
  url        text,
  lat        numeric(9,6),
  lng        numeric(9,6),
  location   extensions.geography(Point, 4326)
    generated always as (
      case when lat is not null and lng is not null
        then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
      end
    ) stored,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index places_location_idx on public.places using gist (location);

-- ---------------------------------------------------------------------------
-- visits (Oyster Dates)
-- ---------------------------------------------------------------------------
create table public.visits (
  id             uuid primary key default gen_random_uuid(),
  place_id       uuid references public.places (id),
  visited_on     date not null default current_date,
  notes          text,
  cover_photo_id uuid, -- FK added after photos exists
  created_by     uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint visits_place_day_key unique nulls not distinct (place_id, visited_on)
);

-- ---------------------------------------------------------------------------
-- tastings
-- ---------------------------------------------------------------------------
create table public.tastings (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references public.visits (id) on delete cascade,
  oyster_id  uuid not null references public.oysters (id),
  price_each numeric(6,2),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint tastings_visit_oyster_key unique (visit_id, oyster_id)
);

create index tastings_oyster_idx on public.tastings (oyster_id);

-- ---------------------------------------------------------------------------
-- ratings
-- ---------------------------------------------------------------------------
create table public.ratings (
  id                uuid primary key default gen_random_uuid(),
  tasting_id        uuid not null references public.tastings (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) default auth.uid(),
  overall           smallint check (overall between 1 and 5),
  brininess         smallint check (brininess between 1 and 5),
  sweetness         smallint check (sweetness between 1 and 5),
  creaminess        smallint check (creaminess between 1 and 5),
  minerality        smallint check (minerality between 1 and 5),
  brightness        smallint check (brightness between 1 and 5),
  texture           smallint check (texture between 1 and 5),
  size              smallint check (size between 1 and 5),
  would_order_again boolean,
  note              text,
  updated_at        timestamptz not null default now(),
  constraint ratings_tasting_user_key unique (tasting_id, user_id)
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger ratings_touch before update on public.ratings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------
create table public.photos (
  id           uuid primary key default gen_random_uuid(),
  visit_id     uuid not null references public.visits (id) on delete cascade,
  tasting_id   uuid references public.tastings (id) on delete set null,
  taken_by     uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create index photos_visit_idx on public.photos (visit_id);
create index photos_tasting_idx on public.photos (tasting_id);

alter table public.visits
  add constraint visits_cover_photo_fk
  foreign key (cover_photo_id) references public.photos (id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.oysters  enable row level security;
alter table public.places   enable row level security;
alter table public.visits   enable row level security;
alter table public.tastings enable row level security;
alter table public.ratings  enable row level security;
alter table public.photos   enable row level security;

create policy "profiles: read" on public.profiles
  for select to authenticated using (true);
create policy "profiles: update self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Shared-fact tables: everyone signed in can read/insert/update; delete only your own.
do $$
declare t text;
begin
  foreach t in array array['oysters', 'places', 'visits', 'tastings'] loop
    execute format('create policy "%1$s: read" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "%1$s: insert" on public.%1$I for insert to authenticated with check (true)', t);
    execute format('create policy "%1$s: update" on public.%1$I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "%1$s: delete own" on public.%1$I for delete to authenticated using (created_by = auth.uid())', t);
  end loop;
end $$;

create policy "photos: read" on public.photos
  for select to authenticated using (true);
create policy "photos: insert" on public.photos
  for insert to authenticated with check (true);
create policy "photos: update" on public.photos
  for update to authenticated using (true) with check (true);
create policy "photos: delete own" on public.photos
  for delete to authenticated using (taken_by = auth.uid());

create policy "ratings: read" on public.ratings
  for select to authenticated using (true);
create policy "ratings: insert own" on public.ratings
  for insert to authenticated with check (user_id = auth.uid());
create policy "ratings: update own" on public.ratings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ratings: delete own" on public.ratings
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Find-or-create RPCs
-- The client generates ids; if a row already exists for the natural key, the
-- server's id comes back and the client remaps any queued children to it.
-- security invoker, so RLS still applies.
-- ---------------------------------------------------------------------------
create or replace function public.find_or_create_visit(
  p_id uuid, p_place_id uuid, p_visited_on date, p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into visits (id, place_id, visited_on, notes)
  values (p_id, p_place_id, p_visited_on, p_notes)
  on conflict on constraint visits_place_day_key do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from visits
    where place_id is not distinct from p_place_id and visited_on = p_visited_on;
  end if;
  return v_id;
end $$;

create or replace function public.find_or_create_tasting(
  p_id uuid, p_visit_id uuid, p_oyster_id uuid, p_price_each numeric default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into tastings (id, visit_id, oyster_id, price_each)
  values (p_id, p_visit_id, p_oyster_id, p_price_each)
  on conflict on constraint tastings_visit_oyster_key do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from tastings
    where visit_id = p_visit_id and oyster_id = p_oyster_id;
    if p_price_each is not null then
      update tastings set price_each = p_price_each where id = v_id and price_each is null;
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.find_or_create_oyster(
  p_id uuid, p_name text, p_grower text default null, p_growing_area text default null,
  p_species public.oyster_species default null, p_lat numeric default null, p_lng numeric default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from oysters
  where lower(name) = lower(p_name) and coalesce(grower, '') = coalesce(p_grower, '');
  if v_id is not null then
    return v_id;
  end if;

  insert into oysters (id, name, grower, growing_area, species, lat, lng, location_approx)
  values (p_id, p_name, p_grower, p_growing_area, p_species, p_lat, p_lng, p_lat is null)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  select id into v_id from oysters
  where lower(name) = lower(p_name) and coalesce(grower, '') = coalesce(p_grower, '');
  return v_id;
end $$;

grant execute on function public.find_or_create_visit   to authenticated;
grant execute on function public.find_or_create_tasting to authenticated;
grant execute on function public.find_or_create_oyster  to authenticated;
revoke execute on function public.find_or_create_visit   from anonymous, public;
revoke execute on function public.find_or_create_tasting from anonymous, public;
revoke execute on function public.find_or_create_oyster  from anonymous, public;

-- ---------------------------------------------------------------------------
-- Views (security_invoker so RLS of the caller applies)
-- ---------------------------------------------------------------------------
create view public.oyster_stats with (security_invoker = true) as
select
  t.oyster_id,
  r.user_id,
  round(avg(r.overall)::numeric, 2)                              as avg_overall,
  round(avg(r.brininess)::numeric, 2)                            as avg_brininess,
  round(avg(r.sweetness)::numeric, 2)                            as avg_sweetness,
  round(avg(r.creaminess)::numeric, 2)                           as avg_creaminess,
  round(avg(r.minerality)::numeric, 2)                           as avg_minerality,
  round(avg(r.brightness)::numeric, 2)                           as avg_brightness,
  round(avg(r.texture)::numeric, 2)                              as avg_texture,
  round(avg(r.size)::numeric, 2)                                 as avg_size,
  count(*)::int                                                  as tasting_count,
  max(v.visited_on)                                              as last_tasted,
  round(100.0 * avg(case when r.would_order_again then 1.0
                         when r.would_order_again = false then 0.0 end), 0) as would_order_again_pct
from public.ratings r
join public.tastings t on t.id = r.tasting_id
join public.visits v   on v.id = t.visit_id
group by t.oyster_id, r.user_id;

create view public.oyster_stats_combined with (security_invoker = true) as
select
  o.id                                                 as oyster_id,
  o.name,
  o.grower,
  o.growing_area,
  o.region,
  o.species,
  o.lat,
  o.lng,
  o.location_approx,
  round(avg(r.overall)::numeric, 2)                    as avg_overall,
  count(distinct t.id)::int                            as tasting_count,
  max(v.visited_on)                                    as last_tasted,
  round(100.0 * avg(case when r.would_order_again then 1.0
                         when r.would_order_again = false then 0.0 end), 0) as would_order_again_pct
from public.oysters o
left join public.tastings t on t.oyster_id = o.id
left join public.visits v   on v.id = t.visit_id
left join public.ratings r  on r.tasting_id = t.id
group by o.id;

create view public.visit_summary with (security_invoker = true) as
select
  v.id,
  v.place_id,
  v.visited_on,
  v.notes,
  v.cover_photo_id,
  v.created_by,
  v.created_at,
  p.name                                                   as place_name,
  p.city                                                   as place_city,
  p.lat                                                    as place_lat,
  p.lng                                                    as place_lng,
  (select count(*)::int from public.tastings t where t.visit_id = v.id) as tasting_count,
  (
    select coalesce(jsonb_object_agg(x.user_id, x.avg_overall), '{}'::jsonb)
    from (
      select r.user_id, round(avg(r.overall)::numeric, 2) as avg_overall
      from public.ratings r
      join public.tastings t on t.id = r.tasting_id
      where t.visit_id = v.id and r.overall is not null
      group by r.user_id
    ) x
  )                                                        as avg_overall_by_user
from public.visits v
left join public.places p  on p.id = v.place_id;

grant select on public.oyster_stats, public.oyster_stats_combined, public.visit_summary to authenticated;


-- Explicit table grants for signed-in users.
-- The project doesn't auto-expose new public tables to the Data API roles, so
-- without these, RLS policies never get a chance to run: every request from a
-- signed-in user fails with "permission denied". anon gets nothing here (it
-- only reads public.keepalive, granted in the init migration).

grant select, update on public.profiles to authenticated;

grant select, insert, update, delete on
  public.oysters,
  public.places,
  public.visits,
  public.tastings,
  public.ratings,
  public.photos
to authenticated;

-- New rating attribute: Smell of the Sea (1-5, nullable like the others).
alter table public.ratings
  add column smell_of_the_sea smallint check (smell_of_the_sea between 1 and 5);

-- Add its per-person average to oyster_stats. New view columns must go at
-- the end for `create or replace view`.
create or replace view public.oyster_stats with (security_invoker = true) as
select
  t.oyster_id,
  r.user_id,
  round(avg(r.overall)::numeric, 2)                              as avg_overall,
  round(avg(r.brininess)::numeric, 2)                            as avg_brininess,
  round(avg(r.sweetness)::numeric, 2)                            as avg_sweetness,
  round(avg(r.creaminess)::numeric, 2)                           as avg_creaminess,
  round(avg(r.minerality)::numeric, 2)                           as avg_minerality,
  round(avg(r.brightness)::numeric, 2)                           as avg_brightness,
  round(avg(r.texture)::numeric, 2)                              as avg_texture,
  round(avg(r.size)::numeric, 2)                                 as avg_size,
  count(*)::int                                                  as tasting_count,
  max(v.visited_on)                                              as last_tasted,
  round(100.0 * avg(case when r.would_order_again then 1.0
                         when r.would_order_again = false then 0.0 end), 0) as would_order_again_pct,
  round(avg(r.smell_of_the_sea)::numeric, 2)                     as avg_smell_of_the_sea
from public.ratings r
join public.tastings t on t.id = r.tasting_id
join public.visits v   on v.id = t.visit_id
group by t.oyster_id, r.user_id;

-- Oysters can be added by name alone; a Netlify background function asks
-- Claude to fill in the rest. This tracks that lookup, stores the Shucker
-- fact, and flags Claude-filled details until a person has checked them.

alter table public.oysters
  add column lookup_status text check (lookup_status in ('pending', 'running', 'found', 'not_found', 'failed')),
  add column lookup_at     timestamptz,
  add column details_url   text,          -- the page the lookup relied on most
  add column fact          text,          -- the Shucker fact
  add column fact_url      text,
  add column needs_review  boolean not null default false;

-- Existing oysters were entered by hand; new ones start pending.
alter table public.oysters alter column lookup_status set default 'pending';

-- Claim an oyster for lookup. Returns its name, or null when there's nothing
-- to do: already looked up, or another phone's lookup is still running.
-- A run that never finished is retried after five minutes.
create or replace function public.claim_oyster_lookup(p_id uuid)
returns text
language sql security invoker set search_path = public as $$
  update oysters
     set lookup_status = 'running', lookup_at = now()
   where id = p_id
     and (lookup_status in ('pending', 'failed')
          or (lookup_status = 'running' and lookup_at < now() - interval '5 minutes'))
  returning name;
$$;

-- Record a lookup. Fills only empty fields, so nothing a person typed is
-- overwritten. The one exception is country, which the app never asks for and
-- which defaults to USA. The name only changes when it differs in case
-- ("kusshi" -> "Kusshi"). The pin is set only when there's no pin yet.
create or replace function public.finish_oyster_lookup(p_id uuid, p_status text, p_result jsonb default null)
returns void
language sql security invoker set search_path = public as $$
  update oysters o set
    name          = case when lower(p_result->>'canonical_name') = lower(o.name) then p_result->>'canonical_name' else o.name end,
    grower        = coalesce(o.grower, p_result->>'grower'),
    growing_area  = coalesce(o.growing_area, p_result->>'growing_area'),
    region        = coalesce(o.region, p_result->>'region'),
    country       = coalesce(p_result->>'country', o.country),
    species       = coalesce(o.species, (p_result->>'species')::oyster_species),
    cultivation   = coalesce(o.cultivation, p_result->>'cultivation'),
    lat           = case when o.lat is null and o.lng is null then (p_result->>'lat')::numeric else o.lat end,
    lng           = case when o.lat is null and o.lng is null then (p_result->>'lng')::numeric else o.lng end,
    oysterater_url = coalesce(o.oysterater_url, p_result->>'oysterater_url'),
    details_url   = coalesce(o.details_url, p_result->>'source_url'),
    fact          = coalesce(o.fact, p_result->>'fact'),
    fact_url      = coalesce(o.fact_url, p_result->>'fact_url'),
    needs_review  = o.needs_review or p_status = 'found',
    lookup_status = p_status,
    lookup_at     = now()
  where o.id = p_id;
$$;

grant execute on function public.claim_oyster_lookup(uuid) to authenticated;
grant execute on function public.finish_oyster_lookup(uuid, text, jsonb) to authenticated;
revoke execute on function public.claim_oyster_lookup(uuid) from anonymous, public;
revoke execute on function public.finish_oyster_lookup(uuid, text, jsonb) from anonymous, public;

-- ---------------------------------------------------------------------------
-- Photo bytes. Kept apart from public.photos so ordinary queries never pull
-- image data; ask for full_jpeg or thumb_jpeg by photo id. Deleting a photo
-- removes its bytes through the cascade.
-- ---------------------------------------------------------------------------
create table public.photo_files (
  photo_id   uuid primary key references public.photos (id) on delete cascade,
  full_jpeg  bytea not null,
  thumb_jpeg bytea not null
);

alter table public.photo_files enable row level security;
create policy "photo_files: read" on public.photo_files
  for select to authenticated using (true);
create policy "photo_files: insert" on public.photo_files
  for insert to authenticated with check (true);
create policy "photo_files: update" on public.photo_files
  for update to authenticated using (true) with check (true);
grant select, insert, update on public.photo_files to authenticated;
