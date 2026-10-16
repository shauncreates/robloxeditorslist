-- Review before applying after both social-connection migrations. No ranking JSON is rewritten.
begin;

alter table rel_private.tiktok_challenges add column audience_counts jsonb;
alter table rel_private.youtube_challenges add column audience_counts jsonb;
alter table rel_private.youtube_challenges add column audience_observed_at timestamptz;
alter table rel_private.tiktok_connections
  add column audience_count bigint check(audience_count between 0 and 9007199254740991),
  add column audience_observed_at timestamptz;
alter table rel_private.youtube_connections
  add column audience_count bigint check(audience_count between 0 and 9007199254740991),
  add column audience_observed_at timestamptz;

create function public.rel_audience_stage(p_platform text,p_state_hash text,p_counts jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare challenge_user uuid; clean jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  if jsonb_typeof(p_counts) is distinct from 'object' or octet_length(p_counts::text)>12000 then raise exception 'REL_INVALID'; end if;
  if exists(select 1 from jsonb_each(p_counts) c where c.value <> 'null'::jsonb and
    (jsonb_typeof(c.value) <> 'number' or c.value::text !~ '^(0|[1-9][0-9]*)$'
      or (c.value::text)::numeric>9007199254740991)) then raise exception 'REL_INVALID'; end if;
  if p_platform='tiktok' then
    select user_id into challenge_user from rel_private.tiktok_challenges
      where state_hash=p_state_hash and consumed and proof is not null and finish_hash is not null
        and audience_counts is null and expires_at>now() for update;
    if not found or (select count(*) from jsonb_object_keys(p_counts))<>1 or not p_counts ? 'followers' then raise exception 'REL_INVALID'; end if;
    update rel_private.tiktok_challenges set audience_counts=p_counts where user_id=challenge_user;
  elsif p_platform='youtube' then
    select c.user_id into challenge_user from rel_private.youtube_challenges c
      where c.state_hash=p_state_hash and c.consumed and c.channels is not null and c.finish_hash is not null
        and c.audience_counts is null and c.expires_at>now() for update;
    if not found then raise exception 'REL_INVALID'; end if;
    select jsonb_object_agg(item->>'id',coalesce(p_counts->(item->>'id'),'null'::jsonb)) into clean
      from rel_private.youtube_challenges c cross join jsonb_array_elements(c.channels) item where c.user_id=challenge_user;
    update rel_private.youtube_challenges set audience_counts=clean,audience_observed_at=now() where user_id=challenge_user;
  else raise exception 'REL_INVALID'; end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.rel_audience_stage(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.rel_audience_stage(text,text,jsonb) to service_role;

create function rel_private.capture_audience() returns trigger
language plpgsql security definer set search_path='' as $$
declare counts jsonb; observed timestamptz; item_key text;
begin
  if tg_table_name='tiktok_connections' then
    select c.audience_counts,c.proven_at into counts,observed from rel_private.tiktok_challenges c
      where c.user_id=new.user_id and c.proof->>'open_id'=new.open_id;
    item_key:='followers';
  else
    select c.audience_counts,c.audience_observed_at into counts,observed from rel_private.youtube_challenges c
      where c.user_id=new.user_id and exists(select 1 from jsonb_array_elements(c.channels) item where item->>'id'=new.channel_id);
    item_key:=new.channel_id;
  end if;
  new.audience_count:=(counts->>item_key)::bigint;
  new.audience_observed_at:=case when new.audience_count is not null then observed else null end;
  return new;
end $$;
revoke all on function rel_private.capture_audience() from public,anon,authenticated;
create trigger rel_tiktok_capture_audience before insert or update of verified_at on rel_private.tiktok_connections
  for each row execute function rel_private.capture_audience();
create trigger rel_youtube_capture_audience before insert or update of verified_at on rel_private.youtube_connections
  for each row execute function rel_private.capture_audience();

create function rel_private.reset_pending_audience() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.audience_counts:=null;
  if tg_table_name='youtube_challenges' then new.audience_observed_at:=null; end if;
  return new;
end $$;
revoke all on function rel_private.reset_pending_audience() from public,anon,authenticated;
create trigger rel_tiktok_reset_audience before insert or update of state_hash on rel_private.tiktok_challenges
  for each row execute function rel_private.reset_pending_audience();
create trigger rel_youtube_reset_audience before insert or update of state_hash on rel_private.youtube_challenges
  for each row execute function rel_private.reset_pending_audience();

create function public.rel_audience_status(p_platform text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; result jsonb; pending jsonb;
begin
  a:=rel_private.context();
  if p_platform='tiktok' then
    select jsonb_build_object('count',audience_count,'observed_at',audience_observed_at) into result
      from rel_private.tiktok_connections where user_id=auth.uid() and expires_at>now();
    select audience_counts into pending from rel_private.tiktok_challenges where user_id=auth.uid()
      and session_id::text=auth.jwt()->>'session_id' and expires_at>now();
  elsif p_platform='youtube' then
    select jsonb_build_object('count',audience_count,'observed_at',audience_observed_at) into result
      from rel_private.youtube_connections where user_id=auth.uid() and checked_at>now()-interval '29 days';
    select audience_counts into pending from rel_private.youtube_challenges where user_id=auth.uid()
      and session_id::text=auth.jwt()->>'session_id' and expires_at>now();
  else raise exception 'REL_INVALID'; end if;
  return jsonb_build_object('connection',result,'pending',pending);
end $$;
revoke all on function public.rel_audience_status(text) from public,anon,authenticated;
grant execute on function public.rel_audience_status(text) to authenticated;

create function public.rel_public_popularity(p_platform text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; site jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  if p_platform not in ('tiktok','youtube') or p_platform is null then raise exception 'REL_INVALID'; end if;
  select data into site from public.roblox_editor_site_data where id='site-data';
  with connections as (
    select c.user_id,c.audience_count,c.audience_observed_at,'https://www.tiktok.com/@'||c.username as channel_url
      from rel_private.tiktok_connections c where p_platform='tiktok' and c.expires_at>now()
    union all
    select c.user_id,c.audience_count,c.audience_observed_at,'https://www.youtube.com/channel/'||c.channel_id
      from rel_private.youtube_connections c where p_platform='youtube' and c.checked_at>now()-interval '2 days'
  ), eligible as (
    select e.item->>'id' as editor_id,e.item->>'name' as name,e.item->>'thumb' as avatar,
      c.channel_url,c.audience_count as audience_count,c.audience_observed_at as observed_at
    from connections c join rel_private.accounts a on a.id=c.user_id join auth.users u on u.id=c.user_id
      cross join jsonb_array_elements(site->'editors') e(item)
    where a.editor_id=e.item->>'id' and (site->'lists'->'main') ? a.editor_id and not a.disabled
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
      and c.audience_count is not null and c.audience_observed_at>now()-interval '29 days'
  ), placed as (
    select *,rank() over(order by audience_count desc) as place from eligible
  ) select coalesce(jsonb_agg(to_jsonb(p) order by audience_count desc,editor_id),'[]'::jsonb) into result from placed p;
  return result;
end $$;
revoke all on function public.rel_public_popularity(text) from public,anon,authenticated;
grant execute on function public.rel_public_popularity(text) to service_role;

create function public.rel_audience_cleanup() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  update rel_private.youtube_connections set audience_count=null,audience_observed_at=null where audience_observed_at<=now()-interval '29 days';
  update rel_private.tiktok_connections set audience_count=null,audience_observed_at=null where audience_observed_at<=now()-interval '29 days';
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.rel_audience_cleanup() from public,anon,authenticated;
grant execute on function public.rel_audience_cleanup() to service_role;
notify pgrst,'reload schema';
commit;
