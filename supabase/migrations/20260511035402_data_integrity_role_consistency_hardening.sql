-- ============================================================
-- Hikmat Markaz - Step 12 Data Integrity + Role Consistency
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 1. CNIC normalization helper
-- ============================================================

create or replace function public.normalize_cnic(input_cnic text)
returns text
language sql
immutable
as $$
    select nullif(regexp_replace(coalesce(input_cnic, ''), '\D', '', 'g'), '')
$$;


-- ============================================================
-- 2. Add doctor CNIC for identity consistency
-- Existing doctor signup may not collect CNIC yet, so nullable.
-- ============================================================

alter table public.doctor
add column if not exists cnic text;


-- ============================================================
-- 3. Normalize existing CNIC values
-- ============================================================

update public.patient
set cnic = public.normalize_cnic(cnic)
where cnic is not null;

update public.pa
set cnic = public.normalize_cnic(cnic)
where cnic is not null;

update public.doctor
set cnic = public.normalize_cnic(cnic)
where cnic is not null;


-- ============================================================
-- 4. CNIC format constraints
-- NOT VALID avoids failing migration because of older demo data.
-- New/updated data will still be checked.
-- ============================================================

alter table public.patient
drop constraint if exists chk_patient_cnic_format;

alter table public.patient
add constraint chk_patient_cnic_format
check (
    cnic is null
    or cnic ~ '^[0-9]{13}$'
) not valid;


alter table public.pa
drop constraint if exists chk_pa_cnic_format;

alter table public.pa
add constraint chk_pa_cnic_format
check (
    cnic is null
    or cnic ~ '^[0-9]{13}$'
) not valid;


alter table public.doctor
drop constraint if exists chk_doctor_cnic_format;

alter table public.doctor
add constraint chk_doctor_cnic_format
check (
    cnic is null
    or cnic ~ '^[0-9]{13}$'
) not valid;


-- ============================================================
-- 5. Unique CNIC inside each role table
-- ============================================================

create unique index if not exists uq_patient_cnic_step12
on public.patient(cnic)
where cnic is not null;

create unique index if not exists uq_pa_cnic_step12
on public.pa(cnic)
where cnic is not null;

create unique index if not exists uq_doctor_cnic_step12
on public.doctor(cnic)
where cnic is not null;


-- ============================================================
-- 6. Global CNIC uniqueness across role profile tables
-- This MVP policy prevents same CNIC from being reused as
-- patient, PA, and doctor separately.
-- ============================================================

create or replace function public.prevent_global_cnic_duplicate()
returns trigger
language plpgsql
as $$
declare
    normalized text;
begin
    if TG_TABLE_NAME = 'patient' then
        normalized := public.normalize_cnic(new.cnic);
        new.cnic := normalized;

        if normalized is null then
            return new;
        end if;

        if exists (
            select 1
            from public.pa
            where cnic = normalized
        ) then
            raise exception 'CNIC already exists as PA profile.';
        end if;

        if exists (
            select 1
            from public.doctor
            where cnic = normalized
        ) then
            raise exception 'CNIC already exists as doctor profile.';
        end if;

        return new;
    end if;

    if TG_TABLE_NAME = 'pa' then
        normalized := public.normalize_cnic(new.cnic);
        new.cnic := normalized;

        if normalized is null then
            return new;
        end if;

        if exists (
            select 1
            from public.patient
            where cnic = normalized
        ) then
            raise exception 'CNIC already exists as patient profile.';
        end if;

        if exists (
            select 1
            from public.doctor
            where cnic = normalized
        ) then
            raise exception 'CNIC already exists as doctor profile.';
        end if;

        return new;
    end if;

    if TG_TABLE_NAME = 'doctor' then
        normalized := public.normalize_cnic(new.cnic);
        new.cnic := normalized;

        if normalized is null then
            return new;
        end if;

        if exists (
            select 1
            from public.patient
            where cnic = normalized
        ) then
            raise exception 'CNIC already exists as patient profile.';
        end if;

        if exists (
            select 1
            from public.pa
            where cnic = normalized
        ) then
            raise exception 'CNIC already exists as PA profile.';
        end if;

        return new;
    end if;

    return new;
