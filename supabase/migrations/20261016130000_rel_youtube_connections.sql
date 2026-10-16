-- Requires REL accounts, public profiles and application tracking. Never rewrites rankings.
begin;
create table rel_private.youtube_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  channel_id text not null unique check(channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  title text not null check(char_length(title) between 1 and 150),
  verified_at timestamptz not null default now(),
  checked_at timestamptz not null default now(),
  attempted_at timestamptz,
  token_ciphertext text not null
);
create table rel_private.youtube_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  state_hash text not null unique check(state_hash ~ '^[0-9a-f]{64}$'),
  verifier text not null check(verifier ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '10 minutes',
  consumed boolean not null default false,
  channels jsonb,
  finish_hash text check(finish_hash is null or finish_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext text
);
alter table rel_private.youtube_connections enable row level security;
alter table rel_private.youtube_challenges enable row level security;
revoke all on rel_private.youtube_connections,rel_private.youtube_challenges from public,anon,authenticated;
create index rel_youtube_attempts on rel_private.audit(actor_id,action,created_at);
create index rel_youtube_checks on rel_private.youtube_connections(checked_at,attempted_at);

create function rel_private.youtube(p_action text,p_state_hash text,p_verifier text,p_finish_hash text,p_channel_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; challenge rel_private.youtube_challenges; channel jsonb; linked jsonb;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  if p_action='begin' then
    if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' or p_verifier is null or p_verifier !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'REL_INVALID'; end if;
    if exists(select 1 from rel_private.youtube_challenges where user_id=auth.uid() and created_at>now()-interval '1 minute')
      or (select count(*) from rel_private.audit where actor_id=auth.uid() and action='start_youtube_connection' and created_at>now()-interval '1 hour')>=5
      then raise exception 'REL_YOUTUBE_WAIT'; end if;
    delete from rel_private.youtube_challenges where expires_at<=now();
    insert into rel_private.youtube_challenges(user_id,session_id,state_hash,verifier)
      values(auth.uid(),(auth.jwt()->>'session_id')::uuid,p_state_hash,p_verifier)
      on conflict(user_id) do update set session_id=excluded.session_id,state_hash=excluded.state_hash,verifier=excluded.verifier,
        created_at=now(),expires_at=excluded.expires_at,consumed=false,channels=null,finish_hash=null,token_ciphertext=null;
    insert into rel_private.audit(actor_id,action,target) values(auth.uid(),'start_youtube_connection',auth.uid()::text);
    return jsonb_build_object('ok',true);
  elsif p_action='status' then
    delete from rel_private.youtube_connections where user_id=auth.uid() and checked_at<now()-interval '29 days';
    select jsonb_build_object('channel_id',channel_id,'title',title,'verified_at',verified_at,'checked_at',checked_at,'fresh',checked_at>now()-interval '2 days') into linked
      from rel_private.youtube_connections where user_id=auth.uid();
    select * into challenge from rel_private.youtube_challenges where user_id=auth.uid()
      and session_id::text=auth.jwt()->>'session_id' and expires_at>now();
    return jsonb_build_object('connection',linked,'channels',coalesce(challenge.channels,'[]'::jsonb));
  elsif p_action='finish' then
    select * into challenge from rel_private.youtube_challenges where user_id=auth.uid() for update;
    if not found or challenge.session_id::text is distinct from auth.jwt()->>'session_id' or challenge.expires_at<=now()
      or p_finish_hash is null or challenge.finish_hash is distinct from p_finish_hash then raise exception 'REL_OAUTH_EXPIRED'; end if;
    select item into channel from jsonb_array_elements(challenge.channels) item where item->>'id'=p_channel_id;
    if channel is null then raise exception 'REL_INVALID'; end if;
    if challenge.token_ciphertext is null then raise exception 'REL_OAUTH_EXPIRED'; end if;
    insert into rel_private.youtube_connections(user_id,channel_id,title,token_ciphertext) values(auth.uid(),p_channel_id,channel->>'title',challenge.token_ciphertext)
      on conflict(user_id) do update set channel_id=excluded.channel_id,title=excluded.title,verified_at=now(),checked_at=now(),token_ciphertext=excluded.token_ciphertext;
    delete from rel_private.youtube_challenges where user_id=auth.uid();
    insert into rel_private.audit(actor_id,action,target,details) values(auth.uid(),'link_youtube',auth.uid()::text,jsonb_build_object('method','google_oauth'));
    return jsonb_build_object('ok',true);
  elsif p_action='disconnect' then
    delete from rel_private.youtube_connections where user_id=auth.uid();
    delete from rel_private.youtube_challenges where user_id=auth.uid();
    insert into rel_private.audit(actor_id,action,target) values(auth.uid(),'unlink_youtube',auth.uid()::text);
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'REL_INVALID';
exception when unique_violation then raise exception 'REL_YOUTUBE_TAKEN';
end $$;
create function public.rel_youtube(p_action text,p_state_hash text default null,p_verifier text default null,p_finish_hash text default null,p_channel_id text default null) returns jsonb
language sql security invoker set search_path='' as $$ select rel_private.youtube(p_action,p_state_hash,p_verifier,p_finish_hash,p_channel_id) $$;

create function rel_private.youtube_exchange(p_action text,p_state_hash text,p_finish_hash text,p_channels jsonb,p_token_ciphertext text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare challenge rel_private.youtube_challenges; clean jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  select c.* into challenge from rel_private.youtube_challenges c join auth.sessions s on s.id=c.session_id
    join auth.users u on u.id=c.user_id join rel_private.accounts a on a.id=c.user_id
    where c.state_hash=p_state_hash and c.expires_at>now() and s.user_id=c.user_id
      and (s.not_after is null or s.not_after>now()) and not a.disabled and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()) for update of c;
  if not found then raise exception 'REL_OAUTH_EXPIRED'; end if;
  if p_action='claim' then
    if challenge.consumed then raise exception 'REL_OAUTH_EXPIRED'; end if;
    update rel_private.youtube_challenges set consumed=true where user_id=challenge.user_id;
    return jsonb_build_object('verifier',challenge.verifier);
  elsif p_action='proof' then
    if not challenge.consumed or challenge.channels is not null or p_finish_hash is null or p_finish_hash !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_channels) is distinct from 'array' or p_token_ciphertext is null or char_length(p_token_ciphertext)>4096
      or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then raise exception 'REL_INVALID'; end if;
    if jsonb_array_length(p_channels) not between 1 and 50 then raise exception 'REL_INVALID'; end if;
    if exists(select 1 from jsonb_array_elements(p_channels) item where jsonb_typeof(item->'id') is distinct from 'string'
      or (item->>'id') !~ '^UC[A-Za-z0-9_-]{22}$' or jsonb_typeof(item->'title') is distinct from 'string'
      or char_length(item->>'title') not between 1 and 150) then raise exception 'REL_INVALID'; end if;
    select jsonb_agg(jsonb_build_object('id',item->>'id','title',item->>'title')) into clean from jsonb_array_elements(p_channels) item;
    update rel_private.youtube_challenges set channels=clean,finish_hash=p_finish_hash,token_ciphertext=p_token_ciphertext where user_id=challenge.user_id;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'REL_INVALID';
end $$;
create function public.rel_youtube_exchange(p_action text,p_state_hash text,p_finish_hash text default null,p_channels jsonb default null,p_token_ciphertext text default null) returns jsonb
language sql security invoker set search_path='' as $$ select rel_private.youtube_exchange(p_action,p_state_hash,p_finish_hash,p_channels,p_token_ciphertext) $$;

create function public.rel_youtube_tokens(p_action text,p_user_id uuid default null,p_channel_id text default null,p_title text default null,p_ciphertext text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  if p_action='due' then
    delete from rel_private.youtube_connections where checked_at<now()-interval '29 days';
    delete from rel_private.youtube_challenges where expires_at<=now();
    with picked as (
      select c.user_id from rel_private.youtube_connections c
      where c.checked_at<now()-interval '1 day' and (c.attempted_at is null or c.attempted_at<now()-interval '15 minutes')
      order by c.attempted_at nulls first,c.checked_at limit 5 for update skip locked
    ), taken as (
      update rel_private.youtube_connections c set attempted_at=now() from picked p where c.user_id=p.user_id
      returning c.user_id,c.channel_id,c.token_ciphertext
    ) select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('active',exists(
      select 1 from rel_private.accounts a join auth.users u on u.id=a.id where a.id=t.user_id and not a.disabled
        and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
    ))),'[]'::jsonb) into result from taken t;
    return result;
  elsif p_action='get' then
    select jsonb_build_object('user_id',user_id,'channel_id',channel_id,'token_ciphertext',token_ciphertext) into result
      from rel_private.youtube_connections where user_id=p_user_id;
    return coalesce(result,'{}'::jsonb)||jsonb_build_object('pending_ciphertext',(select token_ciphertext from rel_private.youtube_challenges where user_id=p_user_id));
  elsif p_action='refresh' then
    if p_title is null or char_length(p_title) not between 1 and 150 then raise exception 'REL_INVALID'; end if;
    update rel_private.youtube_connections set title=p_title,checked_at=now() where user_id=p_user_id and channel_id=p_channel_id and token_ciphertext=p_ciphertext;
  elsif p_action='delete' then
    delete from rel_private.youtube_connections where user_id=p_user_id and channel_id=p_channel_id and token_ciphertext=p_ciphertext;
  else raise exception 'REL_INVALID'; end if;
  return jsonb_build_object('ok',true);
end $$;

create function public.rel_public_youtube(p_account uuid) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object('channel_id',c.channel_id,'title',c.title,'verified_at',c.verified_at)
  from rel_private.youtube_connections c join rel_private.accounts a on a.id=c.user_id join auth.users u on u.id=c.user_id
  where c.user_id=p_account and c.checked_at>now()-interval '2 days' and not a.disabled and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until<=now())
$$;
revoke all on function rel_private.youtube(text,text,text,text,text),public.rel_youtube(text,text,text,text,text),
  rel_private.youtube_exchange(text,text,text,jsonb,text),public.rel_youtube_exchange(text,text,text,jsonb,text),public.rel_youtube_tokens(text,uuid,text,text,text),public.rel_public_youtube(uuid) from public,anon,authenticated;
grant execute on function rel_private.youtube(text,text,text,text,text),public.rel_youtube(text,text,text,text,text) to authenticated;
grant execute on function rel_private.youtube_exchange(text,text,text,jsonb,text),public.rel_youtube_exchange(text,text,text,jsonb,text),public.rel_youtube_tokens(text,uuid,text,text,text),public.rel_public_youtube(uuid) to service_role;
notify pgrst,'reload schema';
commit;
