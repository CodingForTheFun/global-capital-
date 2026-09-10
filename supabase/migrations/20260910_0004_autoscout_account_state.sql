-- Server-side account state for the Scout Pro auth service.
--
-- Identity lives in auth.users; the profile and role live in public.users.
-- This table holds what the auth service owns: the password hash, pending
-- one-time codes, lockout counters, and the session version used to revoke
-- every session at once.
--
-- RLS is enabled with no policies, and grants are revoked, so anon and
-- authenticated can never read a row. Only the service role may touch it.

create table if not exists public.account_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_hash text,
  email_verified boolean not null default false,
  session_version integer not null default 1,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  disabled boolean not null default false,
  pending_codes jsonb not null default '{}'::jsonb,
  last_login_at timestamptz,
  last_login_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_state enable row level security;
revoke all on table public.account_state from anon, authenticated;

comment on table public.account_state is
  'Auth-service private state (password hash, one-time codes, lockout). Service role only; never exposed to anon or authenticated.';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assigned_role text;
begin
  if not exists (select 1 from public.users) then assigned_role := 'OWNER';
  else assigned_role := 'USER'; end if;

  insert into public.users (id, email, display_name, role)
  values (new.id, new.email,
          nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''),
          assigned_role)
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, tier, status)
  values (new.id, 'free', 'inactive') on conflict (user_id) do nothing;

  insert into public.account_state (user_id)
  values (new.id) on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from anon, authenticated, public;

insert into public.account_state (user_id)
select u.id from auth.users u
where not exists (select 1 from public.account_state s where s.user_id = u.id);

create index if not exists account_state_locked_until_idx
  on public.account_state (locked_until) where locked_until is not null;