end;
$$;


drop trigger if exists trg_prevent_patient_cnic_duplicate on public.patient;

create trigger trg_prevent_patient_cnic_duplicate
before insert or update of cnic
on public.patient
for each row
execute function public.prevent_global_cnic_duplicate();


drop trigger if exists trg_prevent_pa_cnic_duplicate on public.pa;

create trigger trg_prevent_pa_cnic_duplicate
before insert or update of cnic
on public.pa
for each row
execute function public.prevent_global_cnic_duplicate();


drop trigger if exists trg_prevent_doctor_cnic_duplicate on public.doctor;

create trigger trg_prevent_doctor_cnic_duplicate
before insert or update of cnic
on public.doctor
for each row
execute function public.prevent_global_cnic_duplicate();


-- ============================================================
-- 7. Financial constraints
-- ============================================================

alter table public.appointment
add column if not exists payment_method text;

alter table public.appointment
add column if not exists payment_received_at timestamptz;

alter table public.appointment
add column if not exists payment_received_by_user_id bigint;

alter table public.appointment
add column if not exists discount_amount numeric(10, 2) not null default 0;

alter table public.appointment
add column if not exists refund_amount numeric(10, 2) not null default 0;

alter table public.appointment
add column if not exists payment_note text;

alter table public.appointment
add column if not exists updated_at timestamptz not null default now();


alter table public.appointment
drop constraint if exists chk_appointment_amounts;

alter table public.appointment
add constraint chk_appointment_amounts
check (
    coalesce(fee_charged, 0) >= 0
    and coalesce(discount_amount, 0) >= 0
    and coalesce(refund_amount, 0) >= 0
    and coalesce(discount_amount, 0) <= coalesce(fee_charged, 0)
) not valid;


alter table public.appointment
drop constraint if exists chk_appointment_payment_method;

alter table public.appointment
add constraint chk_appointment_payment_method
check (
    payment_method is null
    or payment_method in ('cash', 'card', 'bank_transfer', 'online', 'other')
) not valid;


-- ============================================================
-- 8. Payment log table
-- ============================================================

create table if not exists public.appointment_payment_log (
    payment_log_id bigint generated always as identity primary key,
    appointment_id bigint,
    doctor_id bigint,
    changed_by_user_id bigint,
    changed_by_role text,
    old_fee_status text,
    new_fee_status text,
    old_fee_charged numeric(10, 2),
    new_fee_charged numeric(10, 2),
    payment_method text,
    discount_amount numeric(10, 2) not null default 0,
    refund_amount numeric(10, 2) not null default 0,
    payment_note text,
    created_at timestamptz not null default now()
);

alter table public.appointment_payment_log
add column if not exists changed_by_role text;


-- ============================================================
-- 9. Appointment status transition guard
-- ============================================================

create or replace function public.guard_appointment_status_transition()
returns trigger
language plpgsql
as $$
begin
    if TG_OP = 'INSERT' then
        return new;
    end if;

    if new.status = old.status then
        return new;
    end if;

    if old.status in ('completed', 'cancelled', 'no_show') then
        raise exception 'Cannot change terminal appointment status from % to %.', old.status, new.status;
    end if;

    if old.status = 'pending_fee' and new.status in ('waiting', 'cancelled') then
        return new;
    end if;

    if old.status = 'waiting' and new.status in ('pending_fee', 'in_consultation', 'cancelled', 'no_show') then
        return new;
    end if;

    if old.status = 'in_consultation' and new.status = 'completed' then
        return new;
    end if;

    raise exception 'Invalid appointment status transition from % to %.', old.status, new.status;
end;
$$;


