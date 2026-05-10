-- ============================================================
-- Hikmat Markaz Database Schema
-- PostgreSQL / Supabase
-- ============================================================

-- =========================
-- 1. DOCTOR
-- =========================
create table public.doctor (
    doctor_id bigint generated always as identity primary key,
    name varchar(100) not null,
    specialization varchar(100) not null,
    license_number varchar(50) not null unique,
    email varchar(150) not null unique,
    phone varchar(20),
    password_hash varchar(255) not null,
    created_at timestamptz not null default now()
);

-- =========================
-- 2. DOCTOR_HOSPITAL
-- =========================
create table public.doctor_hospital (
    id bigint generated always as identity primary key,
    doctor_id bigint not null,
    name varchar(150) not null,
    address varchar(255),
    city varchar(100),
    consultation_days varchar(50),
    slot_start time,
    slot_end time,
    consultation_fee int not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),

    constraint fk_doctor_hospital_doctor
        foreign key (doctor_id)
        references public.doctor(doctor_id)
        on delete restrict,

    constraint chk_consultation_fee_non_negative
        check (consultation_fee >= 0),

    constraint chk_slot_time_valid
        check (
            slot_start is null
            or slot_end is null
            or slot_start < slot_end
        ),

    -- Needed for composite foreign keys later
    constraint uq_doctor_hospital_id_doctor
        unique (id, doctor_id)
);

-- Prevent duplicate hospital names for the same doctor in the same city
create unique index uq_doctor_hospital_same_doctor_name_city
on public.doctor_hospital (
    doctor_id,
    lower(name),
    lower(coalesce(city, ''))
);

-- =========================
-- 3. PA
-- =========================
create table public.pa (
    pa_id bigint generated always as identity primary key,
    name varchar(100) not null,
    email varchar(150) not null unique,
    phone varchar(20),
    password_hash varchar(255) not null,
    created_at timestamptz not null default now()
);

-- =========================
-- 4. PA_INVITE
-- =========================
create table public.pa_invite (
    invite_id bigint generated always as identity primary key,
    doctor_id bigint not null,
    doctor_hospital_id bigint not null,
    invited_email varchar(150) not null,
    invite_token varchar(255) not null unique,
    status varchar(20) not null default 'pending',
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),

    constraint chk_pa_invite_status
        check (status in ('pending', 'accepted', 'expired')),

    constraint fk_pa_invite_doctor
        foreign key (doctor_id)
        references public.doctor(doctor_id)
        on delete restrict,

    -- Improvement 1:
    -- Ensures invited hospital belongs to the same doctor
    constraint fk_pa_invite_doctor_hospital_same_doctor
        foreign key (doctor_hospital_id, doctor_id)
        references public.doctor_hospital(id, doctor_id)
        on delete restrict
);

-- =========================
-- 5. DOCTOR_PA
-- =========================
create table public.doctor_pa (
    id bigint generated always as identity primary key,
    doctor_id bigint not null,
    pa_id bigint not null,
    doctor_hospital_id bigint not null,
    status varchar(20) not null default 'active',
    created_at timestamptz not null default now(),

    constraint chk_doctor_pa_status
        check (status in ('active', 'inactive')),

    constraint fk_doctor_pa_doctor
        foreign key (doctor_id)
        references public.doctor(doctor_id)
        on delete restrict,

    constraint fk_doctor_pa_pa
        foreign key (pa_id)
        references public.pa(pa_id)
        on delete restrict,

    -- Improvement 1:
    -- Ensures this PA assignment is for a hospital owned by the same doctor
    constraint fk_doctor_pa_hospital_same_doctor
        foreign key (doctor_hospital_id, doctor_id)
        references public.doctor_hospital(id, doctor_id)
        on delete restrict,

    -- One PA should not be duplicated for the same doctor-hospital pair
    constraint uq_doctor_pa_assignment
        unique (doctor_id, pa_id, doctor_hospital_id)
);

-- =========================
-- 6. PATIENT
-- =========================
create table public.patient (
    patient_id bigint generated always as identity primary key,
    name varchar(100) not null,
    cnic varchar(15) not null unique,
    gender varchar(10),
    dob date,
    phone varchar(20),
    email varchar(150),
    created_at timestamptz not null default now(),

    constraint chk_patient_gender
        check (
            gender is null
            or gender in ('Male', 'Female', 'Other')
        )
);

-- =========================
-- 7. MEDICAL_HISTORY
-- =========================
create table public.medical_history (
    history_id bigint generated always as identity primary key,
    patient_id bigint not null unique,
    allergies text,
    chronic_conditions text,
    past_surgeries text,
    updated_at timestamptz not null default now(),

    constraint fk_medical_history_patient
        foreign key (patient_id)
        references public.patient(patient_id)
        on delete cascade
);

