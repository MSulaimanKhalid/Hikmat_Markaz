-- ============================================================
-- Hikmat Markaz - Step 9 Prescription Generation Flow
-- Adds prescription print log and helpful indexes.
-- Prescription itself is generated from visit + diagnosis data.
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- 1. Prescription print log
-- This records when a prescription was printed/generated.
-- We do not duplicate prescription content here.
-- Official clinical data remains in visit + diagnosis.
-- ============================================================

create table if not exists public.prescription_print_log (
    log_id bigint generated always as identity primary key,
    visit_id bigint,
    appointment_id bigint,
    patient_id bigint,
    printed_by_user_id bigint,
    printed_by_role text,
    printed_at timestamptz not null default now()
);

alter table public.prescription_print_log
add column if not exists visit_id bigint;

alter table public.prescription_print_log
add column if not exists appointment_id bigint;

alter table public.prescription_print_log
add column if not exists patient_id bigint;

alter table public.prescription_print_log
add column if not exists printed_by_user_id bigint;

alter table public.prescription_print_log
add column if not exists printed_by_role text;

alter table public.prescription_print_log
add column if not exists printed_at timestamptz not null default now();


-- ============================================================
-- 2. Helpful indexes
-- ============================================================

create index if not exists idx_prescription_print_log_visit
on public.prescription_print_log(visit_id);

create index if not exists idx_prescription_print_log_patient
on public.prescription_print_log(patient_id);

create index if not exists idx_prescription_print_log_printed_at
on public.prescription_print_log(printed_at);

create index if not exists idx_visit_completed_at
on public.visit(completed_at);

create index if not exists idx_patient_cnic_prescription
on public.patient(cnic);

create index if not exists idx_diagnosis_visit_prescription
on public.diagnosis(visit_id);

create index if not exists idx_appointment_patient_prescription
on public.appointment(patient_id);

create index if not exists idx_appointment_status_prescription
on public.appointment(status);