-- Apply only after the existing Auth/roles setup. Not applied to the live project.
-- Existing editors, ranking JSON and application statuses are not rewritten.
begin;

-- The live Stage-1 table uses older names; renames preserve submitted values.
do $$
declare legacy_name text; current_name text;
begin
  for legacy_name, current_name in
    select * from (values ('main_platform','platform'), ('main_platform_url','profile_url'), ('editing_styles','styles')) names(legacy_name,current_name)
  loop
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='editor_applications' and column_name=legacy_name) then
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='editor_applications' and column_name=current_name) then
        raise exception 'REL_AMBIGUOUS_APPLICATION_COLUMNS: % and %', legacy_name, current_name;
      end if;
      execute format('alter table public.editor_applications rename column %I to %I', legacy_name, current_name);
    end if;
  end loop;
end $$;

alter table public.editor_applications
  add column if not exists notes text check (notes is null or char_length(notes) <= 1000),
  add column if not exists reviewed_at timestamptz;

alter table public.editor_applications
  add column listed_editor_id text,
  add column review_reason text check (review_reason is null or char_length(review_reason) <= 1000),
  add column reviewed_by uuid references auth.users(id) on delete set null;

alter table public.editor_applications drop constraint if exists editor_applications_styles_check;
alter table public.editor_applications add constraint editor_applications_styles_check
  check (cardinality(styles) between 1 and 31);

