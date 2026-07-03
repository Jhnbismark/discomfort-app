-- New Supabase projects no longer auto-expose public-schema entities to the
-- Data API roles — grant exactly what the RLS policies permit (RLS still
-- gates row access; these only open the door).

grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.sessions to authenticated;
grant select on public.ranks to authenticated;