-- =========================
-- 8. APPOINTMENT
-- =========================
create table public.appointment (
    appointment_id bigint generated always as identity primary key,
    patient_id bigint not null,
    doctor_id bigint not null,
    doctor_hospital_id bigint not null,
    pa_id bigint not null,
    appointment_datetime timestamptz not null,
    status varchar(20) not null default 'booked',
    created_at timestamptz not null default now(),

    constraint chk_appointment_status
        check (status in ('booked', 'completed', 'cancelled', 'no-show')),

    constraint fk_appointment_patient
        foreign key (patient_id)
        references public.patient(patient_id)
        on delete restrict,

    constraint fk_appointment_doctor
        foreign key (doctor_id)
        references public.doctor(doctor_id)
        on delete restrict,

    constraint fk_appointment_pa
        foreign key (pa_id)
        references public.pa(pa_id)
        on delete restrict,

    -- Improvement 1:
    -- Ensures appointment hospital belongs to the same doctor
    constraint fk_appointment_hospital_same_doctor
        foreign key (doctor_hospital_id, doctor_id)
        references public.doctor_hospital(id, doctor_id)
        on delete restrict,

    -- Improvement 2:
    -- Ensures only an assigned PA can create/book appointment
    -- for that doctor-hospital combination
    constraint fk_appointment_valid_pa_assignment
        foreign key (doctor_id, pa_id, doctor_hospital_id)
        references public.doctor_pa(doctor_id, pa_id, doctor_hospital_id)
        on delete restrict
);

-- =========================
-- 9. VISIT
-- =========================
create table public.visit (
    visit_id bigint generated always as identity primary key,
    appointment_id bigint not null unique,
    bp varchar(10),
    weight int,
    temperature numeric(4,1),
    chief_complaint text,
    clinical_notes text,
    created_at timestamptz not null default now(),

    constraint fk_visit_appointment
        foreign key (appointment_id)
        references public.appointment(appointment_id)
        on delete restrict,

    constraint chk_visit_weight
        check (weight is null or weight > 0),

    constraint chk_visit_temperature
        check (temperature is null or temperature > 0)
);

-- =========================
-- 10. DIAGNOSIS
-- =========================
create table public.diagnosis (
    diagnosis_id bigint generated always as identity primary key,
    visit_id bigint not null,
    description text not null,
    icd_code varchar(20),

    constraint fk_diagnosis_visit
        foreign key (visit_id)
        references public.visit(visit_id)
        on delete cascade
);

-- =========================
-- 11. PRESCRIPTION
-- =========================
create table public.prescription (
    prescription_id bigint generated always as identity primary key,
    visit_id bigint not null unique,
    pdf_path varchar(255),
    qr_code_data varchar(255),
    created_at timestamptz not null default now(),

    constraint fk_prescription_visit
        foreign key (visit_id)
        references public.visit(visit_id)
        on delete restrict
);

-- =========================
-- 12. PRESCRIPTION_MEDICINE
-- =========================
create table public.prescription_medicine (
    id bigint generated always as identity primary key,
    prescription_id bigint not null,
    medicine_name varchar(150) not null,
    dosage varchar(50),
    frequency varchar(50),
    duration varchar(50),
    instructions text,

    constraint fk_prescription_medicine_prescription
        foreign key (prescription_id)
        references public.prescription(prescription_id)
        on delete cascade
);

-- =========================
-- 13. REVENUE_RECORD
-- =========================
create table public.revenue_record (
    revenue_id bigint generated always as identity primary key,
    appointment_id bigint not null unique,
    doctor_hospital_id bigint not null,
    doctor_id bigint not null,
    amount int not null,
    paid_at timestamptz not null default now(),

    constraint chk_revenue_amount
        check (amount >= 0),

    constraint fk_revenue_appointment
        foreign key (appointment_id)
        references public.appointment(appointment_id)
        on delete restrict,

    constraint fk_revenue_doctor
        foreign key (doctor_id)
        references public.doctor(doctor_id)
        on delete restrict,

    -- Improvement 1:
    -- Ensures revenue hospital belongs to the same doctor
    constraint fk_revenue_hospital_same_doctor
        foreign key (doctor_hospital_id, doctor_id)
        references public.doctor_hospital(id, doctor_id)
        on delete restrict
);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================

create index idx_doctor_hospital_doctor_id
on public.doctor_hospital(doctor_id);

create index idx_pa_invite_doctor_id
on public.pa_invite(doctor_id);

create index idx_pa_invite_doctor_hospital_id
on public.pa_invite(doctor_hospital_id);

create index idx_doctor_pa_doctor_id
on public.doctor_pa(doctor_id);

create index idx_doctor_pa_pa_id
on public.doctor_pa(pa_id);

create index idx_doctor_pa_hospital_id
on public.doctor_pa(doctor_hospital_id);

create index idx_patient_cnic
on public.patient(cnic);

create index idx_patient_phone
on public.patient(phone);

create index idx_appointment_patient_id
on public.appointment(patient_id);

create index idx_appointment_doctor_id
on public.appointment(doctor_id);

create index idx_appointment_pa_id
on public.appointment(pa_id);

create index idx_appointment_doctor_datetime
on public.appointment(doctor_id, appointment_datetime);

create index idx_appointment_hospital_datetime
on public.appointment(doctor_hospital_id, appointment_datetime);

create index idx_visit_appointment_id
on public.visit(appointment_id);

create index idx_diagnosis_visit_id
on public.diagnosis(visit_id);

create index idx_prescription_visit_id
on public.prescription(visit_id);

create index idx_prescription_medicine_prescription_id
on public.prescription_medicine(prescription_id);

create index idx_revenue_doctor_paid_at
on public.revenue_record(doctor_id, paid_at);

create index idx_revenue_hospital_paid_at
on public.revenue_record(doctor_hospital_id, paid_at);