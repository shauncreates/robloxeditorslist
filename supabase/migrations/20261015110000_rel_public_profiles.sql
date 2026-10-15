-- Review before applying. No ranking JSON, roles or existing profile links are changed.
begin;

create table rel_private.contributor_credits (
  id text primary key,
  display_name text not null,
  contribution text not null,
  position integer not null unique,
  account_id uuid unique references rel_private.accounts(id) on delete set null
);
alter table rel_private.contributor_credits enable row level security;
revoke all on rel_private.contributor_credits from public, anon, authenticated;

-- Preserve the existing homepage credits without guessing who owns an account.
insert into rel_private.contributor_credits(id,display_name,contribution,position) values
  ('seeshaun','@seeshaun','Website owner.',1),
  ('balloond','@balloond','Dev - UI/UX designer.',2),
  ('b-luff','@b.luff','Admin - top list contributor.',3),
  ('maxx-vfxs','@maxx.vfxs','List contributor.',4);

create function rel_private.public_account(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',a.id,'username',a.username,'editor_id',a.editor_id)
  from rel_private.accounts a join auth.users u on u.id=a.id
  where a.id=p_id and not a.disabled and u.email_confirmed_at is not null
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
$$;

create function rel_private.public_contributors() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name,
    'contribution',c.contribution,'account',rel_private.public_account(c.account_id)-'editor_id')
    order by c.position),'[]'::jsonb) from rel_private.contributor_credits c
$$;

create function rel_private.public_profile(p_account uuid default null,p_editor text default null,p_credit text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a jsonb; e jsonb; d jsonb; credits jsonb; credit rel_private.contributor_credits;
begin
  if num_nonnulls(p_account,p_editor,p_credit)<>1 then raise exception 'REL_INVALID'; end if;
  select data into d from public.roblox_editor_site_data where id='site-data';
  if d is null and p_editor is not null then raise exception 'REL_MISSING_DATA'; end if;
  if p_credit is not null then
    select * into credit from rel_private.contributor_credits where id=p_credit;
    if not found then raise exception 'REL_NOT_FOUND'; end if;
    a:=rel_private.public_account(credit.account_id);
  elsif p_account is not null then
    a:=rel_private.public_account(p_account);
    if a is null then raise exception 'REL_NOT_FOUND'; end if;
  else
    select value into e from jsonb_array_elements(d->'editors') where value->>'id'=p_editor;
    if e is null then raise exception 'REL_NOT_FOUND'; end if;
    select rel_private.public_account(id) into a from rel_private.accounts where editor_id=p_editor;
  end if;
  if e is null and a->>'editor_id' is not null then
    if d is null then raise exception 'REL_MISSING_DATA'; end if;
    select value into e from jsonb_array_elements(d->'editors') where value->>'id'=a->>'editor_id';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name,'contribution',c.contribution)
    order by c.position),'[]'::jsonb) into credits from rel_private.contributor_credits c
    where c.account_id=(a->>'id')::uuid or (a is null and c.id=p_credit);
  return jsonb_build_object('account',a-'editor_id','editor',e,'credits',credits,
    'placements',coalesce((select jsonb_agg(jsonb_build_object('key',l.key,'name',
      case when l.key='main' then 'Overall' else coalesce((select s->>'name' from jsonb_array_elements(d->'styles') s where s->>'id'=l.key),l.key) end,
      'rank',r.ordinality) order by case when l.key='main' then 0 else 1 end,l.key)
      from jsonb_each(d->'lists') l cross join lateral jsonb_array_elements_text(l.value) with ordinality r(value,ordinality)
      where r.value=e->>'id'),'[]'::jsonb),
    'styles',coalesce((select jsonb_agg(jsonb_build_object('id',s->>'id','name',s->>'name'))
      from jsonb_array_elements(d->'styles') s where e->'flares' ? (s->>'id')),'[]'::jsonb));
end $$;

create function rel_private.contributor_link(p_user_id uuid,p_credit text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor jsonb; previous text; displaced uuid;
begin
  -- Serialize with permission changes and editor-link verification.
  perform pg_advisory_xact_lock(63841001);
  actor:=rel_private.context();
  if not rel_private.can(actor,'owner') then raise exception 'REL_FORBIDDEN'; end if;
  if not exists(select 1 from rel_private.accounts where id=p_user_id) then raise exception 'REL_NOT_FOUND'; end if;
  if p_credit is not null and rel_private.public_account(p_user_id) is null then raise exception 'REL_INVALID'; end if;
  if p_credit is not null and not exists(select 1 from rel_private.contributor_credits where id=p_credit) then raise exception 'REL_INVALID'; end if;
  select id into previous from rel_private.contributor_credits where account_id=p_user_id;
  select account_id into displaced from rel_private.contributor_credits where id=p_credit;
  update rel_private.contributor_credits set account_id=null where account_id=p_user_id;
  update rel_private.contributor_credits set account_id=p_user_id where id=p_credit;
  insert into rel_private.audit(actor_id,action,target,details) values(auth.uid(),'link_contributor',p_user_id::text,
    jsonb_build_object('actor_username',actor->>'username','previous_credit',previous,'credit',p_credit,'previous_account_id',displaced));
  return jsonb_build_object('ok',true);
end $$;

create function public.rel_public_profile(p_account uuid default null,p_editor text default null,p_credit text default null) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.public_profile(p_account,p_editor,p_credit) $$;
create function public.rel_public_contributors() returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.public_contributors() $$;
create function public.rel_contributor_link(p_user_id uuid,p_credit text default null) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.contributor_link(p_user_id,p_credit) $$;

revoke all on function rel_private.public_account(uuid),rel_private.public_contributors(),rel_private.public_profile(uuid,text,text),
  rel_private.contributor_link(uuid,text),public.rel_public_profile(uuid,text,text),public.rel_public_contributors(),public.rel_contributor_link(uuid,text) from public,anon,authenticated;
grant execute on function rel_private.public_profile(uuid,text,text),rel_private.public_contributors(),public.rel_public_profile(uuid,text,text),public.rel_public_contributors() to service_role;
grant execute on function rel_private.contributor_link(uuid,text),public.rel_contributor_link(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
