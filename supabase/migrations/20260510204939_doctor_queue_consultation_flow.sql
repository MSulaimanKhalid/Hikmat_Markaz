-- ============================================================
-- Hikmat Markaz - Step 8 Doctor Queue + Consultation Flow
-- Corrected full migration
-- Fixes identity-column issue in visit, diagnosis, visit_field_value
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 1. Appointment compatibility
-- ============================================================

alter table public.appointment
add column if not exists actual_start timestamptz;

alter table public.appointment
add column if not exists actual_end timestamptz;

alter table public.appointment
add column if not exists priority_level integer not null default 0;

alter table public.appointment
add column if not exists priority_reason text;

alter table public.appointment
add column if not exists notes text;

alter table public.appointment
add column if not exists updated_at timestamptz not null default now();

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
check (
    fee_status in ('pending', 'paid', 'waived')
);

create index if not exists idx_appointment_doctor_datetime
on public.appointment(doctor_id, appointment_datetime);

create index if not exists idx_appointment_doctor_status
on public.appointment(doctor_id, status);

create index if not exists idx_appointment_priority
on public.appointment(priority_level);


-- ============================================================
-- 2. Visit table compatibility
-- ============================================================

create table if not exists public.visit (
    visit_id bigint
);

alter table public.visit
add column if not exists visit_id bigint;

do $$
declare
    identity_value text;
begin
    select identity_generation
    into identity_value
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'visit'
      and column_name = 'visit_id';

    if identity_value is null then
        create sequence if not exists public.visit_visit_id_seq;

        alter sequence public.visit_visit_id_seq
        owned by public.visit.visit_id;

        alter table public.visit
        alter column visit_id
        set default nextval('public.visit_visit_id_seq'::regclass);

        update public.visit
        set visit_id = nextval('public.visit_visit_id_seq'::regclass)
        where visit_id is null;

        perform setval(
            'public.visit_visit_id_seq',
            greatest(
                coalesce((select max(visit_id) from public.visit), 0),
                1
            ),
            true
        );
    end if;
end $$;

alter table public.visit
alter column visit_id set not null;

create unique index if not exists uq_visit_id
on public.visit(visit_id);

alter table public.visit
add column if not exists appointment_id bigint;

alter table public.visit
add column if not exists patient_id bigint;

alter table public.visit
add column if not exists doctor_id bigint;

alter table public.visit
add column if not exists started_at timestamptz;

alter table public.visit
add column if not exists completed_at timestamptz;

alter table public.visit
add column if not exists clinical_notes text;

alter table public.visit
add column if not exists bp text;

alter table public.visit
add column if not exists pulse text;

alter table public.visit
add column if not exists temperature text;

alter table public.visit
add column if not exists weight text;

alter table public.visit
add column if not exists created_at timestamptz not null default now();

alter table public.visit
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_visit_appointment_id
on public.visit(appointment_id)
where appointment_id is not null;

create index if not exists idx_visit_patient
on public.visit(patient_id);

create index if not exists idx_visit_doctor
on public.visit(doctor_id);

do $$
declare
    r record;
begin
    for r in
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'visit'
          and is_nullable = 'NO'
          and identity_generation is null
          and column_name not in ('visit_id', 'id')
    loop
        execute format(
            'alter table public.visit alter column %I drop not null',
            r.column_name
        );
    end loop;
end $$;


-- ============================================================
-- 3. Diagnosis table as official diagnosis source
-- ============================================================

create table if not exists public.diagnosis (
    diagnosis_id bigint
);

alter table public.diagnosis
add column if not exists diagnosis_id bigint;

do $$
declare
    identity_value text;
begin
    select identity_generation
    into identity_value
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'diagnosis'
      and column_name = 'diagnosis_id';

    if identity_value is null then
        create sequence if not exists public.diagnosis_diagnosis_id_seq;

        alter sequence public.diagnosis_diagnosis_id_seq
        owned by public.diagnosis.diagnosis_id;

        alter table public.diagnosis
        alter column diagnosis_id
        set default nextval('public.diagnosis_diagnosis_id_seq'::regclass);

        update public.diagnosis
        set diagnosis_id = nextval('public.diagnosis_diagnosis_id_seq'::regclass)
        where diagnosis_id is null;

        perform setval(
            'public.diagnosis_diagnosis_id_seq',
            greatest(
                coalesce((select max(diagnosis_id) from public.diagnosis), 0),
                1
            ),
            true
        );
    end if;
