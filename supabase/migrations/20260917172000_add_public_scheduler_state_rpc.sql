create or replace function public.autoscout_public_scheduler_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  if p_token is null or not exists (
    select 1
    from private.autoscout_backend_tokens
    where enabled = true
      and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'Unauthorized ingestion' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_build_object(
        'nextAt', s.next_at,
        'leaseUntil', s.lease_until,
        'dbNow', now()
      )
      from private.autoscout_public_state s
      where s.id = 'scheduler'
    ),
    jsonb_build_object('nextAt', null, 'leaseUntil', null, 'dbNow', now())
  );
end;
$$;
