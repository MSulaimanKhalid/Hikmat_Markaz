create extension if not exists pgcrypto;

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

alter table public.pa_invite
add column if not exists doctor_id integer references public.doctor(doctor_id);

alter table public.pa_invite
add column if not exists doctor_hospital_id integer references public.doctor_hospital(id);

alter table public.pa_invite
add column if not exists invited_email text;

alter table public.pa_invite
add column if not exists invite_token uuid not null default gen_random_uuid();

alter table public.pa_invite
add column if not exists status text not null default 'pending';

alter table public.pa_invite
add column if not exists expires_at timestamptz;

alter table public.pa_invite
add column if not exists created_at timestamptz not null default now();

alter table public.pa_invite
add column if not exists updated_at timestamptz not null default now();

alter table public.doctor_pa
add column if not exists doctor_hospital_id integer references public.doctor_hospital(id);

alter table public.doctor_pa
add column if not exists is_active boolean not null default true;

alter table public.doctor_pa
add column if not exists created_at timestamptz not null default now();

alter table public.doctor_pa
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_pa_invite_token
on public.pa_invite(invite_token);

create unique index if not exists uq_active_doctor_pa_hospital
on public.doctor_pa(doctor_id, pa_id, doctor_hospital_id)
where is_active = true;

alter table public.pa_invite
drop constraint if exists chk_pa_invite_status;

alter table public.pa_invite
add constraint chk_pa_invite_status
check (status in ('pending', 'accepted', 'cancelled', 'expired'));