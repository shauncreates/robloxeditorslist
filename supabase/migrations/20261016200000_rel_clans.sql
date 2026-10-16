-- Review before applying after REL accounts/public profiles. Never rewrites editor or ranking JSON.
begin;
create table rel_private.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 3 and 50),
  prefix text not null unique check(prefix ~ '^[A-Z0-9]{4}$'),
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index rel_clan_names on rel_private.clans(lower(btrim(name)));
create table rel_private.clan_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  clan_id uuid not null references rel_private.clans(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index rel_clan_memberships on rel_private.clan_members(clan_id);
create table rel_private.clan_invites (
  clan_id uuid primary key references rel_private.clans(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default now()+interval '7 days'
);
alter table rel_private.clans enable row level security;
alter table rel_private.clan_members enable row level security;
alter table rel_private.clan_invites enable row level security;
revoke all on rel_private.clans,rel_private.clan_members,rel_private.clan_invites from public,anon,authenticated;

create function rel_private.clan_active(p_user uuid) returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from rel_private.accounts a join auth.users u on u.id=a.id where a.id=p_user and not a.disabled
    and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()))
$$;
revoke all on function rel_private.clan_active(uuid) from public,anon,authenticated;

create function rel_private.clans(p_action text,p_clan uuid,p_name text,p_prefix text,p_invite_hash text,p_member uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; own rel_private.clans; target rel_private.clans; result jsonb; removed integer;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  select c.* into own from rel_private.clans c join rel_private.clan_members m on m.clan_id=c.id where m.user_id=auth.uid();
  if p_action='status' then
    if own.id is not null then
      result:=jsonb_build_object('id',own.id,'name',own.name,'prefix',own.prefix,'is_creator',own.creator_id=auth.uid(),
        'invite_expires_at',(select expires_at from rel_private.clan_invites where clan_id=own.id and own.creator_id=auth.uid() and expires_at>now()));
    end if;
    return jsonb_build_object('clan',result);
  end if;
  if p_action='create' then
    if own.id is not null then raise exception 'REL_CLAN_MEMBER'; end if;
    if (select count(*) from rel_private.audit where actor_id=auth.uid() and action='create_clan' and created_at>now()-interval '1 day')>=3 then raise exception 'REL_CLAN_WAIT'; end if;
    if p_name is null or char_length(btrim(p_name)) not between 3 and 50 or p_prefix is null or upper(p_prefix) !~ '^[A-Z0-9]{4}$' then raise exception 'REL_INVALID'; end if;
    insert into rel_private.clans(name,prefix,creator_id) values(btrim(p_name),upper(p_prefix),auth.uid()) returning * into target;
    insert into rel_private.clan_members(user_id,clan_id) values(auth.uid(),target.id);
  elsif p_action='join' then
    if own.id is not null then raise exception 'REL_CLAN_MEMBER'; end if;
    select c.* into target from rel_private.clans c join rel_private.clan_invites i on i.clan_id=c.id
      where i.token_hash=p_invite_hash and i.expires_at>now() and rel_private.clan_active(c.creator_id);
    if not found then raise exception 'REL_CLAN_INVITE'; end if;
    insert into rel_private.clan_members(user_id,clan_id) values(auth.uid(),target.id);
  elsif p_action='leave' then
    if own.id is null then raise exception 'REL_NOT_FOUND'; end if;
    if own.creator_id=auth.uid() then raise exception 'REL_CLAN_CREATOR'; end if;
    target:=own;
    delete from rel_private.clan_members where user_id=auth.uid();
  else
    select * into target from rel_private.clans where id=p_clan;
    if target.id is null or target.creator_id<>auth.uid() then raise exception 'REL_FORBIDDEN'; end if;
    if p_action='update' then
      if p_name is null or char_length(btrim(p_name)) not between 3 and 50 or p_prefix is null or upper(p_prefix) !~ '^[A-Z0-9]{4}$' then raise exception 'REL_INVALID'; end if;
      update rel_private.clans set name=btrim(p_name),prefix=upper(p_prefix) where id=target.id;
    elsif p_action='invite' then
      if p_invite_hash is null or p_invite_hash !~ '^[0-9a-f]{64}$' then raise exception 'REL_INVALID'; end if;
      if (select count(*) from rel_private.audit where actor_id=auth.uid() and action='invite_clan' and created_at>now()-interval '1 hour')>=10 then raise exception 'REL_CLAN_WAIT'; end if;
      insert into rel_private.clan_invites(clan_id,token_hash) values(target.id,p_invite_hash)
        on conflict(clan_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
    elsif p_action='revoke_invite' then
      delete from rel_private.clan_invites where clan_id=target.id;
    elsif p_action='remove' then
      if p_member is null or p_member=auth.uid() then raise exception 'REL_CLAN_CREATOR'; end if;
      delete from rel_private.clan_members where user_id=p_member and clan_id=target.id;
      get diagnostics removed=row_count;
      if removed=0 then raise exception 'REL_NOT_FOUND'; end if;
    elsif p_action='disband' then
      delete from rel_private.clans where id=target.id;
    else raise exception 'REL_INVALID'; end if;
  end if;
  insert into rel_private.audit(actor_id,action,target,details) values(auth.uid(),p_action||'_clan',target.id::text,
    jsonb_strip_nulls(jsonb_build_object('actor_username',a->>'username','member_id',case when p_action='remove' then p_member else null end)));
  return jsonb_build_object('ok',true,'clan_id',target.id);
exception when unique_violation then raise exception 'REL_CLAN_TAKEN';
end $$;
create function public.rel_clans(p_action text,p_clan uuid default null,p_name text default null,p_prefix text default null,p_invite_hash text default null,p_member uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select rel_private.clans(p_action,p_clan,p_name,p_prefix,p_invite_hash,p_member) $$;
revoke all on function rel_private.clans(text,uuid,text,text,text,uuid),public.rel_clans(text,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function rel_private.clans(text,uuid,text,text,text,uuid),public.rel_clans(text,uuid,text,text,text,uuid) to authenticated;

create function public.rel_clan_invitation(p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  select jsonb_build_object('id',c.id,'name',c.name,'prefix',c.prefix,'expires_at',i.expires_at) into result
    from rel_private.clan_invites i join rel_private.clans c on c.id=i.clan_id
    where i.token_hash=p_hash and i.expires_at>now() and rel_private.clan_active(c.creator_id);
  if result is null then raise exception 'REL_NOT_FOUND'; end if;
  return result;
end $$;
create function public.rel_public_clans(p_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'prefix',c.prefix,'members',
    (select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'username',a.username,'editor_id',a.editor_id,'is_creator',a.id=c.creator_id) order by a.id=c.creator_id desc,a.username),'[]'::jsonb)
      from rel_private.clan_members m join rel_private.accounts a on a.id=m.user_id
      where m.clan_id=c.id and rel_private.clan_active(a.id))) order by c.name),'[]'::jsonb) into result
    from rel_private.clans c where (p_id is null or c.id=p_id) and rel_private.clan_active(c.creator_id);
  if p_id is not null and result='[]'::jsonb then raise exception 'REL_NOT_FOUND'; end if;
  return jsonb_build_object('clans',result);
