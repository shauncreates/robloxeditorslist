-- One-time setup: approved/applied to robloxeditorslist-stage1 on 14 Oct 2026.
-- Do not rerun on that project. Review before applying to a fresh test project.
-- Requires the two existing migrations. Never seeds or replaces ranking JSON.
begin;
create schema if not exists rel_private;
revoke all on schema rel_private from public, anon;
grant usage on schema rel_private to authenticated;

create table rel_private.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  roles text[] not null default array['member']::text[],
  editor_id text unique,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  check ('member' = any(roles) and roles <@ array['member','list_contributor','application_reviewer','owner']::text[])
);
create table rel_private.profile_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  editor_id text not null,
  message text not null check (char_length(message) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null
);
create table rel_private.audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null, target text, details jsonb,
  created_at timestamptz not null default now()
);
create table rel_private.data_history (
  revision uuid primary key, data jsonb not null,
  actor_id uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default now()
);
alter table rel_private.accounts enable row level security;
alter table rel_private.profile_claims enable row level security;
alter table rel_private.audit enable row level security;
alter table rel_private.data_history enable row level security;
revoke all on all tables in schema rel_private from public, anon, authenticated;

-- Adds a conflict token; the existing data column is untouched.
alter table public.roblox_editor_site_data add column revision uuid not null default gen_random_uuid();
-- Direct Data API writes cannot bypass the checked RPCs, even if a policy was
-- previously added. Public reads continue through the Cloudflare data endpoint.
revoke all on public.roblox_editor_site_data, public.editor_applications from public, anon, authenticated;
grant select on public.roblox_editor_site_data to service_role;
grant insert on public.editor_applications to service_role;

-- Trigger deliberately ignores ALL caller-supplied user/app metadata.
create function rel_private.new_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into rel_private.accounts(id) values (new.id);
  return new;
end $$;
create trigger rel_new_account after insert on auth.users
for each row execute function rel_private.new_account();
insert into rel_private.accounts(id) select id from auth.users on conflict (id) do nothing;

-- Security-definer code is private. Public wrappers below run as invokers.
-- Every callable private operation checks auth.uid(), the live Auth session,
-- and database roles. No service-role JWT or editable metadata can impersonate a user.
create function rel_private.context() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a rel_private.accounts;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id::text = auth.jwt()->>'session_id' and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
      and u.email_confirmed_at is not null and coalesce(u.is_anonymous, false) = false
      and (u.banned_until is null or u.banned_until <= now())
  ) then raise exception 'REL_UNAUTHENTICATED'; end if;
  select * into a from rel_private.accounts where id = auth.uid();
  if not found or a.disabled then raise exception 'REL_FORBIDDEN'; end if;
  return jsonb_build_object('id', a.id, 'roles', a.roles, 'editor_id', a.editor_id,
    'claim_status', (select status from rel_private.profile_claims where user_id = auth.uid()));
end $$;

create function rel_private.can(a jsonb, role_name text) returns boolean
language sql immutable set search_path = '' as $$
  select a->'roles' ? 'owner' or a->'roles' ? role_name
$$;

