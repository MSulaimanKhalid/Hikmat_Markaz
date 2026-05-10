-- ============================================================
-- Hikmat Markaz Full Flow Schema Update
-- This migration upgrades the original 13-table schema.
-- ============================================================


-- ============================================================
-- 1. COMMON LOGIN / ROLE TABLE
-- ============================================================

create table if not exists public.app_user (
    user_id bigint generated always as identity primary key,

    email varchar(150) unique,
    cnic varchar(15) unique,
    phone varchar(20),

    password_hash varchar(255) not null,

    role varchar(20) not null,
    status varchar(20) not null default 'pending',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint chk_app_user_role
        check (role in ('admin', 'doctor', 'pa', 'patient')),

    constraint chk_app_user_status
        check (status in ('pending', 'active', 'rejected', 'inactive')),

    constraint chk_app_user_login_identifier
        check (email is not null or cnic is not null)
);


-- ============================================================
-- 2. DOCTOR TABLE UPDATES
-- Doctor signup approval + common login link
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

-- Since login is now handled by app_user.password_hash,
-- doctor.password_hash should no longer be compulsory.
alter table public.doctor
alter column password_hash drop not null;

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


-- ============================================================
-- 3. PA TABLE UPDATES
-- PA identified by CNIC + common login link
-- ============================================================

alter table public.pa
add column if not exists user_id bigint;

alter table public.pa
add column if not exists cnic varchar(15);

-- Since login is now handled by app_user.password_hash,
-- pa.password_hash should no longer be compulsory.
alter table public.pa
alter column password_hash drop not null;

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


-- ============================================================
-- 4. PATIENT TABLE UPDATES
-- Patient portal login + optional age field
-- ============================================================

alter table public.patient
add column if not exists user_id bigint;

alter table public.patient
add column if not exists age_years int;

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

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'patient'
          and constraint_name = 'chk_patient_age_years'
    ) then
        alter table public.patient
        add constraint chk_patient_age_years
        check (age_years is null or age_years between 0 and 130);
    end if;
end $$;


-- ============================================================
-- 5. DOCTOR_HOSPITAL UPDATES
-- Default consultation duration added
-- ============================================================

alter table public.doctor_hospital
add column if not exists default_consultation_minutes int not null default 15;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'doctor_hospital'
          and constraint_name = 'chk_doctor_hospital_default_consultation_minutes'
    ) then
        alter table public.doctor_hospital
        add constraint chk_doctor_hospital_default_consultation_minutes
        check (default_consultation_minutes > 0);
    end if;
end $$;


-- ============================================================
-- 6. DOCTOR_HOSPITAL_SCHEDULE
-- Better scheduling than storing only comma-separated days
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


-- ============================================================
-- 7. PA_INVITE UPDATES
-- Invite now uses PA CNIC + email
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


-- ============================================================
-- 8. DOCTOR_PA UPDATES
-- Optional trace to invitation
-- ============================================================

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
-- 9. APPOINTMENT TABLE UPDATES
-- Queue, fee status, custom duration, online/walk-in source
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
add column if not exists scheduled_end timestamptz;

alter table public.appointment
add column if not exists duration_minutes int;

alter table public.appointment
add column if not exists fee_charged int;

alter table public.appointment
add column if not exists fee_status varchar(20) not null default 'pending';

alter table public.appointment
add column if not exists source varchar(20) not null default 'walk_in';

alter table public.appointment
add column if not exists queue_status varchar(20) not null default 'waiting';

alter table public.appointment
add column if not exists priority_level int not null default 0;

alter table public.appointment
add column if not exists is_emergency boolean not null default false;

alter table public.appointment
add column if not exists priority_reason text;

alter table public.appointment
add column if not exists actual_start timestamptz;

alter table public.appointment
add column if not exists actual_end timestamptz;

alter table public.appointment
add column if not exists payment_received_by_pa_id bigint;

alter table public.appointment
add column if not exists notes text;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment'
          and constraint_name = 'fk_appointment_payment_received_by_pa'
    ) then
        alter table public.appointment
        add constraint fk_appointment_payment_received_by_pa
        foreign key (payment_received_by_pa_id)
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
          and constraint_name = 'chk_appointment_queue_status'
    ) then
        alter table public.appointment
        add constraint chk_appointment_queue_status
        check (queue_status in ('waiting', 'in_consultation', 'completed', 'cancelled', 'no_show', 'skipped'));
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

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'appointment'
          and constraint_name = 'uq_appointment_id_doctor'
    ) then
        alter table public.appointment
        add constraint uq_appointment_id_doctor
        unique (appointment_id, doctor_id);
    end if;
end $$;


-- ============================================================
-- 10. APPOINTMENT_REQUEST
-- Online appointment request before PA confirmation
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
-- 11. VISIT TABLE UPDATES
-- Add doctor_id for stronger dynamic-form integrity
-- ============================================================

