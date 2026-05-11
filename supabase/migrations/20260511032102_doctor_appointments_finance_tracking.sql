-- ============================================================
-- Hikmat Markaz - Step 11 Doctor Appointments + Finance Tracking
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 1. Appointment finance compatibility
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
drop constraint if exists chk_appointment_payment_method;

alter table public.appointment
add constraint chk_appointment_payment_method
check (
    payment_method is null
    or payment_method in ('cash', 'card', 'bank_transfer', 'online', 'other')
);


alter table public.appointment
drop constraint if exists chk_appointment_fee_status;

alter table public.appointment
add constraint chk_appointment_fee_status
check (
    fee_status in ('pending', 'paid', 'waived')
);


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
drop constraint if exists chk_appointment_source;

alter table public.appointment
add constraint chk_appointment_source
check (
    source in ('walk_in', 'online_request', 'phone_call')
);


-- ============================================================
-- 2. Appointment payment audit log
-- appointment = current financial state
-- appointment_payment_log = history of changes
-- ============================================================

create table if not exists public.appointment_payment_log (
    payment_log_id bigint generated always as identity primary key,
    appointment_id bigint,
    doctor_id bigint,
    changed_by_user_id bigint,
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
add column if not exists appointment_id bigint;

alter table public.appointment_payment_log
add column if not exists doctor_id bigint;

alter table public.appointment_payment_log
add column if not exists changed_by_user_id bigint;

alter table public.appointment_payment_log
add column if not exists old_fee_status text;

alter table public.appointment_payment_log
add column if not exists new_fee_status text;

alter table public.appointment_payment_log
add column if not exists old_fee_charged numeric(10, 2);

alter table public.appointment_payment_log
add column if not exists new_fee_charged numeric(10, 2);

alter table public.appointment_payment_log
add column if not exists payment_method text;

alter table public.appointment_payment_log
add column if not exists discount_amount numeric(10, 2) not null default 0;

alter table public.appointment_payment_log
add column if not exists refund_amount numeric(10, 2) not null default 0;

alter table public.appointment_payment_log
add column if not exists payment_note text;

alter table public.appointment_payment_log
add column if not exists created_at timestamptz not null default now();


-- ============================================================
-- 3. Helpful indexes
-- ============================================================

create index if not exists idx_appointment_doctor_datetime_step11
on public.appointment(doctor_id, appointment_datetime);

create index if not exists idx_appointment_doctor_status_step11
on public.appointment(doctor_id, status);

create index if not exists idx_appointment_doctor_fee_status_step11
on public.appointment(doctor_id, fee_status);

create index if not exists idx_appointment_doctor_hospital_step11
on public.appointment(doctor_hospital_id);

create index if not exists idx_appointment_pa_step11
on public.appointment(pa_id);

create index if not exists idx_appointment_source_step11
on public.appointment(source);

create index if not exists idx_appointment_payment_log_appointment
on public.appointment_payment_log(appointment_id);

create index if not exists idx_appointment_payment_log_doctor
on public.appointment_payment_log(doctor_id);

create index if not exists idx_appointment_payment_log_created
on public.appointment_payment_log(created_at);