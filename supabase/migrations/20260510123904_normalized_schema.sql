-- ============================================================
-- Hikmat Markaz Normalized Schema Cleanup Migration
-- Full corrected version with dependency-order fixes.
-- ============================================================


-- ============================================================
-- 0. DROP OLD DEPENDENT CONSTRAINTS FIRST
-- CASCADE is used only on old redundant composite constraints.
-- ============================================================

do $$
begin
    if to_regclass('public.appointment_field_value') is not null then
        execute 'alter table public.appointment_field_value drop constraint if exists fk_appointment_field_value_appointment';
        execute 'alter table public.appointment_field_value drop constraint if exists fk_appointment_field_value_field';
    end if;

    if to_regclass('public.visit_field_value') is not null then
        execute 'alter table public.visit_field_value drop constraint if exists fk_visit_field_value_visit';
        execute 'alter table public.visit_field_value drop constraint if exists fk_visit_field_value_field';
    end if;

    if to_regclass('public.visit') is not null then
        execute 'alter table public.visit drop constraint if exists fk_visit_appointment_same_doctor';
        execute 'alter table public.visit drop constraint if exists fk_visit_doctor';
        execute 'alter table public.visit drop constraint if exists uq_visit_id_doctor cascade';
    end if;

    if to_regclass('public.appointment') is not null then
        execute 'alter table public.appointment drop constraint if exists uq_appointment_id_doctor cascade';
    end if;

    if to_regclass('public.doctor_form_field') is not null then
        execute 'alter table public.doctor_form_field drop constraint if exists uq_doctor_form_field_id_doctor cascade';
    end if;
end $$;


-- ============================================================
-- 1. APP_USER: CENTRAL LOGIN TABLE
-- ============================================================

create table if not exists public.app_user (
    user_id bigint generated always as identity primary key,
    email varchar(150) unique,
    phone varchar(20),
    password_hash varchar(255) not null,
    role varchar(20) not null,
    status varchar(20) not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint chk_app_user_role
        check (role in ('admin', 'doctor', 'pa', 'patient')),

    constraint chk_app_user_status
        check (status in ('pending', 'active', 'rejected', 'inactive'))
);

alter table public.app_user
drop constraint if exists chk_app_user_login_identifier;

drop index if exists public.idx_app_user_cnic;

alter table public.app_user
drop column if exists cnic;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'app_user'
          and constraint_name = 'chk_app_user_email_required_for_non_patient'
    ) then
        alter table public.app_user
        add constraint chk_app_user_email_required_for_non_patient
        check (
            role = 'patient'
            or email is not null
        );
    end if;
end $$;


-- ============================================================
-- 2. DOCTOR CLEANUP
-- Doctor keeps professional data.
-- Password/email/phone are handled by app_user.
-- ============================================================

alter table public.doctor
add column if not exists user_id bigint;

alter table public.doctor
add column if not exists approval_status varchar(20) not null default 'pending';

alter table public.doctor
add column if not exists approved_by bigint;

alter table public.doctor
add column if not exists approved_at timestamptz;

alter table public.doctor
add column if not exists rejection_reason text;

alter table public.doctor
add column if not exists settings_completed boolean not null default false;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'doctor'
          and constraint_name = 'fk_doctor_app_user'
    ) then
        alter table public.doctor
        add constraint fk_doctor_app_user
        foreign key (user_id)
        references public.app_user(user_id)
        on delete cascade;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'doctor'
          and constraint_name = 'uq_doctor_user_id'
    ) then
        alter table public.doctor
        add constraint uq_doctor_user_id
        unique (user_id);
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'doctor'
          and constraint_name = 'chk_doctor_approval_status'
    ) then
        alter table public.doctor
        add constraint chk_doctor_approval_status
        check (approval_status in ('pending', 'approved', 'rejected'));
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'doctor'
          and constraint_name = 'fk_doctor_approved_by'
    ) then
        alter table public.doctor
        add constraint fk_doctor_approved_by
        foreign key (approved_by)
        references public.app_user(user_id)
        on delete set null;
    end if;
end $$;

