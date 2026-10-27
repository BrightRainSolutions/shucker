-- The daily keep-alive read wasn't enough: Supabase still flagged the project
-- as inactive. Make the ping a write. anon may call this one function, which
-- only stamps the keepalive row; it still can't touch real data.
alter table public.keepalive add column pinged_at timestamptz;

create or replace function public.keepalive_ping()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.keepalive set pinged_at = now() where id = 1 returning pinged_at;
$$;

revoke execute on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon;
