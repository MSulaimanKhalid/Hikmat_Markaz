-- ============================================================
-- Hikmat Markaz - Step 10 Patient Portal + Online Appointment Requests
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 1. app_user role/status compatibility
-- ============================================================

do $$
declare
    r record;
begin
    for r in
        select conname
        from pg_constraint
        where conrelid = 'public.app_user'::regclass
          and contype = 'c'
          and lower(pg_get_constraintdef(oid)) like '%role%'
    loop
        execute format('alter table public.app_user drop constraint if exists %I', r.conname);
    end loop;
end $$;

alter table public.app_user
add constraint chk_app_user_role
check (role in ('admin', 'doctor', 'pa', 'patient'));


do $$
declare
    r record;
begin
    for r in
        select conname
        from pg_constraint
        where conrelid = 'public.app_user'::regclass
          and contype = 'c'
          and lower(pg_get_constraintdef(oid)) like '%status%'
    loop
        execute format('alter table public.app_user drop constraint if exists %I', r.conname);
    end loop;
end $$;

alter table public.app_user
add constraint chk_app_user_status
check (status in ('active', 'inactive', 'pending', 'blocked'));


-- ============================================================
-- 2. Patient table compatibility
-- ============================================================

alter table public.patient
add column if not exists user_id integer references public.app_user(user_id);

alter table public.patient
add column if not exists cnic text;

alter table public.patient
add column if not exists name text;

alter table public.patient
add column if not exists gender text;

alter table public.patient
add column if not exists dob date;

alter table public.patient
add column if not exists phone text;

alter table public.patient
add column if not exists email text;

alter table public.patient
add column if not exists is_active boolean not null default true;

alter table public.patient
add column if not exists created_at timestamptz not null default now();

alter table public.patient
add column if not exists updated_at timestamptz not null default now();

alter table public.patient
drop constraint if exists chk_patient_gender;

alter table public.patient
add constraint chk_patient_gender
check (
    gender is null
    or gender in ('male', 'female', 'other')
);

create unique index if not exists uq_patient_cnic_not_null
on public.patient(cnic)
where cnic is not null;

create index if not exists idx_patient_user_id_step10
on public.patient(user_id);

create index if not exists idx_patient_cnic_step10
on public.patient(cnic);


-- ============================================================
-- 3. Appointment request table
-- Used when patient requests appointment online.
-- PA confirms/rejects it later.
-- ============================================================

create table if not exists public.appointment_request (
    request_id bigint
);

alter table public.appointment_request
add column if not exists request_id bigint;

do $$
declare
    identity_value text;
begin
    select identity_generation
    into identity_value
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointment_request'
      and column_name = 'request_id';

    if identity_value is null then
        create sequence if not exists public.appointment_request_request_id_seq;

        alter sequence public.appointment_request_request_id_seq
        owned by public.appointment_request.request_id;

        alter table public.appointment_request
        alter column request_id
        set default nextval('public.appointment_request_request_id_seq'::regclass);

        update public.appointment_request
        set request_id = nextval('public.appointment_request_request_id_seq'::regclass)
        where request_id is null;

        perform setval(
            'public.appointment_request_request_id_seq',
            greatest(
                coalesce((select max(request_id) from public.appointment_request), 0),
                1
            ),
            true
        );
    end if;
end $$;

alter table public.appointment_request
alter column request_id set not null;

create unique index if not exists uq_appointment_request_id
on public.appointment_request(request_id);

alter table public.appointment_request
add column if not exists patient_id bigint;

alter table public.appointment_request
add column if not exists doctor_id bigint;

alter table public.appointment_request
add column if not exists doctor_hospital_id bigint;

alter table public.appointment_request
add column if not exists requested_datetime timestamptz;

alter table public.appointment_request
add column if not exists duration_minutes integer not null default 15;

alter table public.appointment_request
add column if not exists expected_fee numeric(10, 2) not null default 0;

alter table public.appointment_request
add column if not exists status text not null default 'pending';

alter table public.appointment_request
add column if not exists patient_notes text;

alter table public.appointment_request
add column if not exists pa_notes text;

alter table public.appointment_request
add column if not exists confirmed_by_pa_id bigint;

alter table public.appointment_request
add column if not exists confirmed_appointment_id bigint;

alter table public.appointment_request
add column if not exists confirmed_at timestamptz;

alter table public.appointment_request
add column if not exists rejected_at timestamptz;

alter table public.appointment_request
add column if not exists rejection_reason text;

alter table public.appointment_request
add column if not exists created_at timestamptz not null default now();

alter table public.appointment_request
add column if not exists updated_at timestamptz not null default now();

alter table public.appointment_request
drop constraint if exists chk_appointment_request_status;

alter table public.appointment_request
add constraint chk_appointment_request_status
check (status in ('pending', 'confirmed', 'rejected', 'cancelled'));

create index if not exists idx_appointment_request_patient
on public.appointment_request(patient_id);

create index if not exists idx_appointment_request_doctor
on public.appointment_request(doctor_id);

create index if not exists idx_appointment_request_hospital
on public.appointment_request(doctor_hospital_id);

create index if not exists idx_appointment_request_status
on public.appointment_request(status);

create index if not exists idx_appointment_request_datetime
on public.appointment_request(requested_datetime);


-- ============================================================
-- 4. Appointment compatibility for online request source
-- ============================================================

alter table public.appointment
drop constraint if exists chk_appointment_source;

alter table public.appointment
add constraint chk_appointment_source
check (source in ('walk_in', 'online_request', 'phone_call'));

alter table public.appointment
drop constraint if exists chk_appointment_status;

alter table public.appointment
add constraint chk_appointment_status
check (
    status in (
        'pending_fee',
        'waiting',
        'in_consultation',
        'completed',
        'cancelled',
        'no_show'
    )
);

alter table public.appointment
drop constraint if exists chk_appointment_fee_status;

alter table public.appointment
add constraint chk_appointment_fee_status
check (fee_status in ('pending', 'paid', 'waived'));