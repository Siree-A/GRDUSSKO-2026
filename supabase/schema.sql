-- Sisaket Drug Risk Dashboard: Supabase schema and Row-Level Security
-- Run this file once in Supabase Dashboard > SQL Editor.

create type public.app_role as enum ('collector', 'district_admin', 'provincial_admin', 'system_admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'collector',
  district text check (district is null or district in (
    'เมืองศรีสะเกษ','ยางชุมน้อย','กันทรารมย์','กันทรลักษ์','ขุขันธ์','ไพรบึง','ปรางค์กู่','ขุนหาญ',
    'ราษีไศล','อุทุมพรพิสัย','บึงบูรพ์','ห้วยทับทัน','โนนคูณ','ศรีรัตนะ','น้ำเกลี้ยง','วังหิน',
    'ภูสิงห์','เมืองจันทร์','เบญจลักษ์','พยุห์','โพธิ์ศรีสุวรรณ','ศิลาลาด'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null unique,
  report_type text not null check (report_type in ('surveys','adr','rankings','measures')),
  district text not null,
  collector_id uuid not null references public.profiles(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reports_district_idx on public.reports(district);
create index reports_type_idx on public.reports(report_type);
create index reports_collector_idx on public.reports(collector_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger reports_updated_at before update on public.reports
for each row execute function public.set_updated_at();

-- A newly created Auth user always starts as a collector. Set other roles manually below.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.current_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_district()
returns text language sql stable security definer set search_path = public as $$
  select district from public.profiles where id = auth.uid()
$$;

alter table public.profiles enable row level security;
alter table public.reports enable row level security;

create policy "profile: read own" on public.profiles
for select to authenticated using (id = auth.uid());

create policy "profile: provincial and system admins read all" on public.profiles
for select to authenticated using (public.current_role() in ('provincial_admin','system_admin'));

create policy "reports: collectors read own" on public.reports
for select to authenticated using (collector_id = auth.uid());
create policy "reports: district admins read district" on public.reports
for select to authenticated using (
  public.current_role() = 'district_admin' and district = public.current_district()
);
create policy "reports: provincial and system admins read all" on public.reports
for select to authenticated using (public.current_role() in ('provincial_admin','system_admin'));

create policy "reports: collectors insert own district" on public.reports
for insert to authenticated with check (
  collector_id = auth.uid() and district = public.current_district()
);
create policy "reports: collectors update own district" on public.reports
for update to authenticated using (collector_id = auth.uid()) with check (
  collector_id = auth.uid() and district = public.current_district()
);
create policy "reports: district admins manage district" on public.reports
for all to authenticated using (
  public.current_role() = 'district_admin' and district = public.current_district()
) with check (
  public.current_role() = 'district_admin' and district = public.current_district()
);
create policy "reports: provincial and system admins manage all" on public.reports
for all to authenticated using (public.current_role() in ('provincial_admin','system_admin'))
with check (public.current_role() in ('provincial_admin','system_admin'));

-- After creating accounts in Authentication > Users, assign their role and district here.
-- update public.profiles set role = 'district_admin', district = 'เมืองศรีสะเกษ'
-- where email = 'district-admin@example.org';
-- update public.profiles set role = 'provincial_admin', district = null
-- where email = 'provincial-admin@example.org';
