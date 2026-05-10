-- ============================================================
-- Hikmat Markaz - Fix PA Accept Registration Schema
-- Corrected version:
-- Avoids altering doctor_pa.id when it is an identity column.
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 1. PA table compatibility
-- ============================================================

alter table public.pa
add column if not exists user_id integer references public.app_user(user_id);

alter table public.pa
add column if not exists cnic text;

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


-- Old PA columns should not block new app_user-based inserts.
do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'pa'
          and column_name = 'name'
    ) then
        update public.pa
        set name = coalesce(name, full_name, 'PA')
        where name is null;

        alter table public.pa
        alter column name drop not null;
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'pa'
          and column_name = 'email'
    ) then
        alter table public.pa
        alter column email drop not null;
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'pa'
          and column_name = 'password_hash'
    ) then
        alter table public.pa
        alter column password_hash drop not null;
    end if;
end $$;


create index if not exists idx_pa_cnic
on public.pa(cnic);

create index if not exists idx_pa_user_id
on public.pa(user_id);


-- ============================================================
-- 2. doctor_pa table compatibility
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


alter table public.doctor_pa
add column if not exists doctor_hospital_id integer references public.doctor_hospital(id);

alter table public.doctor_pa
add column if not exists is_active boolean not null default true;

alter table public.doctor_pa
add column if not exists created_at timestamptz not null default now();

alter table public.doctor_pa
add column if not exists updated_at timestamptz not null default now();


-- If old doctor_pa.status exists and is NOT NULL, give it a safe default.
do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'doctor_pa'
          and column_name = 'status'
    ) then
        update public.doctor_pa
        set status = coalesce(status, 'active')
        where status is null;

        alter table public.doctor_pa
        alter column status set default 'active';
    end if;
end $$;


create unique index if not exists uq_active_doctor_pa_hospital
on public.doctor_pa(doctor_id, pa_id, doctor_hospital_id)
where is_active = true;

create index if not exists idx_doctor_pa_doctor
on public.doctor_pa(doctor_id);

create index if not exists idx_doctor_pa_pa
on public.doctor_pa(pa_id);

create index if not exists idx_doctor_pa_hospital
on public.doctor_pa(doctor_hospital_id);


-- ============================================================
-- 3. pa_invite table compatibility
-- ============================================================

alter table public.pa_invite
add column if not exists doctor_id integer references public.doctor(doctor_id);

alter table public.pa_invite
add column if not exists doctor_hospital_id integer references public.doctor_hospital(id);

alter table public.pa_invite
add column if not exists invited_cnic text;

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

update public.pa_invite
set expires_at = now() + interval '7 days'
where expires_at is null;

alter table public.pa_invite
alter column expires_at set default (now() + interval '7 days');

alter table public.pa_invite
alter column expires_at set not null;

alter table public.pa_invite
add column if not exists accepted_by_pa_id integer references public.pa(pa_id);

alter table public.pa_invite
add column if not exists accepted_at timestamptz;

alter table public.pa_invite
add column if not exists created_at timestamptz not null default now();

alter table public.pa_invite
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_pa_invite_token
on public.pa_invite(invite_token);

create index if not exists idx_pa_invite_doctor
on public.pa_invite(doctor_id);

create index if not exists idx_pa_invite_status
on public.pa_invite(status);

alter table public.pa_invite
drop constraint if exists chk_pa_invite_status;

alter table public.pa_invite
add constraint chk_pa_invite_status
check (status in ('pending', 'accepted', 'cancelled', 'expired'));