-- Review before applying. Requires REL accounts and public profiles; does not rewrite ranking JSON.
begin;

create table rel_private.tiktok_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  open_id text not null unique check(char_length(open_id) between 1 and 200),
  username text not null check(username ~ '^[A-Za-z0-9._]{1,40}$'),
  display_name text not null check(char_length(btrim(display_name)) between 1 and 150),
  verified_at timestamptz not null,
  expires_at timestamptz not null
);
create table rel_private.tiktok_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  state_hash text not null unique check(state_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '10 minutes',
  consumed boolean not null default false,
  finish_hash text check(finish_hash is null or finish_hash ~ '^[0-9a-f]{64}$'),
  proof jsonb,
  proven_at timestamptz
);
alter table rel_private.tiktok_connections enable row level security;
alter table rel_private.tiktok_challenges enable row level security;
revoke all on rel_private.tiktok_connections,rel_private.tiktok_challenges from public,anon,authenticated;
create index rel_tiktok_expiry on rel_private.tiktok_connections(expires_at);
create index rel_tiktok_starts on rel_private.audit(actor_id,action,created_at);

create function rel_private.tiktok_cleanup() returns jsonb
language plpgsql security definer set search_path='' as $$
declare connections integer; challenges integer;
begin
  delete from rel_private.tiktok_connections where expires_at<=now();
  get diagnostics connections=row_count;
  delete from rel_private.tiktok_challenges where expires_at<=now();
  get diagnostics challenges=row_count;
  return jsonb_build_object('connections_removed',connections,'challenges_removed',challenges);
end $$;
revoke all on function rel_private.tiktok_cleanup() from public,anon,authenticated;