alter table public.doctor
drop column if exists password_hash;

alter table public.doctor
drop column if exists email;

alter table public.doctor
drop column if exists phone;


-- ============================================================
-- 3. PA CLEANUP
-- PA keeps profile/CNIC.
-- Login/password/email/phone are handled by app_user.
-- ============================================================

alter table public.pa
add column if not exists user_id bigint;

alter table public.pa
add column if not exists cnic varchar(15);

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'pa'
          and constraint_name = 'fk_pa_app_user'
    ) then
        alter table public.pa
        add constraint fk_pa_app_user
        foreign key (user_id)
        references public.app_user(user_id)
        on delete cascade;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'pa'
          and constraint_name = 'uq_pa_user_id'
    ) then
        alter table public.pa
        add constraint uq_pa_user_id
        unique (user_id);
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'pa'
          and constraint_name = 'uq_pa_cnic'
    ) then
        alter table public.pa
        add constraint uq_pa_cnic
        unique (cnic);
    end if;
end $$;

alter table public.pa
drop column if exists password_hash;

alter table public.pa
drop column if exists email;

alter table public.pa
drop column if exists phone;


-- ============================================================
-- 4. PATIENT CLEANUP
-- Patient keeps CNIC and optional contact data.
-- age_years removed because age is derived from dob.
-- ============================================================

alter table public.patient
add column if not exists user_id bigint;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'patient'
          and constraint_name = 'fk_patient_app_user'
    ) then
        alter table public.patient
        add constraint fk_patient_app_user
        foreign key (user_id)
        references public.app_user(user_id)
        on delete set null;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'patient'
          and constraint_name = 'uq_patient_user_id'
    ) then
        alter table public.patient
        add constraint uq_patient_user_id
        unique (user_id);
    end if;
end $$;

alter table public.patient
drop constraint if exists chk_patient_age_years;

alter table public.patient
drop column if exists age_years;


-- ============================================================
-- 5. DOCTOR_HOSPITAL_SCHEDULE
-- doctor_hospital stores hospital identity only.
-- doctor_hospital_schedule stores day/time/fee/duration.
-- ============================================================

create table if not exists public.doctor_hospital_schedule (
    schedule_id bigint generated always as identity primary key,
    doctor_hospital_id bigint not null references public.doctor_hospital(id) on delete cascade,

    day_of_week int not null,
    start_time time not null,
    end_time time not null,

    default_consultation_minutes int not null default 15,
    consultation_fee int not null,

    is_active boolean not null default true,
    created_at timestamptz not null default now(),

    constraint chk_schedule_day_of_week
        check (day_of_week between 0 and 6),

    constraint chk_schedule_time
        check (start_time < end_time),

    constraint chk_schedule_duration
        check (default_consultation_minutes > 0),

    constraint chk_schedule_fee
        check (consultation_fee >= 0)
);

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'doctor_hospital'
          and column_name = 'consultation_days'
    )
    and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'doctor_hospital'
          and column_name = 'slot_start'
    )
    and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'doctor_hospital'
          and column_name = 'slot_end'
    )
    and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'doctor_hospital'
          and column_name = 'consultation_fee'
    ) then

        insert into public.doctor_hospital_schedule (
            doctor_hospital_id,
            day_of_week,
            start_time,
            end_time,
            default_consultation_minutes,
            consultation_fee
        )
        select
            dh.id,
            case lower(trim(day_value))
                when 'sun' then 0
                when 'sunday' then 0
                when 'mon' then 1
                when 'monday' then 1
                when 'tue' then 2
                when 'tuesday' then 2
                when 'wed' then 3
                when 'wednesday' then 3
                when 'thu' then 4
                when 'thursday' then 4
                when 'fri' then 5
                when 'friday' then 5
                when 'sat' then 6
                when 'saturday' then 6
            end as day_of_week,
            dh.slot_start,
            dh.slot_end,
            15,
            dh.consultation_fee
        from public.doctor_hospital dh
        cross join lateral regexp_split_to_table(coalesce(dh.consultation_days, ''), '\s*,\s*') as days(day_value)
        where dh.slot_start is not null
          and dh.slot_end is not null
          and dh.consultation_fee is not null
          and lower(trim(day_value)) in (
              'sun', 'sunday',
              'mon', 'monday',
              'tue', 'tuesday',
              'wed', 'wednesday',
              'thu', 'thursday',
              'fri', 'friday',
              'sat', 'saturday'
          )
          and not exists (
              select 1
              from public.doctor_hospital_schedule s
              where s.doctor_hospital_id = dh.id
          );
    end if;