end $$;
create function public.rel_clan_prefixes() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  select coalesce(jsonb_object_agg(a.editor_id,jsonb_build_object('id',c.id,'name',c.name,'prefix',c.prefix)),'{}'::jsonb) into result
    from rel_private.clans c join rel_private.clan_members m on m.clan_id=c.id join rel_private.accounts a on a.id=m.user_id
    where a.editor_id is not null and rel_private.clan_active(a.id) and rel_private.clan_active(c.creator_id);
  return jsonb_build_object('prefixes',result);
end $$;
create function public.rel_public_account_clan(p_account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  select jsonb_build_object('id',c.id,'name',c.name,'prefix',c.prefix) into result from rel_private.clans c
    join rel_private.clan_members m on m.clan_id=c.id where m.user_id=p_account
      and rel_private.clan_active(p_account) and rel_private.clan_active(c.creator_id);
  return result;
end $$;
revoke all on function public.rel_clan_invitation(text),public.rel_public_clans(uuid),public.rel_clan_prefixes(),public.rel_public_account_clan(uuid) from public,anon,authenticated;
grant execute on function public.rel_clan_invitation(text),public.rel_public_clans(uuid),public.rel_clan_prefixes(),public.rel_public_account_clan(uuid) to service_role;
notify pgrst,'reload schema';
commit;