end $$;

alter table public.diagnosis
alter column diagnosis_id set not null;

create unique index if not exists uq_diagnosis_id
on public.diagnosis(diagnosis_id);

alter table public.diagnosis
add column if not exists visit_id bigint;

alter table public.diagnosis
add column if not exists appointment_id bigint;

alter table public.diagnosis
add column if not exists doctor_id bigint;

alter table public.diagnosis
add column if not exists patient_id bigint;

alter table public.diagnosis
add column if not exists diagnosis_text text;

alter table public.diagnosis
add column if not exists treatment_plan text;

alter table public.diagnosis
add column if not exists follow_up_notes text;

alter table public.diagnosis
add column if not exists created_at timestamptz not null default now();

alter table public.diagnosis
add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_diagnosis_visit
on public.diagnosis(visit_id);

create index if not exists idx_diagnosis_patient
on public.diagnosis(patient_id);

create index if not exists idx_diagnosis_doctor
on public.diagnosis(doctor_id);

do $$
declare
    r record;
begin
    for r in
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'diagnosis'
          and is_nullable = 'NO'
          and identity_generation is null
          and column_name not in ('diagnosis_id', 'id')
    loop
        execute format(
            'alter table public.diagnosis alter column %I drop not null',
            r.column_name
        );
    end loop;
end $$;


-- ============================================================
-- 4. Visit dynamic field values
-- ============================================================

create table if not exists public.visit_field_value (
    field_value_id bigint
);

alter table public.visit_field_value
add column if not exists field_value_id bigint;

do $$
declare
    identity_value text;
begin
    select identity_generation
    into identity_value
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'visit_field_value'
      and column_name = 'field_value_id';

    if identity_value is null then
        create sequence if not exists public.visit_field_value_field_value_id_seq;

        alter sequence public.visit_field_value_field_value_id_seq
        owned by public.visit_field_value.field_value_id;

        alter table public.visit_field_value
        alter column field_value_id
        set default nextval('public.visit_field_value_field_value_id_seq'::regclass);

        update public.visit_field_value
        set field_value_id = nextval('public.visit_field_value_field_value_id_seq'::regclass)
        where field_value_id is null;

        perform setval(
            'public.visit_field_value_field_value_id_seq',
            greatest(
                coalesce((select max(field_value_id) from public.visit_field_value), 0),
                1
            ),
            true
        );
    end if;
end $$;

alter table public.visit_field_value
alter column field_value_id set not null;

create unique index if not exists uq_visit_field_value_id
on public.visit_field_value(field_value_id);

alter table public.visit_field_value
add column if not exists visit_id bigint;

alter table public.visit_field_value
add column if not exists field_id bigint;

alter table public.visit_field_value
add column if not exists value_text text;

alter table public.visit_field_value
add column if not exists created_at timestamptz not null default now();

alter table public.visit_field_value
add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_visit_field_value_visit
on public.visit_field_value(visit_id);

create index if not exists idx_visit_field_value_field
on public.visit_field_value(field_id);

do $$
declare
    r record;
begin
    for r in
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'visit_field_value'
          and is_nullable = 'NO'
          and identity_generation is null
          and column_name not in ('field_value_id', 'value_id', 'id')
    loop
        execute format(
            'alter table public.visit_field_value alter column %I drop not null',
            r.column_name
        );
    end loop;
end $$;


-- ============================================================
-- 5. Helpful compatibility indexes
-- ============================================================

create index if not exists idx_visit_appointment
on public.visit(appointment_id);

create index if not exists idx_diagnosis_appointment
on public.diagnosis(appointment_id);

create index if not exists idx_visit_field_value_visit_field
on public.visit_field_value(visit_id, field_id);