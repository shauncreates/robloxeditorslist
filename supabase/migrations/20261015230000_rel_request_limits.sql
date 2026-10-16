begin;

create table rel_private.request_limits (
  action text not null,
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  hits integer not null check (hits > 0),
  expires_at timestamptz not null,
  primary key (action, subject_hash)
);
create index rel_request_limits_expiry on rel_private.request_limits(expires_at);
alter table rel_private.request_limits enable row level security;
revoke all on rel_private.request_limits from public, anon, authenticated;

create function public.rel_take_rate_limit(p_action text, p_subject_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare max_hits integer; seconds integer; moment timestamptz:=clock_timestamp(); bucket rel_private.request_limits;
begin
  case p_action
    when 'signin' then max_hits:=30; seconds:=60;
    when 'signup' then max_hits:=5; seconds:=600;
    when 'recover' then max_hits:=5; seconds:=600;
    when 'reset' then max_hits:=10; seconds:=600;
    when 'application' then max_hits:=10; seconds:=600;
    when 'avatar' then max_hits:=60; seconds:=600;
    else raise exception 'REL_INVALID';
  end case;
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then raise exception 'REL_INVALID'; end if;
  delete from rel_private.request_limits where (action,subject_hash) in (
    select action,subject_hash from rel_private.request_limits where expires_at<=moment
    order by expires_at limit 100
  );
  insert into rel_private.request_limits as current_bucket(action,subject_hash,hits,expires_at)
    values(p_action,p_subject_hash,1,moment+make_interval(secs=>seconds))
    on conflict(action,subject_hash) do update set
      hits=case when current_bucket.expires_at<=moment then 1 else least(current_bucket.hits+1,max_hits+1) end,
      expires_at=case when current_bucket.expires_at<=moment then excluded.expires_at else current_bucket.expires_at end
    returning * into bucket;
  return jsonb_build_object('allowed',bucket.hits<=max_hits,
    'retry_after',greatest(1,ceil(extract(epoch from bucket.expires_at-moment))::integer));
end $$;
revoke all on function public.rel_take_rate_limit(text,text) from public, anon, authenticated;
grant execute on function public.rel_take_rate_limit(text,text) to service_role;
notify pgrst,'reload schema';
commit;
