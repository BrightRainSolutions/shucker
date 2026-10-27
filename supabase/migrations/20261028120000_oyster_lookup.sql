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
revoke execute on function public.claim_oyster_lookup(uuid) from anon, public;
revoke execute on function public.finish_oyster_lookup(uuid, text, jsonb) from anon, public;
