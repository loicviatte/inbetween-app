-- Add shared_group_id to focus_points so group-wide drills from a public class
-- can be linked across all students that received them. Coach can aggregate
-- practice status by grouping on this column.
alter table public.focus_points
  add column if not exists shared_group_id uuid;

create index if not exists focus_points_shared_group_id_idx
  on public.focus_points (shared_group_id)
  where shared_group_id is not null;
