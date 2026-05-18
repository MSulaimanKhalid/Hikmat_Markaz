-- ============================================================
-- Hikmat Markaz - Fix Appointment Scheduled Columns
-- Problem:
-- Old appointment table has scheduled_start as NOT NULL.
-- New booking code uses appointment_datetime as official source.
--
-- Solution:
-- Keep scheduled_start/scheduled_end as legacy compatibility fields
-- and automatically fill them from appointment_datetime.
-- ============================================================

alter table public.appointment
add column if not exists appointment_datetime timestamptz;

alter table public.appointment
add column if not exists scheduled_start timestamptz;

alter table public.appointment
add column if not exists scheduled_end timestamptz;

update public.appointment
set scheduled_start = appointment_datetime
where scheduled_start is null
  and appointment_datetime is not null;

update public.appointment
set scheduled_end = scheduled_start + ((coalesce(duration_minutes, 15) || ' minutes')::interval)
where scheduled_end is null
  and scheduled_start is not null;

create or replace function public.sync_appointment_scheduled_columns()
returns trigger
language plpgsql
as $$
begin
    if new.scheduled_start is null and new.appointment_datetime is not null then
        new.scheduled_start := new.appointment_datetime;
    end if;

    if new.scheduled_end is null and new.scheduled_start is not null then
        new.scheduled_end := new.scheduled_start + ((coalesce(new.duration_minutes, 15) || ' minutes')::interval);
    end if;

    return new;
end;
$$;

drop trigger if exists trg_sync_appointment_scheduled_columns on public.appointment;

create trigger trg_sync_appointment_scheduled_columns
before insert or update on public.appointment
for each row
execute function public.sync_appointment_scheduled_columns();

alter table public.appointment
alter column scheduled_start drop not null;

alter table public.appointment
alter column scheduled_end drop not null;