create function rel_private.validate_profile(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(p) loop
    if k not in ('name','handle','tiktok','note','thumb','video','links','software') then return false; end if;
    if k = 'links' then
      if jsonb_typeof(v) <> 'object' then return false; end if;
      if exists (select 1 from jsonb_each(v) l where l.key not in ('youtube','instagram','twitter','discord','tiktok')
        or jsonb_typeof(l.value) <> 'string' or char_length(l.value #>> '{}') > 2000
        or ((l.value #>> '{}') <> '' and (l.value #>> '{}') !~ '^https://[^/@[:space:]]+([/?#]|$)')) then return false; end if;
    else
      if jsonb_typeof(v) <> 'string' then return false; end if;
      if char_length(v #>> '{}') > (case when k in ('note','thumb','video') then 2000 else 120 end) then return false; end if;
      if k = 'name' and char_length(btrim(v #>> '{}')) < 1 then return false; end if;
      if k in ('thumb','video') and (v #>> '{}') <> '' and (v #>> '{}') !~ '^https://[^/@[:space:]]+([/?#]|$)' then return false; end if;
    end if;
  end loop;
  return true;
end $$;

create function rel_private.validate_data(d jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare e jsonb; s jsonb; l jsonb; k text; ids text[]; style_ids text[];
begin
  if jsonb_typeof(d) <> 'object' or jsonb_typeof(d->'site') is distinct from 'object'
    or jsonb_typeof(d->'editors') is distinct from 'array' or jsonb_typeof(d->'styles') is distinct from 'array'
    or jsonb_typeof(d->'lists') is distinct from 'object' or octet_length(d::text) > 550000 then return false; end if;
  if jsonb_array_length(d->'editors') not between 1 and 300 or jsonb_array_length(d->'styles') not between 1 and 30 then return false; end if;
  select array_agg(x->>'id') into ids from jsonb_array_elements(d->'editors') x;
  select array_agg(x->>'id') into style_ids from jsonb_array_elements(d->'styles') x;
  if (select count(distinct x) from unnest(ids) x) <> cardinality(ids)
    or (select count(distinct x) from unnest(style_ids) x) <> cardinality(style_ids) then return false; end if;
  for s in select * from jsonb_array_elements(d->'styles') loop
    if jsonb_typeof(s->'id') is distinct from 'string' or (s->>'id') !~ '^[a-zA-Z0-9_-]{1,80}$'
      or s->>'id' = 'main' or jsonb_typeof(s->'name') is distinct from 'string'
      or char_length(btrim(s->>'name')) not between 1 and 120 or jsonb_typeof(s->'color') is distinct from 'string'
      or (s->>'color') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
  end loop;
  for e in select * from jsonb_array_elements(d->'editors') loop
    if jsonb_typeof(e->'id') is distinct from 'string' or (e->>'id') !~ '^[a-zA-Z0-9_-]{1,80}$'
      or jsonb_typeof(e->'name') is distinct from 'string' or char_length(btrim(e->>'name')) not between 1 and 120 then return false; end if;
    if e ? 'flares' then
      if jsonb_typeof(e->'flares') <> 'array' then return false; end if;
      if exists (select 1 from jsonb_array_elements(e->'flares') f where jsonb_typeof(f) <> 'string' or not ((f #>> '{}') = any(style_ids))) then return false; end if;
    end if;
  end loop;
  if jsonb_typeof(d->'lists'->'main') is distinct from 'array' then return false; end if;
  for k, l in select * from jsonb_each(d->'lists') loop
    if k <> 'main' and not (k = any(style_ids)) then return false; end if;
    if jsonb_typeof(l) <> 'array' then return false; end if;
    if exists (select 1 from jsonb_array_elements(l) v where jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any(ids))) then return false; end if;
    if (select count(distinct v) from jsonb_array_elements(l) v) <> jsonb_array_length(l) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create function rel_private.site() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; result jsonb;
begin
  a := rel_private.context();
  select jsonb_build_object('data', data, 'revision', revision) into result
    from public.roblox_editor_site_data where id = 'site-data';
  if result is null then raise exception 'REL_MISSING_DATA'; end if;
  return result;
end $$;

create function rel_private.save_site(p_revision uuid, p_data jsonb, p_profile jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; previous public.roblox_editor_site_data; next_data jsonb; next_revision uuid; idx integer;
begin
  -- Serializes authorization changes and mutations, including last-Owner checks.
  perform pg_advisory_xact_lock(63841001);
  a := rel_private.context();
  select * into previous from public.roblox_editor_site_data where id = 'site-data' for update;
  if not found then raise exception 'REL_MISSING_DATA'; end if;
  if p_revision is null or p_revision <> previous.revision then raise exception 'REL_CONFLICT'; end if;
  if p_profile is not null then
    if a->>'editor_id' is null or not rel_private.validate_profile(p_profile) then raise exception 'REL_FORBIDDEN'; end if;
    select (ord - 1)::integer into idx from jsonb_array_elements(previous.data->'editors') with ordinality e(value, ord)
      where value->>'id' = a->>'editor_id';
    if idx is null then raise exception 'REL_NOT_FOUND'; end if;
    -- Merge only profile fields. ID, flares, rankings, other profiles and site data remain identical.
    next_data := jsonb_set(previous.data, array['editors', idx::text], previous.data->'editors'->idx || p_profile);
  else
    if not rel_private.can(a, 'list_contributor') then raise exception 'REL_FORBIDDEN'; end if;
    if not rel_private.validate_data(p_data) then raise exception 'REL_INVALID'; end if;
    if not rel_private.can(a, 'owner') and
      (p_data - array['editors','styles','lists']) is distinct from (previous.data - array['editors','styles','lists']) then raise exception 'REL_FORBIDDEN'; end if;
    -- Linked profiles cannot be deleted accidentally, even by a Contributor.
    if exists (select 1 from rel_private.accounts ac where ac.editor_id is not null
      and not exists (select 1 from jsonb_array_elements(p_data->'editors') e where e->>'id' = ac.editor_id)) then raise exception 'REL_INVALID'; end if;
    next_data := p_data;
  end if;
  insert into rel_private.data_history(revision, data, actor_id) values (previous.revision, previous.data, auth.uid());
  next_revision := gen_random_uuid();
  update public.roblox_editor_site_data set data = next_data, revision = next_revision, updated_at = now() where id = 'site-data';
  insert into rel_private.audit(actor_id, action, target) values(auth.uid(), case when p_profile is null then 'save_rankings' else 'save_profile' end, a->>'editor_id');
  return jsonb_build_object('ok', true, 'revision', next_revision);
end $$;

create function rel_private.applications(p_action text, p_id uuid default null, p_status text default null, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(63841001);
  a := rel_private.context();
  if not rel_private.can(a, 'application_reviewer') then raise exception 'REL_FORBIDDEN'; end if;
  if p_action = 'list' then
    if p_offset not between 0 and 1000000 then raise exception 'REL_INVALID'; end if;
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into result from
      (select * from public.editor_applications order by created_at desc, id limit 50 offset p_offset) t;
    return jsonb_build_object('applications', result, 'total', (select count(*) from public.editor_applications));
  elsif p_action = 'update' then
    if p_status is null or p_status not in ('pending','approved','rejected') then raise exception 'REL_INVALID'; end if;
    update public.editor_applications set status = p_status, reviewed_at = case when p_status = 'pending' then null else now() end where id = p_id;
    if not found then raise exception 'REL_NOT_FOUND'; end if;
    insert into rel_private.audit(actor_id, action, target, details) values(auth.uid(), 'review_application', p_id::text, jsonb_build_object('status',p_status));
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'REL_INVALID';
end $$;

create function rel_private.claim(p_editor_id text, p_message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb;
begin
  perform pg_advisory_xact_lock(63841001);
  a := rel_private.context();
  if a->>'editor_id' is not null or p_message is null or char_length(btrim(p_message)) not between 1 and 1000 then raise exception 'REL_INVALID'; end if;
  if not exists (select 1 from public.roblox_editor_site_data d, jsonb_array_elements(d.data->'editors') e where e->>'id' = p_editor_id)
    or exists (select 1 from rel_private.accounts where editor_id = p_editor_id) then raise exception 'REL_INVALID'; end if;
  insert into rel_private.profile_claims(user_id, editor_id, message) values(auth.uid(), p_editor_id, btrim(p_message))
  on conflict(user_id) do update set editor_id = excluded.editor_id, message = excluded.message, status = 'pending', created_at = now(), reviewed_by = null;
  return jsonb_build_object('ok',true);
end $$;

create function rel_private.users(p_action text, p_user_id uuid default null, p_roles text[] default null,
  p_editor_id text default null, p_disabled boolean default false, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; target rel_private.accounts; result jsonb; claim_row rel_private.profile_claims;
begin
  perform pg_advisory_xact_lock(63841001);
  a := rel_private.context();
  if not rel_private.can(a, 'owner') then raise exception 'REL_FORBIDDEN'; end if;
  if p_action = 'list' then
    if p_offset not between 0 and 1000000 then raise exception 'REL_INVALID'; end if;
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into result from
      (select ac.*, u.email, c.editor_id as requested_editor_id, c.message as claim_message, c.status as claim_status
       from rel_private.accounts ac join auth.users u on u.id = ac.id
       left join rel_private.profile_claims c on c.user_id = ac.id
       order by ac.created_at desc, ac.id limit 50 offset p_offset) t;
    return jsonb_build_object('users',result,'total',(select count(*) from rel_private.accounts));
  end if;
  select * into target from rel_private.accounts where id = p_user_id for update;
  if not found then raise exception 'REL_NOT_FOUND'; end if;
  if p_action = 'update' then
    if p_roles is null or not ('member' = any(p_roles)) or not (p_roles <@ array['member','list_contributor','application_reviewer','owner']::text[])
      or p_disabled is null then raise exception 'REL_INVALID'; end if;
    if ('owner' = any(target.roles)) and not target.disabled and (p_disabled or not ('owner' = any(p_roles)))
      and not exists (select 1 from rel_private.accounts where id <> p_user_id and 'owner' = any(roles) and not disabled) then raise exception 'REL_LAST_OWNER'; end if;
    if p_editor_id is not null and (not exists (select 1 from public.roblox_editor_site_data d, jsonb_array_elements(d.data->'editors') e where e->>'id' = p_editor_id)
      or exists (select 1 from rel_private.accounts where id <> p_user_id and editor_id = p_editor_id)) then raise exception 'REL_INVALID'; end if;
    update rel_private.accounts set roles = p_roles, editor_id = p_editor_id, disabled = p_disabled where id = p_user_id;
  elsif p_action in ('approve_claim','reject_claim') then
    select * into claim_row from rel_private.profile_claims where user_id = p_user_id and status = 'pending';
    if not found then raise exception 'REL_NOT_FOUND'; end if;
    if p_action = 'approve_claim' then
      if target.editor_id is not null or not exists (select 1 from public.roblox_editor_site_data d, jsonb_array_elements(d.data->'editors') e where e->>'id' = claim_row.editor_id)
        or exists (select 1 from rel_private.accounts where editor_id = claim_row.editor_id) then raise exception 'REL_INVALID'; end if;
      update rel_private.accounts set editor_id = claim_row.editor_id where id = p_user_id;
    end if;
    update rel_private.profile_claims set status = case when p_action = 'approve_claim' then 'approved' else 'rejected' end,
      reviewed_by = auth.uid() where user_id = p_user_id;
  else raise exception 'REL_INVALID'; end if;
  insert into rel_private.audit(actor_id, action, target, details) values(auth.uid(), p_action, p_user_id::text,
    (select to_jsonb(ac) from rel_private.accounts ac where id = p_user_id));
  return jsonb_build_object('ok',true);
end $$;

create function public.rel_context() returns jsonb language sql security invoker set search_path = '' as $$ select rel_private.context() $$;
create function public.rel_site() returns jsonb language sql security invoker set search_path = '' as $$ select rel_private.site() $$;
create function public.rel_save_site(p_revision uuid, p_data jsonb, p_profile jsonb default null) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.save_site(p_revision, p_data, p_profile) $$;
create function public.rel_applications(p_action text, p_id uuid default null, p_status text default null, p_offset integer default 0) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.applications(p_action, p_id, p_status, p_offset) $$;
create function public.rel_claim(p_editor_id text, p_message text) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.claim(p_editor_id, p_message) $$;
create function public.rel_users(p_action text, p_user_id uuid default null, p_roles text[] default null,
  p_editor_id text default null, p_disabled boolean default false, p_offset integer default 0) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.users(p_action, p_user_id, p_roles, p_editor_id, p_disabled, p_offset) $$;

revoke all on all functions in schema rel_private from public, anon, authenticated;
grant execute on function rel_private.context(), rel_private.site(), rel_private.save_site(uuid,jsonb,jsonb),
  rel_private.applications(text,uuid,text,integer), rel_private.claim(text,text), rel_private.users(text,uuid,text[],text,boolean,integer) to authenticated;
revoke all on function public.rel_context(), public.rel_site(), public.rel_save_site(uuid,jsonb,jsonb),
  public.rel_applications(text,uuid,text,integer), public.rel_claim(text,text), public.rel_users(text,uuid,text[],text,boolean,integer) from public, anon, authenticated;
grant execute on function public.rel_context(), public.rel_site(), public.rel_save_site(uuid,jsonb,jsonb),
  public.rel_applications(text,uuid,text,integer), public.rel_claim(text,text), public.rel_users(text,uuid,text[],text,boolean,integer) to authenticated;
commit;