end $$;

alter table public.doctor_hospital
drop constraint if exists chk_consultation_fee_non_negative;

alter table public.doctor_hospital
drop constraint if exists chk_slot_time_valid;

alter table public.doctor_hospital
drop constraint if exists chk_doctor_hospital_default_consultation_minutes;

alter table public.doctor_hospital
drop column if exists consultation_days;

alter table public.doctor_hospital
drop column if exists slot_start;

alter table public.doctor_hospital
drop column if exists slot_end;

alter table public.doctor_hospital
drop column if exists consultation_fee;

alter table public.doctor_hospital
drop column if exists default_consultation_minutes;


-- ============================================================
-- 6. PA_INVITE AND DOCTOR_PA
-- ============================================================

alter table public.pa_invite
add column if not exists invited_cnic varchar(15);

alter table public.pa_invite
add column if not exists accepted_by_pa_id bigint;

alter table public.pa_invite
add column if not exists accepted_at timestamptz;

alter table public.pa_invite
drop constraint if exists chk_pa_invite_status;

alter table public.pa_invite
add constraint chk_pa_invite_status
check (status in ('pending', 'accepted', 'expired', 'cancelled'));

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'pa_invite'
          and constraint_name = 'fk_pa_invite_accepted_by_pa'
    ) then
        alter table public.pa_invite
        add constraint fk_pa_invite_accepted_by_pa
        foreign key (accepted_by_pa_id)
        references public.pa(pa_id)
        on delete set null;
    end if;
end $$;

alter table public.doctor_pa
add column if not exists invite_id bigint;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'doctor_pa'
          and constraint_name = 'fk_doctor_pa_invite'
    ) then
        alter table public.doctor_pa
        add constraint fk_doctor_pa_invite
        foreign key (invite_id)
        references public.pa_invite(invite_id)
        on delete set null;
    end if;
end $$;


-- ============================================================
-- 7. APPOINTMENT CLEANUP
-- scheduled_end and queue_status removed because they are derived.
-- Queue is derived from status, actual_start, actual_end, and priority_level.
-- ============================================================

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'appointment'
          and column_name = 'appointment_datetime'
    )
    and not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'appointment'
          and column_name = 'scheduled_start'
    ) then
        alter table public.appointment
        rename column appointment_datetime to scheduled_start;
    end if;
end $$;

alter table public.appointment
add column if not exists duration_minutes int;

alter table public.appointment
add column if not exists fee_charged int;

alter table public.appointment
add column if not exists fee_status varchar(20) not null default 'pending';

alter table public.appointment
add column if not exists source varchar(20) not null default 'walk_in';

alter table public.appointment
add column if not exists priority_level int not null default 0;

alter table public.appointment
add column if not exists priority_reason text;

alter table public.appointment
add column if not exists actual_start timestamptz;

alter table public.appointment
add column if not exists actual_end timestamptz;

alter table public.appointment
add column if not exists notes text;

alter table public.appointment
drop constraint if exists fk_appointment_payment_received_by_pa;

alter table public.appointment
drop constraint if exists chk_appointment_queue_status;

drop index if exists public.idx_appointment_queue;

alter table public.appointment
drop column if exists scheduled_end;

alter table public.appointment
drop column if exists queue_status;

alter table public.appointment
drop column if exists is_emergency;