alter table public.visit
add column if not exists doctor_id bigint;

update public.visit v
set doctor_id = a.doctor_id
from public.appointment a
where v.appointment_id = a.appointment_id
  and v.doctor_id is null;

alter table public.visit
add column if not exists general_diagnosis text;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'visit'
          and constraint_name = 'fk_visit_doctor'
    ) then
        alter table public.visit
        add constraint fk_visit_doctor
        foreign key (doctor_id)
        references public.doctor(doctor_id)
        on delete restrict;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'visit'
          and constraint_name = 'fk_visit_appointment_same_doctor'
    ) then
        alter table public.visit
        add constraint fk_visit_appointment_same_doctor
        foreign key (appointment_id, doctor_id)
        references public.appointment(appointment_id, doctor_id)
        on delete restrict;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where constraint_schema = 'public'
          and table_name = 'visit'
          and constraint_name = 'uq_visit_id_doctor'
    ) then
        alter table public.visit
        add constraint uq_visit_id_doctor
        unique (visit_id, doctor_id);
    end if;
end $$;


-- ============================================================
-- 12. DYNAMIC FORM FIELD DEFINITIONS
-- Doctor defines custom PA intake and consultation fields
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
        unique (doctor_id, field_context, field_key),

    constraint uq_doctor_form_field_id_doctor
        unique (field_id, doctor_id)
);


-- ============================================================
-- 13. DYNAMIC PA INTAKE VALUES
-- Values filled by PA during appointment booking/check-in
-- ============================================================

create table if not exists public.appointment_field_value (
    value_id bigint generated always as identity primary key,

    appointment_id bigint not null,
    doctor_id bigint not null,
    field_id bigint not null,

    field_label_snapshot varchar(150) not null,
    field_type_snapshot varchar(30) not null,

    value jsonb,
    created_at timestamptz not null default now(),

    constraint uq_appointment_field_value
        unique (appointment_id, field_id),

    constraint fk_appointment_field_value_appointment
        foreign key (appointment_id, doctor_id)
        references public.appointment(appointment_id, doctor_id)
        on delete cascade,

    constraint fk_appointment_field_value_field
        foreign key (field_id, doctor_id)
        references public.doctor_form_field(field_id, doctor_id)
        on delete restrict
);


-- ============================================================
-- 14. DYNAMIC CONSULTATION VALUES
-- Values filled by doctor during consultation
-- ============================================================

create table if not exists public.visit_field_value (
    value_id bigint generated always as identity primary key,

    visit_id bigint not null,
    doctor_id bigint not null,
    field_id bigint not null,

    field_label_snapshot varchar(150) not null,
    field_type_snapshot varchar(30) not null,

    value jsonb,
    created_at timestamptz not null default now(),

    constraint uq_visit_field_value
        unique (visit_id, field_id),

    constraint fk_visit_field_value_visit
        foreign key (visit_id, doctor_id)
        references public.visit(visit_id, doctor_id)
        on delete cascade,

    constraint fk_visit_field_value_field
        foreign key (field_id, doctor_id)
        references public.doctor_form_field(field_id, doctor_id)
        on delete restrict
);


-- ============================================================
-- 15. REVENUE_RECORD UPDATES
-- More complete financial log
-- ============================================================

alter table public.revenue_record
add column if not exists received_by_pa_id bigint;

alter table public.revenue_record
add column if not exists payment_method varchar(30);

alter table public.revenue_record
add column if not exists notes text;

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
-- 16. INDEXES
-- ============================================================

create index if not exists idx_app_user_email
on public.app_user(email);

create index if not exists idx_app_user_cnic
on public.app_user(cnic);

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

create index if not exists idx_appointment_queue
on public.appointment(doctor_id, doctor_hospital_id, queue_status, priority_level, scheduled_start);

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

create index if not exists idx_visit_doctor_id
on public.visit(doctor_id);

create index if not exists idx_doctor_form_field_doctor_context
on public.doctor_form_field(doctor_id, field_context, is_active);

create index if not exists idx_appointment_field_value_appointment
on public.appointment_field_value(appointment_id);

create index if not exists idx_visit_field_value_visit
on public.visit_field_value(visit_id);

create index if not exists idx_revenue_received_by_pa
on public.revenue_record(received_by_pa_id);


-- ============================================================
-- 17. OPTIONAL ADMIN SEED
-- Do NOT store plain password here.
-- Replace <bcrypt_hash_here> with a real bcrypt hash generated by backend.
-- ============================================================

-- insert into public.app_user (email, password_hash, role, status)
-- values ('admin@hikmatmarkaz.com', '<bcrypt_hash_here>', 'admin', 'active')
-- on conflict (email) do nothing;