-- Review before applying. Existing editor JSON and rankings are not rewritten.
begin;

create or replace function rel_private.validate_profile(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  for k, v in select * from jsonb_each(p) loop
    if k not in ('name','handle','tiktok','note','thumb','video','links','software','main_platform') then return false; end if;
    if k = 'links' then
      if jsonb_typeof(v) is distinct from 'object' then return false; end if;
      if exists (select 1 from jsonb_each(v) l where l.key not in ('youtube','instagram','twitter','discord','tiktok')
        or jsonb_typeof(l.value) is distinct from 'string' or char_length(l.value #>> '{}') > 2000
        or ((l.value #>> '{}') <> '' and (l.value #>> '{}') !~ '^https://[^/@[:space:]]+([/?#]|$)')) then return false; end if;
    else
      if jsonb_typeof(v) is distinct from 'string' then return false; end if;
      if k = 'main_platform' and (v #>> '{}') not in ('TikTok','YouTube') then return false; end if;
      if char_length(v #>> '{}') > (case when k in ('note','thumb','video') then 2000 else 120 end) then return false; end if;
      if k = 'name' and char_length(btrim(v #>> '{}')) < 1 then return false; end if;
      if k in ('thumb','video') and (v #>> '{}') <> '' and (v #>> '{}') !~ '^https://[^/@[:space:]]+([/?#]|$)' then return false; end if;
    end if;
  end loop;
  return true;
end $$;

create or replace function rel_private.validate_data(d jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare e jsonb; s jsonb; l jsonb; k text; ids text[]; style_ids text[];
begin
  if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'site') is distinct from 'object'
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
    if e ? 'main_platform' and (jsonb_typeof(e->'main_platform') is distinct from 'string'
      or e->>'main_platform' not in ('TikTok','YouTube')) then return false; end if;
    if e ? 'flares' then
      if jsonb_typeof(e->'flares') is distinct from 'array' then return false; end if;
      if exists (select 1 from jsonb_array_elements(e->'flares') f where jsonb_typeof(f) is distinct from 'string' or not ((f #>> '{}') = any(style_ids))) then return false; end if;
    end if;
  end loop;
  if jsonb_typeof(d->'lists'->'main') is distinct from 'array' then return false; end if;
  for k, l in select * from jsonb_each(d->'lists') loop
    if k <> 'main' and not (k = any(style_ids)) then return false; end if;
    if jsonb_typeof(l) is distinct from 'array' then return false; end if;
    if exists (select 1 from jsonb_array_elements(l) v where jsonb_typeof(v) is distinct from 'string' or not ((v #>> '{}') = any(ids))) then return false; end if;
    if (select count(distinct v) from jsonb_array_elements(l) v) <> jsonb_array_length(l) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function rel_private.pending_editors(p_action text, p_id uuid, p_revision uuid) returns jsonb
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
      'main_platform',application.platform,
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

notify pgrst, 'reload schema';
commit;