alter table public.appointment
drop column if exists payment_received_by_pa_id;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment'
          and constraint_name = 'chk_appointment_duration'
    ) then
        alter table public.appointment
        add constraint chk_appointment_duration
        check (duration_minutes is null or duration_minutes > 0);
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment'
          and constraint_name = 'chk_appointment_fee_charged'
    ) then
        alter table public.appointment
        add constraint chk_appointment_fee_charged
        check (fee_charged is null or fee_charged >= 0);
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment'
          and constraint_name = 'chk_appointment_fee_status'
    ) then
        alter table public.appointment
        add constraint chk_appointment_fee_status
        check (fee_status in ('pending', 'paid', 'waived', 'refunded'));
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment'
          and constraint_name = 'chk_appointment_source'
    ) then
        alter table public.appointment
        add constraint chk_appointment_source
        check (source in ('walk_in', 'online', 'phone'));
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment'
          and constraint_name = 'chk_appointment_actual_time'
    ) then
        alter table public.appointment
        add constraint chk_appointment_actual_time
        check (
            actual_start is null
            or actual_end is null
            or actual_start <= actual_end
        );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment'
          and constraint_name = 'chk_appointment_start_requires_fee'
    ) then
        alter table public.appointment
        add constraint chk_appointment_start_requires_fee
        check (
            actual_start is null
            or fee_status in ('paid', 'waived')
        );
    end if;
end $$;


-- ============================================================
-- 8. APPOINTMENT_REQUEST
-- Online request before PA confirms real appointment.
-- ============================================================

create table if not exists public.appointment_request (
    request_id bigint generated always as identity primary key,

    patient_id bigint not null references public.patient(patient_id) on delete restrict,
    doctor_id bigint not null references public.doctor(doctor_id) on delete restrict,
    doctor_hospital_id bigint not null,

    requested_start timestamptz not null,
    requested_duration_minutes int,

    status varchar(20) not null default 'pending',

    confirmed_by_pa_id bigint references public.pa(pa_id) on delete set null,
    confirmed_appointment_id bigint unique references public.appointment(appointment_id) on delete set null,

    rejection_reason text,
    patient_notes text,

    created_at timestamptz not null default now(),
    confirmed_at timestamptz,

    constraint chk_appointment_request_status
        check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),

    constraint chk_appointment_request_duration
        check (requested_duration_minutes is null or requested_duration_minutes > 0),

    constraint fk_request_hospital_same_doctor
        foreign key (doctor_hospital_id, doctor_id)
        references public.doctor_hospital(id, doctor_id)
        on delete restrict
);


-- ============================================================
-- 9. VISIT CLEANUP
-- Visit stores clinical encounter only.
-- Diagnosis table stores official diagnosis.
-- Dynamic consultation values go to visit_field_value.
-- ============================================================

drop index if exists public.idx_visit_doctor_id;

alter table public.visit
drop column if exists doctor_id;

alter table public.visit
drop column if exists general_diagnosis;


-- ============================================================
-- 10. DOCTOR_FORM_FIELD
-- Defines doctor-specific dynamic form fields.
-- ============================================================

create table if not exists public.doctor_form_field (
    field_id bigint generated always as identity primary key,

    doctor_id bigint not null references public.doctor(doctor_id) on delete cascade,

    field_context varchar(30) not null,
    field_key varchar(100) not null,
    field_label varchar(150) not null,
    field_type varchar(30) not null,

    is_required boolean not null default false,
    options jsonb,
    default_value jsonb,

    placeholder varchar(150),
    help_text text,

    display_order int not null default 0,
    is_active boolean not null default true,

    created_at timestamptz not null default now(),

    constraint chk_doctor_form_field_context
        check (field_context in ('patient_intake', 'consultation')),

    constraint chk_doctor_form_field_type
        check (field_type in ('text', 'number', 'date', 'time', 'textarea', 'select', 'checkbox', 'boolean')),

    constraint uq_doctor_form_field_key
        unique (doctor_id, field_context, field_key)
);


-- ============================================================
-- 11. APPOINTMENT_FIELD_VALUE
-- Stores dynamic PA intake answers.
-- No doctor_id or label snapshots to avoid redundancy.
-- ============================================================

create table if not exists public.appointment_field_value (
    value_id bigint generated always as identity primary key,
    appointment_id bigint not null,
    field_id bigint not null,
    value jsonb,
    created_at timestamptz not null default now(),

    constraint uq_appointment_field_value
        unique (appointment_id, field_id)
);

