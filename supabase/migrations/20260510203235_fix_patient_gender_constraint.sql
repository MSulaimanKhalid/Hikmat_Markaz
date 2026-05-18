-- ============================================================
-- Hikmat Markaz - Fix Patient Gender Constraint
-- Problem:
-- Frontend sends lowercase gender values: male, female, other.
-- Existing database check constraint rejects them.
-- ============================================================

alter table public.patient
drop constraint if exists chk_patient_gender;

alter table public.patient
add constraint chk_patient_gender
check (
    gender is null
    or gender in ('male', 'female', 'other')
);