drop trigger if exists trg_guard_appointment_status_transition on public.appointment;

create trigger trg_guard_appointment_status_transition
before update of status
on public.appointment
for each row
execute function public.guard_appointment_status_transition();


-- ============================================================
-- 10. Appointment slot overlap guard
-- Uses advisory lock per doctor_hospital_id to prevent race condition.
-- Checks appointments only.
-- ============================================================

create or replace function public.prevent_appointment_overlap()
returns trigger
language plpgsql
as $$
declare
    new_start timestamptz;
    new_end timestamptz;
begin
    if new.status in ('cancelled', 'no_show') then
        return new;
    end if;

    if new.doctor_hospital_id is null or new.appointment_datetime is null then
        return new;
    end if;

    perform pg_advisory_xact_lock(new.doctor_hospital_id);

    new_start := new.appointment_datetime;
    new_end := new.appointment_datetime + ((coalesce(new.duration_minutes, 15) || ' minutes')::interval);

    if exists (
        select 1
        from public.appointment a
        where a.doctor_hospital_id = new.doctor_hospital_id
          and a.appointment_id <> coalesce(new.appointment_id, -1)
          and a.status not in ('cancelled', 'no_show')
          and new_start < (a.appointment_datetime + ((coalesce(a.duration_minutes, 15) || ' minutes')::interval))
          and new_end > a.appointment_datetime
    ) then
        raise exception 'Appointment slot overlaps with an existing appointment.';
    end if;

    return new;
end;
$$;


drop trigger if exists trg_prevent_appointment_overlap on public.appointment;

create trigger trg_prevent_appointment_overlap
before insert or update of doctor_hospital_id, appointment_datetime, duration_minutes, status
on public.appointment
for each row
execute function public.prevent_appointment_overlap();


-- ============================================================
-- 11. Appointment request overlap guard
-- Checks both confirmed appointments and pending/confirmed requests.
-- ============================================================

create or replace function public.prevent_appointment_request_overlap()
returns trigger
language plpgsql
as $$
declare
    new_start timestamptz;
    new_end timestamptz;
begin
    if new.status not in ('pending', 'confirmed') then
        return new;
    end if;

    if new.doctor_hospital_id is null or new.requested_datetime is null then
        return new;
    end if;

    perform pg_advisory_xact_lock(new.doctor_hospital_id);

    new_start := new.requested_datetime;
    new_end := new.requested_datetime + ((coalesce(new.duration_minutes, 15) || ' minutes')::interval);

    if exists (
        select 1
        from public.appointment a
        where a.doctor_hospital_id = new.doctor_hospital_id
          and a.status not in ('cancelled', 'no_show')
          and new_start < (a.appointment_datetime + ((coalesce(a.duration_minutes, 15) || ' minutes')::interval))
          and new_end > a.appointment_datetime
    ) then
        raise exception 'Requested slot overlaps with an existing appointment.';
    end if;

    if exists (
        select 1
        from public.appointment_request ar
        where ar.doctor_hospital_id = new.doctor_hospital_id
          and ar.request_id <> coalesce(new.request_id, -1)
          and ar.status in ('pending', 'confirmed')
          and new_start < (ar.requested_datetime + ((coalesce(ar.duration_minutes, 15) || ' minutes')::interval))
          and new_end > ar.requested_datetime
    ) then
        raise exception 'Requested slot overlaps with another pending or confirmed request.';
    end if;

    return new;
end;
$$;


drop trigger if exists trg_prevent_appointment_request_overlap on public.appointment_request;

create trigger trg_prevent_appointment_request_overlap
before insert or update of doctor_hospital_id, requested_datetime, duration_minutes, status
on public.appointment_request
for each row
execute function public.prevent_appointment_request_overlap();


-- ============================================================
-- 12. Doctor schedule overlap guard
-- ============================================================

