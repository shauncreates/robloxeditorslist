-- Requires the public-profiles migration. Existing account links and rankings are preserved.
begin;
alter table rel_private.contributor_credits add column tiers text[] not null default array['rankers']::text[],
  add column hidden boolean not null default false;
update rel_private.contributor_credits set tiers=array[case id when 'seeshaun' then 'owners' when 'balloond' then 'developers' else 'rankers' end];
alter table rel_private.contributor_credits add constraint rel_credit_tiers check (
  cardinality(tiers) between 1 and 4 and tiers <@ array['owners','developers','reviewers','rankers']::text[]);
alter table rel_private.contributor_credits drop constraint contributor_credits_position_key,
  add constraint contributor_credits_position_key unique(position) deferrable initially deferred;
create table rel_private.contributor_settings (
  id boolean primary key default true check(id),
  revision uuid not null default gen_random_uuid()
);
insert into rel_private.contributor_settings(id) values(true);
alter table rel_private.contributor_settings enable row level security;
revoke all on rel_private.contributor_settings from public,anon,authenticated;

create or replace function rel_private.public_contributors() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name,
    'contribution',c.contribution,'tiers',c.tiers,'account',rel_private.public_account(c.account_id)-'editor_id')
    order by c.position),'[]'::jsonb) from rel_private.contributor_credits c where not c.hidden
$$;

alter function rel_private.public_profile(uuid,text,text) rename to public_profile_before_tiers;
revoke all on function rel_private.public_profile_before_tiers(uuid,text,text) from public,anon,authenticated,service_role;
create function rel_private.public_profile(p_account uuid default null,p_editor text default null,p_credit text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; credits jsonb;
begin
  if p_credit is not null and not exists(select 1 from rel_private.contributor_credits where id=p_credit and not hidden)
    then raise exception 'REL_NOT_FOUND'; end if;
  result:=rel_private.public_profile_before_tiers(p_account,p_editor,p_credit);
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name,'contribution',c.contribution,'tiers',c.tiers)
    order by c.position),'[]'::jsonb) into credits from rel_private.contributor_credits c
    where not c.hidden and (c.account_id=(result->'account'->>'id')::uuid or (result->'account'='null'::jsonb and c.id=p_credit));
  return jsonb_set(result,'{credits}',credits);
end $$;
revoke all on function rel_private.public_profile(uuid,text,text) from public,anon,authenticated;
grant execute on function rel_private.public_profile(uuid,text,text) to service_role;

create function rel_private.contributors(p_action text,p_revision uuid default null,p_data jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor jsonb; current_revision uuid; result jsonb; previous jsonb; item jsonb; credit_tiers text[]; pos integer:=0;
begin
  perform pg_advisory_xact_lock(63841001);
  actor:=rel_private.context();
  if not rel_private.can(actor,'owner') then raise exception 'REL_FORBIDDEN'; end if;
  select revision into current_revision from rel_private.contributor_settings where id=true for update;
  if p_action='save' then
    if p_revision is distinct from current_revision then raise exception 'REL_CREDITS_CONFLICT'; end if;
    if p_data is null or jsonb_typeof(p_data)<>'array' then raise exception 'REL_INVALID'; end if;
    if jsonb_array_length(p_data)>100 or octet_length(p_data::text)>80000 then raise exception 'REL_INVALID'; end if;
    if exists(select 1 from rel_private.contributor_credits c where not exists(select 1 from jsonb_array_elements(p_data) v where v->>'id'=c.id))
      then raise exception 'REL_INVALID'; end if;
    if (select count(distinct v->>'id') from jsonb_array_elements(p_data) v)<>jsonb_array_length(p_data) then raise exception 'REL_INVALID'; end if;
    select jsonb_agg(to_jsonb(c) order by position) into previous from rel_private.contributor_credits c;
    for item in select value from jsonb_array_elements(p_data) loop
      if jsonb_typeof(item)<>'object' then raise exception 'REL_INVALID'; end if;
      if not (item ?& array['id','name','contribution','tiers','hidden']) or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','name','contribution','tiers','hidden'))
        then raise exception 'REL_INVALID'; end if;
      if jsonb_typeof(item->'id')<>'string' or (item->>'id') !~ '^[a-z0-9][a-z0-9-]{0,59}$'
        or jsonb_typeof(item->'name')<>'string' or char_length(btrim(item->>'name')) not between 1 and 60
        or jsonb_typeof(item->'contribution')<>'string' or char_length(item->>'contribution')>200
        or jsonb_typeof(item->'hidden')<>'boolean' or jsonb_typeof(item->'tiers')<>'array' then raise exception 'REL_INVALID'; end if;
      select array_agg(value) into credit_tiers from jsonb_array_elements_text(item->'tiers');
      if credit_tiers is null or cardinality(credit_tiers) not between 1 and 4 or not (credit_tiers <@ array['owners','developers','reviewers','rankers']::text[])
        or cardinality(credit_tiers)<>(select count(distinct t) from unnest(credit_tiers) t) then raise exception 'REL_INVALID'; end if;
      pos:=pos+1;
      insert into rel_private.contributor_credits(id,display_name,contribution,position,tiers,hidden)
        values(item->>'id',btrim(item->>'name'),btrim(item->>'contribution'),pos,credit_tiers,(item->>'hidden')::boolean)
        on conflict(id) do update set display_name=excluded.display_name,contribution=excluded.contribution,
          position=excluded.position,tiers=excluded.tiers,hidden=excluded.hidden;
    end loop;
    update rel_private.contributor_settings set revision=gen_random_uuid() where id=true returning revision into current_revision;
    insert into rel_private.audit(actor_id,action,target,details) values(auth.uid(),'save_contributors','contributors',
      jsonb_build_object('actor_username',actor->>'username','previous',previous,'credits',p_data));
  elsif p_action<>'list' or p_action is null then raise exception 'REL_INVALID'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name,'contribution',c.contribution,
    'tiers',c.tiers,'hidden',c.hidden,'account',case when a.id is not null then jsonb_build_object('id',a.id,'username',a.username) else null end)
    order by c.position),'[]'::jsonb) into result from rel_private.contributor_credits c left join rel_private.accounts a on a.id=c.account_id;
  return jsonb_build_object('credits',result,'revision',current_revision);
end $$;
create function public.rel_contributors(p_action text,p_revision uuid default null,p_data jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$ select rel_private.contributors(p_action,p_revision,p_data) $$;
revoke all on function rel_private.contributors(text,uuid,jsonb),public.rel_contributors(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function rel_private.contributors(text,uuid,jsonb),public.rel_contributors(text,uuid,jsonb) to authenticated;

-- Account-link changes invalidate open contributor drafts as well.
alter function rel_private.contributor_link(uuid,text) rename to contributor_link_before_tiers;
revoke all on function rel_private.contributor_link_before_tiers(uuid,text) from public,anon,authenticated;
create function rel_private.contributor_link(p_user_id uuid,p_credit text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=rel_private.contributor_link_before_tiers(p_user_id,p_credit);
  update rel_private.contributor_settings set revision=gen_random_uuid() where id=true;
  return result;
end $$;
revoke all on function rel_private.contributor_link(uuid,text) from public,anon,authenticated;
grant execute on function rel_private.contributor_link(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
