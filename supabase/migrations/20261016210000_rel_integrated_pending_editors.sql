-- Requires application tracking and editor main-platform migrations. Does not rewrite rankings.
begin;

alter function rel_private.pending_editors(text,uuid,uuid) rename to pending_editors_with_platform;
create function rel_private.pending_editors(p_action text,p_id uuid,p_revision uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; result jsonb; total bigint;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  if not rel_private.can(a,'list_contributor') then raise exception 'REL_FORBIDDEN'; end if;
  if p_action='list' then
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (
      select id,display_name,platform,profile_url,software,styles,examples_url,review_reason from public.editor_applications app
      where status='approved' and listed_editor_id is null and not exists(select 1 from rel_private.application_archives ar where ar.application_id=app.id)
      order by reviewed_at,id limit 300
    ) t;
    select count(*) into total from public.editor_applications app where status='approved' and listed_editor_id is null
      and not exists(select 1 from rel_private.application_archives ar where ar.application_id=app.id);
    return jsonb_build_object('applications',result,'total',total);
  end if;
  if exists(select 1 from rel_private.application_archives where application_id=p_id) then raise exception 'REL_APPLICATION_ARCHIVED'; end if;
  return rel_private.pending_editors_with_platform(p_action,p_id,p_revision);
end $$;

revoke all on function rel_private.pending_editors(text,uuid,uuid),rel_private.pending_editors_with_platform(text,uuid,uuid) from public,anon,authenticated;
grant execute on function rel_private.pending_editors(text,uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