create or replace function public.prevent_doctor_schedule_overlap()
returns trigger
language plpgsql
as $$
begin
    if new.is_active is false then
        return new;
    end if;

    if new.start_time >= new.end_time then
        raise exception 'Schedule start time must be before end time.';
    end if;

    if exists (
        select 1
        from public.doctor_hospital_schedule s
        where s.doctor_hospital_id = new.doctor_hospital_id
          and s.schedule_id <> coalesce(new.schedule_id, -1)
          and s.day_of_week = new.day_of_week
          and s.is_active = true
          and new.start_time < s.end_time
          and new.end_time > s.start_time
    ) then
        raise exception 'Schedule overlaps with an existing active schedule.';
    end if;

    return new;
end;
$$;


drop trigger if exists trg_prevent_doctor_schedule_overlap on public.doctor_hospital_schedule;

create trigger trg_prevent_doctor_schedule_overlap
before insert or update of doctor_hospital_id, day_of_week, start_time, end_time, is_active
on public.doctor_hospital_schedule
for each row
execute function public.prevent_doctor_schedule_overlap();


-- ============================================================
-- 13. Dynamic field snapshots
-- Protects old visit values if doctor later renames/deletes fields.
-- ============================================================

alter table public.visit_field_value
add column if not exists field_label_snapshot text;

alter table public.visit_field_value
add column if not exists field_type_snapshot text;

alter table public.visit_field_value
add column if not exists field_context_snapshot text;


create or replace function public.snapshot_visit_field_metadata()
returns trigger
language plpgsql
as $$
declare
    field_record record;
begin
    select
        field_label,
        field_type,
        field_context
    into field_record
    from public.doctor_form_field
    where field_id = new.field_id
    limit 1;

    if field_record is not null then
        new.field_label_snapshot := coalesce(new.field_label_snapshot, field_record.field_label);
        new.field_type_snapshot := coalesce(new.field_type_snapshot, field_record.field_type);
        new.field_context_snapshot := coalesce(new.field_context_snapshot, field_record.field_context);
    end if;

    return new;
end;
$$;


drop trigger if exists trg_snapshot_visit_field_metadata on public.visit_field_value;

create trigger trg_snapshot_visit_field_metadata
before insert or update of field_id
on public.visit_field_value
for each row
execute function public.snapshot_visit_field_metadata();


-- Fill snapshots for existing data
update public.visit_field_value vfv
set
    field_label_snapshot = coalesce(vfv.field_label_snapshot, dff.field_label),
    field_type_snapshot = coalesce(vfv.field_type_snapshot, dff.field_type),
    field_context_snapshot = coalesce(vfv.field_context_snapshot, dff.field_context)
from public.doctor_form_field dff
where dff.field_id = vfv.field_id;


-- ============================================================
-- 14. Prescription immutable snapshot
-- ============================================================

create table if not exists public.prescription_snapshot (
    snapshot_id bigint generated always as identity primary key,
    visit_id bigint,
    appointment_id bigint,
    patient_id bigint,
    doctor_id bigint,
    snapshot_json jsonb not null,
    created_by_user_id bigint,
    created_by_role text,
    created_at timestamptz not null default now()
);

create index if not exists idx_prescription_snapshot_visit
on public.prescription_snapshot(visit_id);

create index if not exists idx_prescription_snapshot_patient
on public.prescription_snapshot(patient_id);

create index if not exists idx_prescription_snapshot_created
on public.prescription_snapshot(created_at);


-- ============================================================
-- 15. Helpful indexes
-- ============================================================

create index if not exists idx_appointment_doctor_datetime_step12
on public.appointment(doctor_id, appointment_datetime);

create index if not exists idx_appointment_doctor_fee_step12
on public.appointment(doctor_id, fee_status);

create index if not exists idx_appointment_payment_log_appointment_step12
on public.appointment_payment_log(appointment_id);

create index if not exists idx_appointment_request_patient_step12
on public.appointment_request(patient_id);

create index if not exists idx_appointment_request_status_step12
on public.appointment_request(status);