create function rel_private.tiktok(p_action text,p_state_hash text,p_finish_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; challenge rel_private.tiktok_challenges; connection jsonb; pending jsonb;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  perform rel_private.tiktok_cleanup();
  if p_action='begin' then
    if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then raise exception 'REL_INVALID'; end if;
    if exists(select 1 from rel_private.tiktok_challenges where user_id=auth.uid() and created_at>now()-interval '1 minute')
      or (select count(*) from rel_private.audit where actor_id=auth.uid() and action='start_tiktok_connection' and created_at>now()-interval '1 hour')>=5
      then raise exception 'REL_TIKTOK_WAIT'; end if;
    insert into rel_private.tiktok_challenges(user_id,session_id,state_hash)
      values(auth.uid(),(auth.jwt()->>'session_id')::uuid,p_state_hash)
      on conflict(user_id) do update set session_id=excluded.session_id,state_hash=excluded.state_hash,
        created_at=now(),expires_at=excluded.expires_at,consumed=false,finish_hash=null,proof=null,proven_at=null;
    insert into rel_private.audit(actor_id,action,target,details)
      values(auth.uid(),'start_tiktok_connection',auth.uid()::text,jsonb_build_object('actor_username',a->>'username'));
    return jsonb_build_object('ok',true);
  elsif p_action='status' then
    select jsonb_build_object('username',username,'display_name',display_name,'verified_at',verified_at,'expires_at',expires_at)
      into connection from rel_private.tiktok_connections where user_id=auth.uid();
    select c.proof-'open_id' || jsonb_build_object('expires_at',c.expires_at) into pending
      from rel_private.tiktok_challenges c where c.user_id=auth.uid() and c.session_id::text=auth.jwt()->>'session_id'
        and c.proof is not null and c.expires_at>now();
    return jsonb_build_object('connection',connection,'pending',pending);
  elsif p_action='finish' then
    select * into challenge from rel_private.tiktok_challenges where user_id=auth.uid() for update;
    if not found or challenge.session_id::text is distinct from auth.jwt()->>'session_id'
      or not challenge.consumed or challenge.proof is null or challenge.proven_at is null
      or p_finish_hash is null or challenge.finish_hash is distinct from p_finish_hash then raise exception 'REL_TIKTOK_EXPIRED'; end if;
    insert into rel_private.tiktok_connections(user_id,open_id,username,display_name,verified_at,expires_at)
      values(auth.uid(),challenge.proof->>'open_id',challenge.proof->>'username',challenge.proof->>'display_name',challenge.proven_at,challenge.proven_at+interval '29 days')
      on conflict(user_id) do update set open_id=excluded.open_id,username=excluded.username,display_name=excluded.display_name,
        verified_at=excluded.verified_at,expires_at=excluded.expires_at;
    delete from rel_private.tiktok_challenges where user_id=auth.uid();
    insert into rel_private.audit(actor_id,action,target,details)
      values(auth.uid(),'connect_tiktok',auth.uid()::text,jsonb_build_object('actor_username',a->>'username','method','tiktok_oauth'));
    return jsonb_build_object('ok',true);
  elsif p_action='cancel' then
    delete from rel_private.tiktok_challenges where user_id=auth.uid() and session_id::text=auth.jwt()->>'session_id';
    return jsonb_build_object('ok',true);
  elsif p_action='disconnect' then
    delete from rel_private.tiktok_challenges where user_id=auth.uid();
    delete from rel_private.tiktok_connections where user_id=auth.uid();
    insert into rel_private.audit(actor_id,action,target,details)
      values(auth.uid(),'disconnect_tiktok',auth.uid()::text,jsonb_build_object('actor_username',a->>'username'));
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'REL_INVALID';
exception when unique_violation then raise exception 'REL_TIKTOK_TAKEN';
end $$;
create function public.rel_tiktok(p_action text,p_state_hash text default null,p_finish_hash text default null) returns jsonb
language sql security invoker set search_path='' as $$ select rel_private.tiktok(p_action,p_state_hash,p_finish_hash) $$;
revoke all on function rel_private.tiktok(text,text,text),public.rel_tiktok(text,text,text) from public,anon,authenticated;
grant execute on function rel_private.tiktok(text,text,text),public.rel_tiktok(text,text,text) to authenticated;

create function public.rel_tiktok_exchange(p_action text,p_state_hash text default null,p_finish_hash text default null,p_proof jsonb default null,p_account_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare challenge rel_private.tiktok_challenges; result jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  if p_action='cleanup' then return rel_private.tiktok_cleanup(); end if;
  if p_action='public' then
    select jsonb_build_object('username',c.username,'display_name',c.display_name,'verified_at',c.verified_at,'expires_at',c.expires_at)
      into result from rel_private.tiktok_connections c join rel_private.accounts a on a.id=c.user_id join auth.users u on u.id=c.user_id
      where c.user_id=p_account_id and c.expires_at>now() and not a.disabled and u.email_confirmed_at is not null
        and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now());
    return result;
  end if;
  perform pg_advisory_xact_lock(63841001);
  select c.* into challenge from rel_private.tiktok_challenges c join auth.sessions s on s.id=c.session_id
    join rel_private.accounts a on a.id=c.user_id join auth.users u on u.id=c.user_id
    where c.state_hash=p_state_hash and c.expires_at>now() and s.user_id=c.user_id
      and (s.not_after is null or s.not_after>now()) and not a.disabled and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()) for update of c;
  if not found then raise exception 'REL_TIKTOK_EXPIRED'; end if;
  if p_action='claim' then
    if challenge.consumed then raise exception 'REL_TIKTOK_EXPIRED'; end if;
    update rel_private.tiktok_challenges set consumed=true where user_id=challenge.user_id;
    return jsonb_build_object('ok',true);
  elsif p_action='proof' then
    if not challenge.consumed or challenge.proof is not null or p_finish_hash is null or p_finish_hash !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_proof) is distinct from 'object' or jsonb_typeof(p_proof->'open_id') is distinct from 'string'
      or char_length(p_proof->>'open_id') not between 1 and 200 or jsonb_typeof(p_proof->'username') is distinct from 'string'
      or p_proof->>'username' !~ '^[A-Za-z0-9._]{1,40}$' or jsonb_typeof(p_proof->'display_name') is distinct from 'string'
      or char_length(btrim(p_proof->>'display_name')) not between 1 and 150 then raise exception 'REL_INVALID'; end if;
    update rel_private.tiktok_challenges set finish_hash=p_finish_hash,proven_at=now(),
      proof=jsonb_build_object('open_id',p_proof->>'open_id','username',p_proof->>'username','display_name',p_proof->>'display_name')
      where user_id=challenge.user_id;
    return jsonb_build_object('ok',true);
  elsif p_action='abort' then
    delete from rel_private.tiktok_challenges where user_id=challenge.user_id;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'REL_INVALID';
end $$;
revoke all on function public.rel_tiktok_exchange(text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.rel_tiktok_exchange(text,text,text,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
commit;
