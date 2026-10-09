-- Run this once in Supabase Dashboard > SQL Editor if schema.sql was run previously.
-- It prevents a collector from storing a report under a district other than the one
-- assigned to their profile.

drop policy if exists "reports: collectors insert own" on public.reports;
drop policy if exists "reports: collectors update own" on public.reports;

create policy "reports: collectors insert own district" on public.reports
for insert to authenticated with check (
  collector_id = auth.uid() and district = public.current_district()
);

create policy "reports: collectors update own district" on public.reports
for update to authenticated using (collector_id = auth.uid()) with check (
  collector_id = auth.uid() and district = public.current_district()
);
