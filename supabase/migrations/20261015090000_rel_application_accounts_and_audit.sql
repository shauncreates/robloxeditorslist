-- Requires all existing REL account/application migrations. Review before applying.
-- No ranking data, existing decisions or editor profiles are rewritten.
begin;

create table rel_private.application_contacts (
  application_id uuid primary key references public.editor_applications(id),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  request_id uuid not null,
  unique(user_id,request_id)
);
create table rel_private.application_archives (
  application_id uuid primary key references public.editor_applications(id),
  archived_by uuid references auth.users(id) on delete set null,
  archived_username text not null,
  archived_at timestamptz not null default now()
);
create table rel_private.application_email_outbox (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.editor_applications(id),
  kind text not null check (kind in ('submitted','approved','rejected')),
  recipient text not null,
  reason text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  lease uuid,
  last_error text,
  unique(application_id,kind)
);
alter table rel_private.application_contacts enable row level security;
alter table rel_private.application_archives enable row level security;
alter table rel_private.application_email_outbox enable row level security;
create index rel_application_email_pending on rel_private.application_email_outbox(next_attempt_at,created_at) where delivered_at is null;
create index rel_audit_activity on rel_private.audit(created_at desc,id desc);
revoke all on rel_private.application_contacts,rel_private.application_archives,rel_private.application_email_outbox from public,anon,authenticated;
revoke insert on public.editor_applications from service_role;

alter table rel_private.audit add column actor_username text;
create function rel_private.audit_actor() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.actor_username := (select username from rel_private.accounts where id=new.actor_id);
  return new;
end $$;
create trigger rel_audit_actor before insert on rel_private.audit
for each row execute function rel_private.audit_actor();

create function rel_private.rank_changes() returns trigger
language plpgsql security definer set search_path='' as $$
declare changes jsonb;
begin
  if old.data->'lists' is not distinct from new.data->'lists' then return new; end if;
  with before_ranks as (
    select l.key as list_id,e.value #>> '{}' as editor_id,e.ordinality as position
    from jsonb_each(old.data->'lists') l cross join lateral jsonb_array_elements(l.value) with ordinality e
  ), after_ranks as (
    select l.key as list_id,e.value #>> '{}' as editor_id,e.ordinality as position
    from jsonb_each(new.data->'lists') l cross join lateral jsonb_array_elements(l.value) with ordinality e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'list_id',coalesce(b.list_id,a.list_id),
    'editor_id',coalesce(b.editor_id,a.editor_id),
    'editor_name',coalesce((select e->>'name' from jsonb_array_elements(new.data->'editors') e where e->>'id'=coalesce(b.editor_id,a.editor_id)),
      (select e->>'name' from jsonb_array_elements(old.data->'editors') e where e->>'id'=coalesce(b.editor_id,a.editor_id))),
    'from_rank',b.position,'to_rank',a.position
  ) order by coalesce(b.list_id,a.list_id),coalesce(a.position,b.position)),'[]'::jsonb) into changes
  from before_ranks b full join after_ranks a using(list_id,editor_id)
  where b.position is distinct from a.position;
  insert into rel_private.audit(actor_id,action,target,details)
    values(auth.uid(),'rank_change','site-data',jsonb_build_object('previous_revision',old.revision,'revision',new.revision,'changes',changes));
  return new;
end $$;
create trigger rel_rank_changes after update of data on public.roblox_editor_site_data
for each row execute function rel_private.rank_changes();

