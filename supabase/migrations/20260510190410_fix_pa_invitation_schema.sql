-- ============================================================
-- Hikmat Markaz - PA Invitation Schema Repair Migration
-- Fixes:
-- 1. Missing doctor_pa.doctor_pa_id
-- 2. Missing/default-broken pa_invite.invite_token
-- 3. Ensures active PA-doctor-hospital linking works safely
-- ============================================================


create extension if not exists pgcrypto;


-- ============================================================
-- 1. Fix doctor_pa primary/reference identifier
-- Existing doctor_pa table does not have doctor_pa_id,
-- but backend API expects this column.
-- ============================================================

alter table public.doctor_pa
add column if not exists doctor_pa_id bigint;

create sequence if not exists public.doctor_pa_doctor_pa_id_seq;

alter sequence public.doctor_pa_doctor_pa_id_seq
owned by public.doctor_pa.doctor_pa_id;

alter table public.doctor_pa
alter column doctor_pa_id
set default nextval('public.doctor_pa_doctor_pa_id_seq'::regclass);

update public.doctor_pa
set doctor_pa_id = nextval('public.doctor_pa_doctor_pa_id_seq'::regclass)
where doctor_pa_id is null;

select setval(
    'public.doctor_pa_doctor_pa_id_seq',
    greatest(
        coalesce((select max(doctor_pa_id) from public.doctor_pa), 0),
        1
    ),
    true
);

alter table public.doctor_pa
alter column doctor_pa_id set not null;

create unique index if not exists uq_doctor_pa_id
on public.doctor_pa(doctor_pa_id);


-- ============================================================
-- 2. Ensure doctor_pa supporting columns exist
-- ============================================================

alter table public.doctor_pa
add column if not exists doctor_hospital_id integer references public.doctor_hospital(id);

alter table public.doctor_pa
add column if not exists is_active boolean not null default true;

alter table public.doctor_pa
add column if not exists created_at timestamptz not null default now();

alter table public.doctor_pa
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_active_doctor_pa_hospital
on public.doctor_pa(doctor_id, pa_id, doctor_hospital_id)
where is_active = true;


-- ============================================================
-- 3. Ensure pa table has required profile fields
-- ============================================================

alter table public.pa
add column if not exists full_name text;

alter table public.pa
add column if not exists phone text;

alter table public.pa
add column if not exists is_active boolean not null default true;

alter table public.pa
add column if not exists created_at timestamptz not null default now();

alter table public.pa
add column if not exists updated_at timestamptz not null default now();


-- ============================================================
-- 4. Fix pa_invite required columns and invite_token default
-- ============================================================

alter table public.pa_invite
add column if not exists doctor_id integer references public.doctor(doctor_id);

alter table public.pa_invite
add column if not exists doctor_hospital_id integer references public.doctor_hospital(id);

alter table public.pa_invite
add column if not exists invited_email text;

alter table public.pa_invite
add column if not exists invite_token uuid;

alter table public.pa_invite
alter column invite_token set default gen_random_uuid();

update public.pa_invite
set invite_token = gen_random_uuid()
where invite_token is null;

alter table public.pa_invite
alter column invite_token set not null;

alter table public.pa_invite
add column if not exists status text not null default 'pending';

alter table public.pa_invite
add column if not exists expires_at timestamptz;

alter table public.pa_invite
add column if not exists created_at timestamptz not null default now();

alter table public.pa_invite
add column if not exists updated_at timestamptz not null default now();

alter table public.pa_invite
add column if not exists invited_cnic text;

alter table public.pa_invite
add column if not exists accepted_by_pa_id integer references public.pa(pa_id);

alter table public.pa_invite
add column if not exists accepted_at timestamptz;

create unique index if not exists uq_pa_invite_token
on public.pa_invite(invite_token);

alter table public.pa_invite
drop constraint if exists chk_pa_invite_status;

alter table public.pa_invite
add constraint chk_pa_invite_status
check (status in ('pending', 'accepted', 'cancelled', 'expired'));


-- ============================================================
-- 5. Helpful indexes
-- ============================================================

create index if not exists idx_pa_cnic
on public.pa(cnic);

create index if not exists idx_pa_invite_doctor
on public.pa_invite(doctor_id);

create index if not exists idx_pa_invite_status
on public.pa_invite(status);

create index if not exists idx_doctor_pa_doctor
on public.doctor_pa(doctor_id);

create index if not exists idx_doctor_pa_pa
on public.doctor_pa(pa_id);