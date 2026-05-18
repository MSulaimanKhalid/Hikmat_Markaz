-- ============================================================
-- Hikmat Markaz - Fix PA Invite expires_at
-- Problem:
-- pa_invite.expires_at is NOT NULL but backend invite insert
-- was not sending expires_at.
-- Solution:
-- Give expires_at a default value and repair existing rows.
-- ============================================================

alter table public.pa_invite
add column if not exists expires_at timestamptz;

update public.pa_invite
set expires_at = now() + interval '7 days'
where expires_at is null;

alter table public.pa_invite
alter column expires_at set default (now() + interval '7 days');

alter table public.pa_invite
alter column expires_at set not null;