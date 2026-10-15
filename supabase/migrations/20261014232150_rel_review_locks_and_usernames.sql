-- Requires Auth/roles and the application-review migration. Not applied remotely.
-- Adds private account names; existing submissions and ranking JSON are untouched.
begin;

alter table rel_private.accounts add column username text not null
  default ('member-' || replace(gen_random_uuid()::text,'-',''))
  unique check (username ~ '^[a-z0-9][a-z0-9_-]{2,39}$');
alter table public.editor_applications add column reviewer_username text;

create table rel_private.application_decisions (
  application_id uuid primary key references public.editor_applications(id),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewer_username text not null,
  status text not null check (status in ('approved','rejected')),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000 and reason ~ '[^[:space:]]'),
  decided_at timestamptz not null
);
alter table rel_private.application_decisions enable row level security;
revoke all on rel_private.application_decisions from public,anon,authenticated;

create or replace function rel_private.context() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a rel_private.accounts;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
      and (s.not_after is null or s.not_after>now())
      and u.email_confirmed_at is not null and coalesce(u.is_anonymous,false)=false
      and (u.banned_until is null or u.banned_until<=now())
  ) then raise exception 'REL_UNAUTHENTICATED'; end if;
  select * into a from rel_private.accounts where id=auth.uid();
  if not found or a.disabled then raise exception 'REL_FORBIDDEN'; end if;
  return jsonb_build_object('id',a.id,'username',a.username,'roles',a.roles,'editor_id',a.editor_id,
    'claim_status',(select status from rel_private.profile_claims where user_id=auth.uid()));
end $$;

