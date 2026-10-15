-- Run in Supabase SQL Editor after schema.sql. Safe to run more than once.
-- Only the named provincial admin has unrestricted report/profile access.
create or replace function public.is_provincial_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and email = 'admin@grdussko.local'
      and role = 'provincial_admin'
  )
$$;

alter policy "profile: provincial and system admins read all" on public.profiles
  using (public.is_provincial_admin());
alter policy "reports: provincial and system admins read all" on public.reports
  using (public.is_provincial_admin());
alter policy "reports: provincial and system admins manage all" on public.reports
  using (public.is_provincial_admin()) with check (public.is_provincial_admin());
alter policy "reports: district admins read district" on public.reports using (false);
alter policy "reports: district admins manage district" on public.reports
  using (false) with check (false);

-- The dashboard returns aggregate counts only, never report payloads or patient/store names.
create or replace function public.province_dashboard()
returns table (
  district text, surveys bigint, high_risk bigint, adr bigint,
  rankings bigint, measures bigint, problem_score numeric, report_types bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and (p.role = 'collector' or public.is_provincial_admin())
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select r.district,
      count(*) filter (where r.report_type = 'surveys'),
      count(*) filter (where r.report_type = 'surveys' and
        case when jsonb_typeof(r.payload -> 'score') = 'number'
          then (r.payload ->> 'score')::numeric >= 14 else false end),
      count(*) filter (where r.report_type = 'adr'),
      count(*) filter (where r.report_type = 'rankings'),
      count(*) filter (where r.report_type = 'measures'),
      coalesce(sum(case when r.report_type = 'surveys' and
        jsonb_typeof(r.payload -> 'score') = 'number'
        then (r.payload ->> 'score')::numeric else 0 end), 0),
      count(distinct r.report_type)
    from public.reports r group by r.district;
end;
$$;

revoke all on function public.province_dashboard() from public, anon;
grant execute on function public.province_dashboard() to authenticated;