create function rel_private.applications(p_action text, p_id uuid, p_status text, p_offset integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; result jsonb; reason text;
begin
  perform pg_advisory_xact_lock(63841001);
  a := rel_private.context();
  if not rel_private.can(a, 'application_reviewer') then raise exception 'REL_FORBIDDEN'; end if;
  if p_action = 'list' then
    if p_offset is null or p_offset not between 0 and 1000000 then raise exception 'REL_INVALID'; end if;
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into result from
      (select * from public.editor_applications order by created_at desc, id limit 50 offset p_offset) t;
    return jsonb_build_object('applications', result, 'total', (select count(*) from public.editor_applications));
  elsif p_action = 'update' then
    if p_status is null or p_status not in ('pending','approved','rejected')
      or char_length(coalesce(p_reason, '')) > 1000 then raise exception 'REL_INVALID'; end if;
    reason := case when p_status = 'pending' then null else nullif(btrim(p_reason), '') end;
    if exists(select 1 from public.editor_applications where id=p_id and listed_editor_id is not null) then raise exception 'REL_APPLICATION_LISTED'; end if;
    update public.editor_applications set status = p_status, review_reason = reason,
      reviewed_by = case when p_status = 'pending' then null else auth.uid() end,
      reviewed_at = case when p_status = 'pending' then null else now() end where id = p_id;
    if not found then raise exception 'REL_NOT_FOUND'; end if;
    insert into rel_private.audit(actor_id, action, target, details)
      values(auth.uid(), 'review_application', p_id::text, jsonb_build_object('status',p_status,'reason',reason));
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'REL_INVALID';
end $$;

-- Preserve the previous checked RPC signature for clients during cutover.
create or replace function rel_private.applications(p_action text, p_id uuid default null, p_status text default null, p_offset integer default 0) returns jsonb
language sql security definer set search_path = '' as $$
  select rel_private.applications(p_action, p_id, p_status, p_offset, null)
$$;
create function public.rel_applications(p_action text, p_id uuid, p_status text, p_offset integer, p_reason text) returns jsonb
language sql security invoker set search_path = '' as $$
  select rel_private.applications(p_action, p_id, p_status, p_offset, p_reason)
$$;
revoke all on function rel_private.applications(text,uuid,text,integer,text) from public, anon, authenticated;
revoke all on function public.rel_applications(text,uuid,text,integer,text) from public, anon, authenticated;
grant execute on function rel_private.applications(text,uuid,text,integer,text), public.rel_applications(text,uuid,text,integer,text) to authenticated;

create function rel_private.pending_editors(p_action text, p_id uuid, p_revision uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; result jsonb; application public.editor_applications;
  previous public.roblox_editor_site_data; next_data jsonb; editor jsonb;
  editor_id text; next_revision uuid; style_id text; flare_ids text[]; profile_links jsonb;
begin
  perform pg_advisory_xact_lock(63841001);
  a := rel_private.context();
  if not rel_private.can(a, 'list_contributor') then raise exception 'REL_FORBIDDEN'; end if;
  if p_action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into result from
      (select id,display_name,platform,profile_url,software,styles,examples_url,review_reason
       from public.editor_applications where status = 'approved' and listed_editor_id is null
       order by reviewed_at, id limit 300) t;
    return jsonb_build_object('applications',result,'total',
      (select count(*) from public.editor_applications where status = 'approved' and listed_editor_id is null));
  elsif p_action = 'convert' then
    select * into previous from public.roblox_editor_site_data where id = 'site-data' for update;
    if not found then raise exception 'REL_MISSING_DATA'; end if;
    if p_revision is null or p_revision <> previous.revision then raise exception 'REL_CONFLICT'; end if;
    select * into application from public.editor_applications where id = p_id and status = 'approved' and listed_editor_id is null for update;
    if not found then raise exception 'REL_NOT_FOUND'; end if;
    editor_id := 'application-' || application.id::text;
    if exists (select 1 from jsonb_array_elements(previous.data->'editors') e where e->>'id' = editor_id) then raise exception 'REL_INVALID'; end if;
    select coalesce(array_agg(s->>'id'),array[]::text[]) into flare_ids
      from jsonb_array_elements(previous.data->'styles') s
      where s->>'name' = any(application.styles) or ('Other: ' || (s->>'name')) = any(application.styles);
    profile_links := case when application.platform = 'YouTube' then jsonb_build_object('youtube',application.profile_url) else '{}'::jsonb end;
    editor := jsonb_build_object('id',editor_id,'name',application.display_name,'handle','',
      'tiktok',case when application.platform = 'TikTok' then coalesce(substring(application.profile_url from '@([A-Za-z0-9._]{1,40})'),'') else '' end,
      'software',application.software,'flares',to_jsonb(flare_ids),'note','','thumb','','video','', 'links',profile_links);
    -- Submission notes and review reasons stay private during profile conversion.
    next_data := jsonb_set(previous.data,array['editors'],previous.data->'editors' || jsonb_build_array(editor));
    next_data := jsonb_set(next_data,array['lists','main'],previous.data->'lists'->'main' || jsonb_build_array(editor_id));
    foreach style_id in array flare_ids loop
      next_data := jsonb_set(next_data,array['lists',style_id],coalesce(next_data->'lists'->style_id,'[]'::jsonb) || jsonb_build_array(editor_id));
    end loop;
    if not rel_private.validate_data(next_data) then raise exception 'REL_INVALID'; end if;
    insert into rel_private.data_history(revision,data,actor_id) values(previous.revision,previous.data,auth.uid());
    next_revision := gen_random_uuid();
    update public.roblox_editor_site_data set data = next_data, revision = next_revision, updated_at = now() where id = 'site-data';
    update public.editor_applications set listed_editor_id = editor_id where id = p_id;
    insert into rel_private.audit(actor_id,action,target,details)
      values(auth.uid(),'convert_application',p_id::text,jsonb_build_object('editor_id',editor_id));
    return jsonb_build_object('ok',true,'editor_id',editor_id,'revision',next_revision);
  end if;
  raise exception 'REL_INVALID';
end $$;
create function public.rel_pending_editors(p_action text, p_id uuid, p_revision uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.pending_editors(p_action,p_id,p_revision) $$;
revoke all on function rel_private.pending_editors(text,uuid,uuid),public.rel_pending_editors(text,uuid,uuid) from public,anon,authenticated;
grant execute on function rel_private.pending_editors(text,uuid,uuid),public.rel_pending_editors(text,uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