alter table public.appointment_field_value
drop column if exists doctor_id;

alter table public.appointment_field_value
drop column if exists field_label_snapshot;

alter table public.appointment_field_value
drop column if exists field_type_snapshot;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment_field_value'
          and constraint_name = 'fk_appointment_field_value_appointment'
    ) then
        alter table public.appointment_field_value
        add constraint fk_appointment_field_value_appointment
        foreign key (appointment_id)
        references public.appointment(appointment_id)
        on delete cascade;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment_field_value'
          and constraint_name = 'fk_appointment_field_value_field'
    ) then
        alter table public.appointment_field_value
        add constraint fk_appointment_field_value_field
        foreign key (field_id)
        references public.doctor_form_field(field_id)
        on delete restrict;
    end if;
end $$;


-- ============================================================
-- 12. VISIT_FIELD_VALUE
-- Stores dynamic doctor consultation answers.
-- No doctor_id or label snapshots to avoid redundancy.
-- ============================================================

create table if not exists public.visit_field_value (
    value_id bigint generated always as identity primary key,
    visit_id bigint not null,
    field_id bigint not null,
    value jsonb,
    created_at timestamptz not null default now(),

    constraint uq_visit_field_value
        unique (visit_id, field_id)
);

alter table public.visit_field_value
drop column if exists doctor_id;

alter table public.visit_field_value
drop column if exists field_label_snapshot;

alter table public.visit_field_value
drop column if exists field_type_snapshot;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'visit_field_value'
          and constraint_name = 'fk_visit_field_value_visit'
    ) then
        alter table public.visit_field_value
        add constraint fk_visit_field_value_visit
        foreign key (visit_id)
        references public.visit(visit_id)
        on delete cascade;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'visit_field_value'
          and constraint_name = 'fk_visit_field_value_field'
    ) then
        alter table public.visit_field_value
        add constraint fk_visit_field_value_field
        foreign key (field_id)
        references public.doctor_form_field(field_id)
        on delete restrict;
    end if;
end $$;


-- ============================================================
-- 13. TRIGGERS TO VALIDATE DYNAMIC FIELD OWNERSHIP
-- ============================================================

create or replace function public.validate_appointment_field_value()
returns trigger
language plpgsql
as $$
declare
    v_appointment_doctor_id bigint;
    v_field_doctor_id bigint;
    v_field_context varchar(30);
begin
    select a.doctor_id
    into v_appointment_doctor_id
    from public.appointment a
    where a.appointment_id = new.appointment_id;

    select f.doctor_id, f.field_context
    into v_field_doctor_id, v_field_context
    from public.doctor_form_field f
    where f.field_id = new.field_id;

    if v_appointment_doctor_id is null then
        raise exception 'Invalid appointment_id: %', new.appointment_id;
    end if;

    if v_field_doctor_id is null then
        raise exception 'Invalid field_id: %', new.field_id;
    end if;

    if v_appointment_doctor_id <> v_field_doctor_id then
        raise exception 'Dynamic intake field does not belong to the appointment doctor';
    end if;

    if v_field_context <> 'patient_intake' then
        raise exception 'appointment_field_value can only use patient_intake fields';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_validate_appointment_field_value
on public.appointment_field_value;

create trigger trg_validate_appointment_field_value
before insert or update
on public.appointment_field_value
for each row
execute function public.validate_appointment_field_value();


create or replace function public.validate_visit_field_value()
returns trigger
language plpgsql
as $$
declare
    v_visit_doctor_id bigint;
    v_field_doctor_id bigint;
    v_field_context varchar(30);