create function rel_private.queue_application_email(p_id uuid,p_kind text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into rel_private.application_email_outbox(application_id,kind,recipient,reason)
    select p_id,p_kind,email,p_reason from rel_private.application_contacts where application_id=p_id
    on conflict(application_id,kind) do nothing;
end $$;
create function rel_private.application_decision_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='pending' and new.status in ('approved','rejected') then
    perform rel_private.queue_application_email(new.id,new.status,new.review_reason);
  end if;
  return new;
end $$;
create trigger rel_application_decision_email after update of status on public.editor_applications
for each row execute function rel_private.application_decision_email();

create function rel_private.submit_application(p_request_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; application_id uuid; email text; styles text[]; site jsonb; platform text; profile text;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  if p_request_id is null then raise exception 'REL_INVALID'; end if;
  select c.application_id into application_id from rel_private.application_contacts c
    where c.user_id=auth.uid() and c.request_id=p_request_id;
  if found then return jsonb_build_object('ok',true,'id',application_id,'replayed',true); end if;
  if exists(select 1 from rel_private.application_contacts c join public.editor_applications app on app.id=c.application_id
    where c.user_id=auth.uid() and app.status='pending' and not exists(select 1 from rel_private.application_archives ar where ar.application_id=app.id))
    then raise exception 'REL_APPLICATION_PENDING'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then raise exception 'REL_INVALID'; end if;
  if jsonb_typeof(p_data->'styles') is distinct from 'array' then raise exception 'REL_INVALID'; end if;
  if jsonb_array_length(p_data->'styles') not between 1 and 31 then raise exception 'REL_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(p_data->'styles') s where jsonb_typeof(s)<>'string') then raise exception 'REL_INVALID'; end if;
  select array_agg(distinct s) into styles from jsonb_array_elements_text(p_data->'styles') s;
  select data into site from public.roblox_editor_site_data where id='site-data';
  if site is null then raise exception 'REL_MISSING_DATA'; end if;
  if exists(select 1 from unnest(styles) s where not exists(select 1 from jsonb_array_elements(site->'styles') v where v->>'name'=s)
    and not (s ~ '^Other: .{1,80}$' and btrim(substring(s from 8))<>'')) then raise exception 'REL_INVALID'; end if;
  platform:=p_data->>'platform'; profile:=btrim(p_data->>'profile_url');
  if jsonb_typeof(p_data->'display_name') is distinct from 'string' or char_length(btrim(p_data->>'display_name')) not between 2 and 50
    or jsonb_typeof(p_data->'software') is distinct from 'string' or char_length(btrim(p_data->>'software')) not between 2 and 120
    or jsonb_typeof(p_data->'profile_url') is distinct from 'string'
    or profile !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$'
    or platform is null or platform not in ('TikTok','YouTube')
    or (platform='TikTok' and lower(profile) !~ '^https://([a-z0-9-]+\.)*tiktok\.com(:[0-9]+)?([/?#]|$)')
    or (platform='YouTube' and lower(profile) !~ '^https://(([a-z0-9-]+\.)*youtube\.com|youtu\.be)(:[0-9]+)?([/?#]|$)')
    or jsonb_typeof(p_data->'examples_url') is distinct from 'string'
    or (p_data->>'examples_url') !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$'
    or (p_data ? 'notes' and p_data->'notes'<>'null'::jsonb and (jsonb_typeof(p_data->'notes')<>'string' or char_length(p_data->>'notes')>1000))
    then raise exception 'REL_INVALID'; end if;
  select u.email into email from auth.users u where u.id=auth.uid();
  if email is null then raise exception 'REL_UNAUTHENTICATED'; end if;
  insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url,notes)
    values(btrim(p_data->>'display_name'),platform,profile,btrim(p_data->>'software'),styles,p_data->>'examples_url',nullif(btrim(p_data->>'notes'),''))
    returning id into application_id;
  insert into rel_private.application_contacts(application_id,user_id,email,request_id) values(application_id,auth.uid(),email,p_request_id);
  perform rel_private.queue_application_email(application_id,'submitted');
  insert into rel_private.audit(actor_id,action,target) values(auth.uid(),'submit_application',application_id::text);
  return jsonb_build_object('ok',true,'id',application_id,'replayed',false);
end $$;
create function public.rel_submit_application(p_request_id uuid,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select rel_private.submit_application(p_request_id,p_data) $$;

alter function rel_private.applications(text,uuid,text,integer,text) rename to applications_before_archives;
create function rel_private.applications(p_action text,p_id uuid,p_status text,p_offset integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; result jsonb; total bigint;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  if not rel_private.can(a,'application_reviewer') then raise exception 'REL_FORBIDDEN'; end if;
  if p_action in ('list','list_reviewed','list_archived') then
    if p_action<>'list' and not rel_private.can(a,'owner') then raise exception 'REL_FORBIDDEN'; end if;
    if p_offset is null or p_offset not between 0 and 1000000 then raise exception 'REL_INVALID'; end if;
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (
      select app.*,ar.archived_at,ar.archived_username from public.editor_applications app
      left join rel_private.application_archives ar on ar.application_id=app.id
      where case p_action when 'list_archived' then ar.application_id is not null
        when 'list_reviewed' then ar.application_id is null and app.status<>'pending'
        else ar.application_id is null and app.status='pending' end
      order by app.created_at desc,app.id limit 50 offset p_offset
    ) t;
    select count(*) into total from public.editor_applications app left join rel_private.application_archives ar on ar.application_id=app.id
      where case p_action when 'list_archived' then ar.application_id is not null
        when 'list_reviewed' then ar.application_id is null and app.status<>'pending'
        else ar.application_id is null and app.status='pending' end;
    return jsonb_build_object('applications',result,'total',total);
  elsif p_action='archive' then
    if not rel_private.can(a,'owner') then raise exception 'REL_FORBIDDEN'; end if;
    if not exists(select 1 from public.editor_applications where id=p_id) then raise exception 'REL_NOT_FOUND'; end if;
    insert into rel_private.application_archives(application_id,archived_by,archived_username) values(p_id,auth.uid(),a->>'username')
      on conflict(application_id) do nothing;
    if found then insert into rel_private.audit(actor_id,action,target) values(auth.uid(),'archive_application',p_id::text); end if;
    return jsonb_build_object('ok',true);
  end if;
  if exists(select 1 from rel_private.application_archives where application_id=p_id) then raise exception 'REL_APPLICATION_ARCHIVED'; end if;
  result:=rel_private.applications_before_archives(p_action,p_id,p_status,p_offset,p_reason);
  return result || jsonb_build_object('notification_expected',exists(select 1 from rel_private.application_contacts where application_id=p_id));
end $$;
revoke all on function rel_private.applications_before_archives(text,uuid,text,integer,text) from public,anon,authenticated;

alter function rel_private.pending_editors(text,uuid,uuid) rename to pending_editors_before_archives;
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
  return rel_private.pending_editors_before_archives(p_action,p_id,p_revision);
end $$;
revoke all on function rel_private.pending_editors_before_archives(text,uuid,uuid) from public,anon,authenticated;

create function rel_private.activity(p_kind text,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; result jsonb; total bigint; notifications jsonb;
begin
  a:=rel_private.context();
  if not rel_private.can(a,'owner') then raise exception 'REL_FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('all','rankings','applications') or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'REL_INVALID'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (
    select * from rel_private.audit where
      case p_kind when 'rankings' then action in ('rank_change','save_rankings','convert_application')
      when 'applications' then action in ('submit_application','review_application','archive_application','convert_application')
      else action in ('rank_change','save_rankings','submit_application','review_application','archive_application','convert_application') end
    order by created_at desc,id desc limit 50 offset p_offset
  ) t;
  select count(*) into total from rel_private.audit where
    case p_kind when 'rankings' then action in ('rank_change','save_rankings','convert_application')
    when 'applications' then action in ('submit_application','review_application','archive_application','convert_application')
    else action in ('rank_change','save_rankings','submit_application','review_application','archive_application','convert_application') end;
  select jsonb_build_object('queued',count(*) filter(where delivered_at is null),
    'failed',count(*) filter(where delivered_at is null and last_error is not null),
    'sent',count(*) filter(where delivered_at is not null)) into notifications from rel_private.application_email_outbox;
  return jsonb_build_object('events',result,'total',total,'notifications',notifications);
end $$;
create function public.rel_activity(p_kind text default 'all',p_offset integer default 0) returns jsonb
language sql security invoker set search_path='' as $$ select rel_private.activity(p_kind,p_offset) $$;

create function rel_private.email_work(p_action text,p_application_id uuid,p_id uuid,p_lease uuid,p_error text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare work rel_private.application_email_outbox;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'REL_FORBIDDEN'; end if;
  if p_action='claim' then
    select * into work from rel_private.application_email_outbox e
      where delivered_at is null and next_attempt_at<=now() and (locked_until is null or locked_until<now())
      and (p_application_id is null or application_id=p_application_id)
      and not exists(select 1 from rel_private.application_email_outbox earlier where earlier.application_id=e.application_id
        and earlier.kind='submitted' and e.kind<>'submitted' and earlier.delivered_at is null)
      order by created_at,id limit 1 for update skip locked;
    if not found then return null; end if;
    update rel_private.application_email_outbox set attempts=attempts+1,locked_until=now()+interval '5 minutes',lease=gen_random_uuid()
      where id=work.id returning * into work;
    return jsonb_build_object('id',work.id,'lease',work.lease,'recipient',work.recipient,'kind',work.kind,'reason',work.reason);
  elsif p_action='sent' then
    update rel_private.application_email_outbox set delivered_at=now(),locked_until=null,lease=null,last_error=null
      where id=p_id and lease=p_lease and delivered_at is null;
  elsif p_action='failed' then
    if p_error is null or p_error not in ('provider_unavailable','provider_rejected') then raise exception 'REL_INVALID'; end if;
    update rel_private.application_email_outbox set locked_until=null,lease=null,last_error=p_error,
      next_attempt_at=now()+least(3600,power(2,least(attempts,6))::integer*30)*interval '1 second'
      where id=p_id and lease=p_lease and delivered_at is null;
  else raise exception 'REL_INVALID'; end if;
  return jsonb_build_object('ok',found);
end $$;
create function public.rel_email_work(p_action text,p_application_id uuid default null,p_id uuid default null,p_lease uuid default null,p_error text default null) returns jsonb
language sql security invoker set search_path='' as $$ select rel_private.email_work(p_action,p_application_id,p_id,p_lease,p_error) $$;

revoke all on function rel_private.audit_actor(),rel_private.rank_changes(),rel_private.queue_application_email(uuid,text,text),
  rel_private.application_decision_email(),rel_private.submit_application(uuid,jsonb),public.rel_submit_application(uuid,jsonb),
  rel_private.applications(text,uuid,text,integer,text),rel_private.pending_editors(text,uuid,uuid),
  rel_private.activity(text,integer),public.rel_activity(text,integer),
  rel_private.email_work(text,uuid,uuid,uuid,text),public.rel_email_work(text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function rel_private.submit_application(uuid,jsonb),public.rel_submit_application(uuid,jsonb),
  rel_private.applications(text,uuid,text,integer,text),rel_private.pending_editors(text,uuid,uuid),
  rel_private.activity(text,integer),public.rel_activity(text,integer) to authenticated;
grant execute on function rel_private.email_work(text,uuid,uuid,uuid,text),public.rel_email_work(text,uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
