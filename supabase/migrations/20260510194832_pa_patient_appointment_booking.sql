-- ============================================================
-- Hikmat Markaz - Step 7 PA Patient Registration + Appointment Booking
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 1. Patient table compatibility
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


-- Make patient_id safe if it exists without default.
do $$
declare
    identity_value text;
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'patient'
          and column_name = 'patient_id'
    ) then
        select identity_generation
        into identity_value
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'patient'
          and column_name = 'patient_id';

        if identity_value is null then
            create sequence if not exists public.patient_patient_id_seq;

            alter sequence public.patient_patient_id_seq
            owned by public.patient.patient_id;

            alter table public.patient
            alter column patient_id
            set default nextval('public.patient_patient_id_seq'::regclass);

            update public.patient
            set patient_id = nextval('public.patient_patient_id_seq'::regclass)
            where patient_id is null;

            perform setval(
                'public.patient_patient_id_seq',
                greatest(
                    coalesce((select max(patient_id) from public.patient), 0),
                    1
                ),
                true
            );
        end if;

        alter table public.patient
        alter column patient_id set not null;
    else
        alter table public.patient
        add column patient_id bigint;

        create sequence if not exists public.patient_patient_id_seq;

        alter sequence public.patient_patient_id_seq
        owned by public.patient.patient_id;

        alter table public.patient
        alter column patient_id
        set default nextval('public.patient_patient_id_seq'::regclass);

        update public.patient
        set patient_id = nextval('public.patient_patient_id_seq'::regclass)
        where patient_id is null;

        alter table public.patient
        alter column patient_id set not null;
    end if;
end $$;


-- Old columns should not block inserts.
do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'patient'
          and column_name = 'age'
    ) then
        alter table public.patient
        alter column age drop not null;
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'patient'
          and column_name = 'email'
    ) then
        alter table public.patient
        alter column email drop not null;
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'patient'
          and column_name = 'phone'
    ) then
        alter table public.patient
        alter column phone drop not null;
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'patient'
          and column_name = 'dob'
    ) then
        alter table public.patient
        alter column dob drop not null;
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'patient'
          and column_name = 'gender'
    ) then
        alter table public.patient
        alter column gender drop not null;
    end if;
end $$;


create unique index if not exists uq_patient_cnic_not_null
on public.patient(cnic)
where cnic is not null;

create index if not exists idx_patient_cnic
on public.patient(cnic);

create index if not exists idx_patient_user_id
on public.patient(user_id);


-- ============================================================
-- 2. Appointment table compatibility
-- ============================================================

alter table public.appointment
add column if not exists appointment_id bigint;

do $$
declare
    identity_value text;
begin
    select identity_generation
    into identity_value
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointment'
      and column_name = 'appointment_id';

    if identity_value is null then
        create sequence if not exists public.appointment_appointment_id_seq;

        alter sequence public.appointment_appointment_id_seq
        owned by public.appointment.appointment_id;

        alter table public.appointment
        alter column appointment_id
        set default nextval('public.appointment_appointment_id_seq'::regclass);

        update public.appointment
        set appointment_id = nextval('public.appointment_appointment_id_seq'::regclass)
        where appointment_id is null;

        perform setval(
            'public.appointment_appointment_id_seq',
            greatest(
                coalesce((select max(appointment_id) from public.appointment), 0),
                1
            ),
            true
        );
    end if;

    alter table public.appointment
    alter column appointment_id set not null;
end $$;


alter table public.appointment
add column if not exists patient_id integer references public.patient(patient_id);

alter table public.appointment
add column if not exists doctor_id integer references public.doctor(doctor_id);

alter table public.appointment
add column if not exists doctor_hospital_id integer references public.doctor_hospital(id);

alter table public.appointment
add column if not exists pa_id integer references public.pa(pa_id);

alter table public.appointment
add column if not exists appointment_datetime timestamptz;

alter table public.appointment
add column if not exists duration_minutes integer not null default 15;

alter table public.appointment
add column if not exists fee_charged numeric(10, 2) not null default 0;

alter table public.appointment
add column if not exists fee_status text not null default 'pending';

alter table public.appointment
add column if not exists status text not null default 'pending_fee';

alter table public.appointment
add column if not exists source text not null default 'walk_in';

alter table public.appointment
add column if not exists priority_level integer not null default 0;

alter table public.appointment
add column if not exists priority_reason text;

alter table public.appointment
add column if not exists actual_start timestamptz;

alter table public.appointment
add column if not exists actual_end timestamptz;

alter table public.appointment
add column if not exists notes text;

alter table public.appointment
add column if not exists created_at timestamptz not null default now();

alter table public.appointment
add column if not exists updated_at timestamptz not null default now();


-- Old datetime column from earlier ERD should not block inserts.
do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'appointment'
          and column_name = 'datetime'
    ) then
        alter table public.appointment
        alter column datetime drop not null;
    end if;
end $$;


alter table public.appointment
drop constraint if exists chk_appointment_status;

alter table public.appointment
add constraint chk_appointment_status
check (status in (
    'pending_fee',
    'waiting',
    'in_consultation',
    'completed',
    'cancelled',
    'no_show'
));


alter table public.appointment
drop constraint if exists chk_appointment_fee_status;

alter table public.appointment
add constraint chk_appointment_fee_status
check (fee_status in ('pending', 'paid', 'waived'));


alter table public.appointment
drop constraint if exists chk_appointment_source;

alter table public.appointment
add constraint chk_appointment_source
check (source in ('walk_in', 'online_request', 'phone_call'));


create index if not exists idx_appointment_patient
on public.appointment(patient_id);

create index if not exists idx_appointment_doctor
on public.appointment(doctor_id);

create index if not exists idx_appointment_pa
on public.appointment(pa_id);

create index if not exists idx_appointment_hospital
on public.appointment(doctor_hospital_id);

create index if not exists idx_appointment_datetime
on public.appointment(appointment_datetime);

create index if not exists idx_appointment_status
on public.appointment(status);