create function rel_private.username(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; name text;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  name:=lower(btrim(p_username));
  if name is null or name !~ '^[a-z0-9][a-z0-9_-]{2,39}$' then raise exception 'REL_INVALID_USERNAME'; end if;
  update rel_private.accounts set username=name where id=auth.uid();
  insert into rel_private.audit(actor_id,action,target,details)
    values(auth.uid(),'change_username',auth.uid()::text,jsonb_build_object('previous',a->>'username','username',name));
  return jsonb_build_object('username',name);
exception when unique_violation then raise exception 'REL_USERNAME_TAKEN';
end $$;
create function public.rel_username(p_username text) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.username(p_username) $$;
revoke all on function rel_private.username(text),public.rel_username(text) from public,anon,authenticated;
grant execute on function rel_private.username(text),public.rel_username(text) to authenticated;

create function rel_private.lock_application_decision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then
    if old.status in ('approved','rejected') then raise exception 'REL_APPLICATION_LOCKED'; end if;
    return old;
  elsif tg_op='INSERT' then
    if new.status<>'pending' then raise exception 'REL_APPLICATION_LOCKED'; end if;
  elsif old.status in ('approved','rejected') then
    if (to_jsonb(new)-array['listed_editor_id','reviewed_by']) is distinct from (to_jsonb(old)-array['listed_editor_id','reviewed_by'])
      or (new.reviewed_by is distinct from old.reviewed_by and not
        (new.reviewed_by is null and not exists(select 1 from auth.users where id=old.reviewed_by)))
    then raise exception 'REL_APPLICATION_LOCKED'; end if;
    return new;
  end if;
  return new;
end $$;
revoke all on function rel_private.lock_application_decision() from public,anon,authenticated;
create trigger rel_lock_application_decision before insert or update or delete on public.editor_applications
for each row execute function rel_private.lock_application_decision();

create or replace function rel_private.applications(p_action text,p_id uuid,p_status text,p_offset integer,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; result jsonb; reason text; application public.editor_applications;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  if not rel_private.can(a,'application_reviewer') then raise exception 'REL_FORBIDDEN'; end if;
  if p_action='list' then
    if p_offset is null or p_offset not between 0 and 1000000 then raise exception 'REL_INVALID'; end if;
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
      (select app.*,coalesce(app.reviewer_username,ac.username) as reviewer_display
       from public.editor_applications app left join rel_private.accounts ac on ac.id=app.reviewed_by
       order by app.created_at desc,app.id limit 50 offset p_offset) t;
    return jsonb_build_object('applications',result,'total',(select count(*) from public.editor_applications));
  elsif p_action='update' then
    select * into application from public.editor_applications where id=p_id for update;
    if not found then raise exception 'REL_NOT_FOUND'; end if;
    if application.listed_editor_id is not null then raise exception 'REL_APPLICATION_LISTED'; end if;
    if application.status<>'pending' then raise exception 'REL_APPLICATION_LOCKED'; end if;
    if p_status is null or p_status not in ('approved','rejected') then raise exception 'REL_INVALID'; end if;
    reason:=nullif(btrim(p_reason),'');
    if reason is null or reason !~ '[^[:space:]]' or char_length(reason)>1000 then raise exception 'REL_REASON_REQUIRED'; end if;
    update public.editor_applications set status=p_status,review_reason=reason,reviewed_by=auth.uid(),
      reviewer_username=a->>'username',reviewed_at=now() where id=p_id returning * into application;
    insert into rel_private.application_decisions(application_id,reviewer_id,reviewer_username,status,reason,decided_at)
      values(p_id,auth.uid(),a->>'username',p_status,reason,application.reviewed_at);
    insert into rel_private.audit(actor_id,action,target,details)
      values(auth.uid(),'review_application',p_id::text,jsonb_build_object('status',p_status,'reason',reason,'reviewer_username',a->>'username'));
    return jsonb_build_object('ok',true,'application',to_jsonb(application));
  end if;
  raise exception 'REL_INVALID';
end $$;

create or replace function rel_private.users(p_action text,p_user_id uuid default null,p_roles text[] default null,
  p_editor_id text default null,p_disabled boolean default false,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; target rel_private.accounts; result jsonb; claim_row rel_private.profile_claims;
begin
  perform pg_advisory_xact_lock(63841001);
  a:=rel_private.context();
  if not rel_private.can(a,'owner') then raise exception 'REL_FORBIDDEN'; end if;
  if p_action='list' then
    if p_offset is null or p_offset not between 0 and 1000000 then raise exception 'REL_INVALID'; end if;
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
      (select ac.*,c.editor_id as requested_editor_id,c.message as claim_message,c.status as claim_status
       from rel_private.accounts ac left join rel_private.profile_claims c on c.user_id=ac.id
       order by ac.created_at desc,ac.id limit 50 offset p_offset) t;
    return jsonb_build_object('users',result,'total',(select count(*) from rel_private.accounts));
  end if;
  select * into target from rel_private.accounts where id=p_user_id for update;
  if not found then raise exception 'REL_NOT_FOUND'; end if;
  if p_action='update' then
    if p_roles is null or not ('member'=any(p_roles)) or not (p_roles<@array['member','list_contributor','application_reviewer','owner']::text[])
      or p_disabled is null then raise exception 'REL_INVALID'; end if;
    if ('owner'=any(target.roles)) and not target.disabled and (p_disabled or not ('owner'=any(p_roles)))
      and not exists(select 1 from rel_private.accounts where id<>p_user_id and 'owner'=any(roles) and not disabled)
    then raise exception 'REL_LAST_OWNER'; end if;
    if p_editor_id is not null and (not exists(select 1 from public.roblox_editor_site_data d,jsonb_array_elements(d.data->'editors') e where e->>'id'=p_editor_id)
      or exists(select 1 from rel_private.accounts where id<>p_user_id and editor_id=p_editor_id)) then raise exception 'REL_INVALID'; end if;
    update rel_private.accounts set roles=p_roles,editor_id=p_editor_id,disabled=p_disabled where id=p_user_id;
  elsif p_action in ('approve_claim','reject_claim') then
    select * into claim_row from rel_private.profile_claims where user_id=p_user_id and status='pending' for update;
    if not found then raise exception 'REL_NOT_FOUND'; end if;
    if p_action='approve_claim' then
      if target.editor_id is not null or not exists(select 1 from public.roblox_editor_site_data d,jsonb_array_elements(d.data->'editors') e where e->>'id'=claim_row.editor_id)
        or exists(select 1 from rel_private.accounts where editor_id=claim_row.editor_id) then raise exception 'REL_INVALID'; end if;
      update rel_private.accounts set editor_id=claim_row.editor_id where id=p_user_id;
    end if;
    update rel_private.profile_claims set status=case when p_action='approve_claim' then 'approved' else 'rejected' end,
      reviewed_by=auth.uid() where user_id=p_user_id;
  else raise exception 'REL_INVALID'; end if;
  insert into rel_private.audit(actor_id,action,target,details) values(auth.uid(),p_action,p_user_id::text,
    (select to_jsonb(ac) from rel_private.accounts ac where id=p_user_id));
  return jsonb_build_object('ok',true);
end $$;

create function rel_private.profile_links(p_status text,p_offset integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; result jsonb;
begin
  a:=rel_private.context();
  if not rel_private.can(a,'owner') then raise exception 'REL_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('all','pending','approved','rejected') or p_offset is null or p_offset not between 0 and 1000000
  then raise exception 'REL_INVALID'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from
    (select c.*,ac.username,reviewer.username as reviewer_username
     from rel_private.profile_claims c join rel_private.accounts ac on ac.id=c.user_id
     left join rel_private.accounts reviewer on reviewer.id=c.reviewed_by
     where p_status='all' or c.status=p_status order by c.created_at desc,c.user_id limit 50 offset p_offset) t;
  return jsonb_build_object('claims',result,'total',(select count(*) from rel_private.profile_claims where p_status='all' or status=p_status));
end $$;
create function public.rel_profile_links(p_status text,p_offset integer) returns jsonb
language sql security invoker set search_path = '' as $$ select rel_private.profile_links(p_status,p_offset) $$;
revoke all on function rel_private.profile_links(text,integer),public.rel_profile_links(text,integer) from public,anon,authenticated;
grant execute on function rel_private.profile_links(text,integer),public.rel_profile_links(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
