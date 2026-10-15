-- Requires the review-lock/username migration. Apply once after reviewing.
-- Existing usernames, roles, profile links, applications and rankings are preserved.
begin;

alter table rel_private.accounts add column username_changed_at timestamptz;
alter table rel_private.accounts alter column username drop default;

create or replace function rel_private.new_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare name text;
begin
  if jsonb_typeof(new.raw_user_meta_data->'username') is distinct from 'string' then raise exception 'REL_INVALID_USERNAME'; end if;
  name := lower(btrim(new.raw_user_meta_data->>'username'));
  if name is null or name !~ '^[a-z0-9][a-z0-9_-]{2,39}$' then raise exception 'REL_INVALID_USERNAME'; end if;
  -- Only the display name is copied; permissions and profile links use database defaults.
  insert into rel_private.accounts(id,username,username_changed_at) values(new.id,name,now());
  return new;
exception when unique_violation then raise exception 'REL_USERNAME_TAKEN';
end $$;
revoke all on function rel_private.new_account() from public,anon,authenticated;

create or replace function rel_private.context() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a rel_private.accounts;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
      and (s.not_after is null or s.not_after>now())
      and u.email_confirmed_at is not null and coalesce(u.is_anonymous,false)=false
      and (u.banned_until is null or u.banned_until<=now())
  ) then raise exception 'REL_UNAUTHENTICATED'; end if;
  select * into a from rel_private.accounts where id=auth.uid();
  if not found or a.disabled then raise exception 'REL_FORBIDDEN'; end if;
  return jsonb_build_object('id',a.id,'username',a.username,'roles',a.roles,'editor_id',a.editor_id,
    'username_next_change_at',a.username_changed_at + interval '168 hours',
    'claim_status',(select status from rel_private.profile_claims where user_id=auth.uid()));
end $$;

create or replace function rel_private.username(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; account rel_private.accounts; name text; next_change timestamptz;
begin
  perform pg_advisory_xact_lock(63841001);
  a := rel_private.context();
  name := lower(btrim(p_username));
  if name is null or name !~ '^[a-z0-9][a-z0-9_-]{2,39}$' then raise exception 'REL_INVALID_USERNAME'; end if;
  select * into account from rel_private.accounts where id=auth.uid() for update;
  next_change := account.username_changed_at + interval '168 hours';
  if name = account.username then
    return jsonb_build_object('username',name,'username_next_change_at',next_change);
  end if;
  if next_change > now() then raise exception 'REL_USERNAME_COOLDOWN'; end if;
  update rel_private.accounts set username=name,username_changed_at=now() where id=auth.uid();
  insert into rel_private.audit(actor_id,action,target,details)
    values(auth.uid(),'change_username',auth.uid()::text,jsonb_build_object('previous',a->>'username','username',name));
  return jsonb_build_object('username',name,'username_next_change_at',now() + interval '168 hours');
exception when unique_violation then raise exception 'REL_USERNAME_TAKEN';
end $$;

-- Signup checks expose only availability, never an account ID, email or roles.
create function rel_private.signup_username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_username ~ '^[a-z0-9][a-z0-9_-]{2,39}$'
    and not exists(select 1 from rel_private.accounts where username=p_username)
$$;
create function public.rel_signup_username_available(p_username text) returns boolean
language sql security invoker set search_path = '' as $$
  select rel_private.signup_username_available(p_username)
$$;
revoke all on function rel_private.signup_username_available(text),public.rel_signup_username_available(text) from public,anon,authenticated;
grant usage on schema rel_private to service_role;
grant execute on function rel_private.signup_username_available(text),public.rel_signup_username_available(text) to service_role;

notify pgrst,'reload schema';
commit;