begin
    select a.doctor_id
    into v_visit_doctor_id
    from public.visit v
    join public.appointment a
      on a.appointment_id = v.appointment_id
    where v.visit_id = new.visit_id;

    select f.doctor_id, f.field_context
    into v_field_doctor_id, v_field_context
    from public.doctor_form_field f
    where f.field_id = new.field_id;

    if v_visit_doctor_id is null then
        raise exception 'Invalid visit_id: %', new.visit_id;
    end if;

    if v_field_doctor_id is null then
        raise exception 'Invalid field_id: %', new.field_id;
    end if;

    if v_visit_doctor_id <> v_field_doctor_id then
        raise exception 'Dynamic consultation field does not belong to the visit doctor';
    end if;

    if v_field_context <> 'consultation' then
        raise exception 'visit_field_value can only use consultation fields';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_validate_visit_field_value
on public.visit_field_value;

create trigger trg_validate_visit_field_value
before insert or update
on public.visit_field_value
for each row
execute function public.validate_visit_field_value();


-- ============================================================
-- 14. REVENUE_RECORD CLEANUP
-- Revenue references appointment only.
-- Doctor/hospital are obtained by joining appointment.
-- ============================================================

alter table public.revenue_record
add column if not exists received_by_pa_id bigint;

alter table public.revenue_record
add column if not exists payment_method varchar(30);

alter table public.revenue_record
add column if not exists notes text;

alter table public.revenue_record
drop constraint if exists fk_revenue_doctor;

alter table public.revenue_record
drop constraint if exists fk_revenue_hospital_same_doctor;

drop index if exists public.idx_revenue_doctor_paid_at;

drop index if exists public.idx_revenue_hospital_paid_at;

alter table public.revenue_record
drop column if exists doctor_id;

alter table public.revenue_record
drop column if exists doctor_hospital_id;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'revenue_record'
          and constraint_name = 'fk_revenue_received_by_pa'
    ) then
        alter table public.revenue_record
        add constraint fk_revenue_received_by_pa
        foreign key (received_by_pa_id)
        references public.pa(pa_id)
        on delete set null;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'revenue_record'
          and constraint_name = 'chk_revenue_payment_method'
    ) then
        alter table public.revenue_record
        add constraint chk_revenue_payment_method
        check (
            payment_method is null
            or payment_method in ('cash', 'card', 'bank_transfer', 'online', 'other')
        );
    end if;
end $$;


-- ============================================================
-- 15. FINAL INDEXES
-- ============================================================

create index if not exists idx_app_user_email
on public.app_user(email);

create index if not exists idx_app_user_role_status
on public.app_user(role, status);

create index if not exists idx_doctor_user_id
on public.doctor(user_id);

create index if not exists idx_doctor_approval_status
on public.doctor(approval_status);

create index if not exists idx_pa_user_id
on public.pa(user_id);

create index if not exists idx_pa_cnic
on public.pa(cnic);

create index if not exists idx_patient_user_id
on public.patient(user_id);

create index if not exists idx_doctor_hospital_schedule_hospital
on public.doctor_hospital_schedule(doctor_hospital_id);

create index if not exists idx_doctor_hospital_schedule_day
on public.doctor_hospital_schedule(day_of_week);

create index if not exists idx_pa_invite_invited_cnic
on public.pa_invite(invited_cnic);

create index if not exists idx_appointment_scheduled_start
on public.appointment(scheduled_start);

create index if not exists idx_appointment_queue_normalized
on public.appointment(doctor_id, doctor_hospital_id, status, priority_level, scheduled_start);

create index if not exists idx_appointment_fee_status
on public.appointment(fee_status);

create index if not exists idx_appointment_source
on public.appointment(source);

create index if not exists idx_appointment_request_patient
on public.appointment_request(patient_id);

create index if not exists idx_appointment_request_doctor_hospital
on public.appointment_request(doctor_id, doctor_hospital_id);

create index if not exists idx_appointment_request_status
on public.appointment_request(status);

create index if not exists idx_doctor_form_field_doctor_context
on public.doctor_form_field(doctor_id, field_context, is_active);

create index if not exists idx_appointment_field_value_appointment
on public.appointment_field_value(appointment_id);

create index if not exists idx_visit_field_value_visit
on public.visit_field_value(visit_id);

create index if not exists idx_revenue_received_by_pa
on public.revenue_record(received_by_pa_id);

create index if not exists idx_revenue_appointment
on public.revenue_record(appointment_id);