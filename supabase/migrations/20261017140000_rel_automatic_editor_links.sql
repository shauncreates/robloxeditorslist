begin;

create function rel_private.tiktok_username(p_value text) returns text
language plpgsql immutable set search_path='' as $$
declare value text := lower(btrim(p_value)); matched text[];
begin
  if value ~ '^@?[a-z0-9._]{1,40}$' then return ltrim(value,'@'); end if;
  matched := regexp_match(value,'^https://(www\.)?tiktok\.com/@([a-z0-9._]{1,40})/?([?#][^[:space:]]*)?$');
  return matched[2];
end $$;

create function rel_private.editor_tiktok_username(p_editor jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare primary_name text := rel_private.tiktok_username(p_editor->>'tiktok');
  link_name text := rel_private.tiktok_username(p_editor->'links'->>'tiktok');
begin
  if primary_name is not null and link_name is not null and primary_name<>link_name then return null; end if;
  return coalesce(primary_name,link_name);
end $$;

create table rel_private.application_identity_checks (
  application_id uuid primary key references public.editor_applications(id) on delete cascade,
  status text not null check(status in ('verified','not_connected','different_profile','not_tiktok','unavailable')),
  checked_at timestamptz not null default now()
);
alter table rel_private.application_identity_checks enable row level security;
revoke all on rel_private.application_identity_checks from public,anon,authenticated;

create function rel_private.application_tiktok_check(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare app public.editor_applications; applicant uuid; username text;
begin
  select * into app from public.editor_applications where id=p_id;
  select user_id into applicant from rel_private.application_contacts where application_id=p_id;
  if app.id is null or applicant is null then return 'unavailable'; end if;
  if app.platform<>'TikTok' then return 'not_tiktok'; end if;
  select c.username into username from rel_private.tiktok_connections c
    join rel_private.accounts a on a.id=c.user_id join auth.users u on u.id=a.id
    where c.user_id=applicant and c.expires_at>now() and not a.disabled
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now());
  if username is null then return 'not_connected'; end if;
  if rel_private.tiktok_username(app.profile_url) is distinct from lower(username) then return 'different_profile'; end if;
  return 'verified';
end $$;

create function rel_private.match_tiktok_editor(p_user_id uuid,p_application_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare account rel_private.accounts; username text; candidates text[]; editor text; application_editor text; conflicting_fields boolean;
begin
  perform pg_advisory_xact_lock(63841001);
  select a.* into account from rel_private.accounts a join auth.users u on u.id=a.id
    where a.id=p_user_id and not a.disabled and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()) for update of a;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  if account.editor_id is not null then return jsonb_build_object('status','already_linked','editor_id',account.editor_id); end if;
  select c.username into username from rel_private.tiktok_connections c where c.user_id=p_user_id and c.expires_at>now();
  if username is null then return jsonb_build_object('status','not_connected'); end if;
  if p_application_id is not null then
    select app.listed_editor_id into application_editor from public.editor_applications app
      join rel_private.application_contacts c on c.application_id=app.id
      where app.id=p_application_id and c.user_id=p_user_id and app.status='approved' and app.listed_editor_id is not null
        and not exists(select 1 from rel_private.application_archives ar where ar.application_id=app.id);
    if application_editor is null or rel_private.application_tiktok_check(p_application_id)<>'verified'
      then return jsonb_build_object('status','review_required'); end if;
  end if;
  select array_agg(e->>'id'),bool_or(rel_private.editor_tiktok_username(e) is distinct from lower(username))
    into candidates,conflicting_fields from public.roblox_editor_site_data d
    cross join jsonb_array_elements(d.data->'editors') e
    where d.id='site-data' and (rel_private.tiktok_username(e->>'tiktok')=lower(username)
      or rel_private.tiktok_username(e->'links'->>'tiktok')=lower(username));
  if coalesce(cardinality(candidates),0)=0 then return jsonb_build_object('status','no_match'); end if;
  if cardinality(candidates)<>1 or conflicting_fields then return jsonb_build_object('status','review_required'); end if;
  editor := candidates[1];
  if application_editor is not null and editor<>application_editor then return jsonb_build_object('status','review_required'); end if;
  if exists(select 1 from rel_private.accounts where editor_id=editor and id<>p_user_id)
    or exists(select 1 from rel_private.profile_claims where user_id=p_user_id
      and ((editor_id=editor and status='rejected') or (editor_id<>editor and status='pending')))
    then return jsonb_build_object('status','review_required'); end if;
  update rel_private.accounts set editor_id=editor where id=p_user_id and editor_id is null;
  update rel_private.profile_claims set status='approved',reviewed_by=null
    where user_id=p_user_id and editor_id=editor and status='pending';
  insert into rel_private.audit(actor_id,action,target,details)
    values(auth.uid(),'auto_link_editor',p_user_id::text,jsonb_build_object(
      'account_id',p_user_id,'editor_id',editor,
      'method',case when p_application_id is null then 'tiktok_oauth' else 'approved_application' end,
      'application_id',p_application_id));
  return jsonb_build_object('status','linked','editor_id',editor);
end $$;

alter function rel_private.tiktok(text,text,text) rename to tiktok_before_editor_links;
create function rel_private.tiktok(p_action text,p_state_hash text,p_finish_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_action='match' then
    perform rel_private.context();
    return jsonb_build_object('ok',true,'editor_link',rel_private.match_tiktok_editor(auth.uid()));
  end if;
  result := rel_private.tiktok_before_editor_links(p_action,p_state_hash,p_finish_hash);
  if p_action='finish' then
    result := result || jsonb_build_object('editor_link',rel_private.match_tiktok_editor(auth.uid()));
  end if;
  return result;
end $$;

alter function rel_private.submit_application(uuid,jsonb) rename to submit_application_before_editor_links;
create function rel_private.submit_application(p_request_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; submitted_id uuid; identity_check jsonb;
begin
  result := rel_private.submit_application_before_editor_links(p_request_id,p_data);
  submitted_id := (result->>'id')::uuid;
  if not coalesce((result->>'replayed')::boolean,false) then
    insert into rel_private.application_identity_checks(application_id,status)
      values(submitted_id,rel_private.application_tiktok_check(submitted_id)) on conflict do nothing;
  end if;
  select jsonb_build_object('status',status,'checked_at',checked_at) into identity_check
    from rel_private.application_identity_checks where application_id=submitted_id;
  return result || jsonb_build_object('tiktok_check',identity_check);
end $$;

create function rel_private.application_checks(p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare applications jsonb;
begin
  select coalesce(jsonb_agg(item || jsonb_build_object('tiktok_check',
    case when c.application_id is not null then jsonb_build_object('status',c.status,'checked_at',c.checked_at) end) order by position), '[]'::jsonb)
    into applications from jsonb_array_elements(p_result->'applications') with ordinality as apps(item,position)
    left join rel_private.application_identity_checks c on c.application_id=(item->>'id')::uuid;
  return jsonb_set(p_result,'{applications}',applications);
end $$;

alter function rel_private.review_applications(text,uuid,text,integer,text,text) rename to review_applications_before_editor_links;
create function rel_private.review_applications(p_action text,p_id uuid,p_status text,p_offset integer,p_reason text,p_message text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result := rel_private.review_applications_before_editor_links(p_action,p_id,p_status,p_offset,p_reason,p_message);
  if p_action in ('list','list_reviewed','list_archived') then return rel_private.application_checks(result); end if;
  return result;
end $$;

alter function rel_private.my_applications(integer) rename to my_applications_before_editor_links;
create function rel_private.my_applications(p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  return rel_private.application_checks(rel_private.my_applications_before_editor_links(p_offset));
end $$;

alter function rel_private.pending_editors(text,uuid,uuid) rename to pending_editors_before_editor_links;
create function rel_private.pending_editors(p_action text,p_id uuid,p_revision uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; result jsonb; app public.editor_applications; applicant uuid; previous public.roblox_editor_site_data;
begin
  if p_action='list' then return rel_private.application_checks(rel_private.pending_editors_before_editor_links(p_action,p_id,p_revision)); end if;
  if p_action<>'convert' then return rel_private.pending_editors_before_editor_links(p_action,p_id,p_revision); end if;
  perform pg_advisory_xact_lock(63841001);
  a := rel_private.context();
  if not rel_private.can(a,'list_contributor') then raise exception 'REL_FORBIDDEN'; end if;
  select * into previous from public.roblox_editor_site_data where id='site-data' for update;
  if not found then raise exception 'REL_MISSING_DATA'; end if;
  if p_revision is null or p_revision<>previous.revision then raise exception 'REL_CONFLICT'; end if;
  select * into app from public.editor_applications where id=p_id and status='approved' and listed_editor_id is null for update;
  if not found then raise exception 'REL_NOT_FOUND'; end if;
  if exists(select 1 from rel_private.application_archives where application_id=p_id) then raise exception 'REL_APPLICATION_ARCHIVED'; end if;
  if app.platform='TikTok' and exists(select 1 from jsonb_array_elements(previous.data->'editors') e
    where rel_private.tiktok_username(e->>'tiktok')=rel_private.tiktok_username(app.profile_url)
      or rel_private.tiktok_username(e->'links'->>'tiktok')=rel_private.tiktok_username(app.profile_url))
    then raise exception 'REL_EDITOR_ALREADY_LISTED'; end if;
  result := rel_private.pending_editors_before_editor_links(p_action,p_id,p_revision);
  select user_id into applicant from rel_private.application_contacts where application_id=p_id;
  return result || jsonb_build_object('editor_link',rel_private.match_tiktok_editor(applicant,p_id));
end $$;

revoke all on function rel_private.tiktok_username(text),rel_private.editor_tiktok_username(jsonb),
  rel_private.application_tiktok_check(uuid),rel_private.match_tiktok_editor(uuid,uuid),rel_private.application_checks(jsonb),
  rel_private.tiktok_before_editor_links(text,text,text),rel_private.submit_application_before_editor_links(uuid,jsonb),
  rel_private.review_applications_before_editor_links(text,uuid,text,integer,text,text),rel_private.my_applications_before_editor_links(integer),
  rel_private.pending_editors_before_editor_links(text,uuid,uuid),rel_private.tiktok(text,text,text),
  rel_private.submit_application(uuid,jsonb),rel_private.review_applications(text,uuid,text,integer,text,text),
  rel_private.my_applications(integer),rel_private.pending_editors(text,uuid,uuid) from public,anon,authenticated;
grant execute on function rel_private.tiktok(text,text,text),rel_private.submit_application(uuid,jsonb),
  rel_private.review_applications(text,uuid,text,integer,text,text),rel_private.my_applications(integer),
  rel_private.pending_editors(text,uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
