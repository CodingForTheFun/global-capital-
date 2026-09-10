-- Provision a public.users profile + free subscription for every auth.users row.
--
-- Without this, sign-up creates an identity with no profile and every user_id
-- foreign key (subscriptions, favorites, alerts, saved_props) dangles.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text;
begin
  if not exists (select 1 from public.users) then
    assigned_role := 'OWNER';
  else
    assigned_role := 'USER';
  end if;

  insert into public.users (id, email, display_name, role)
  values (new.id, new.email,
          nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''),
          assigned_role)
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, tier, status)
  values (new.id, 'free', 'inactive')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

insert into public.users (id, email, display_name, role)
select u.id, u.email, nullif(trim(coalesce(u.raw_user_meta_data->>'display_name','')),''), 'USER'
from auth.users u
where not exists (select 1 from public.users p where p.id = u.id);

insert into public.subscriptions (user_id, tier, status)
select p.id, 'free', 'inactive' from public.users p
where not exists (select 1 from public.subscriptions s where s.user_id = p.id);

update public.users set role = 'OWNER', updated_at = now()
 where id = (select id from public.users order by created_at asc limit 1)
   and not exists (select 1 from public.users where role = 'OWNER');

-- Admin visibility. SECURITY DEFINER avoids recursive RLS evaluation on users.
create or replace function public.current_user_is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('ADMIN','OWNER'));
$$;

drop policy if exists "admins read all profiles" on public.users;
create policy "admins read all profiles" on public.users
  for select to authenticated using (public.current_user_is_admin());

drop policy if exists "admins update any profile" on public.users;
create policy "admins update any profile" on public.users
  for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

drop policy if exists "admins read all subscriptions" on public.subscriptions;
create policy "admins read all subscriptions" on public.subscriptions
  for select to authenticated using (public.current_user_is_admin());

drop policy if exists "admins read sync runs" on public.provider_sync_runs;
create policy "admins read sync runs" on public.provider_sync_runs
  for select to authenticated using (public.current_user_is_admin());

drop policy if exists "admins read provider errors" on public.provider_errors;
create policy "admins read provider errors" on public.provider_errors
  for select to authenticated using (public.current_user_is_admin());

drop policy if exists "admins read api usage" on public.api_usage;
create policy "admins read api usage" on public.api_usage
  for select to authenticated using (public.current_user_is_admin());

create index if not exists line_snapshots_history_idx
  on public.line_snapshots (prop_id, bookmaker_key, side, created_at desc);
create index if not exists line_snapshots_created_at_idx
  on public.line_snapshots (created_at desc);
