-- ============================================================
-- A child's sign-in code can be kept.
--
-- Leon's account is held by his mother, who has never opened the app, so she
-- can't make him the 10-minute code his phone signs in with. A code made by
-- hand for him (28 Oct) is marked reusable: claiming it signs the phone in
-- without spending it, so he can sign in again after logging out, on any
-- phone, with no parent at hand.
--
-- Default false: every code a parent makes stays 10 minutes and one use. A
-- reusable code goes the way the others do — the parent's "sign out" and any
-- new code they make delete it.
-- ============================================================

alter table public.child_pairing_codes
  add column if not exists reusable boolean not null default false;

comment on column public.child_pairing_codes.reusable is
  'Set by hand for a child whose parent never uses the app: child-pairing claim does not spend it. Delete the row to revoke.';
