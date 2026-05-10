-- ============================================================
-- Hikmat Markaz - Fix Appointment Request Requested Columns
-- Problem:
-- Old appointment_request table has requested_start as NOT NULL.
-- New patient portal uses requested_datetime as official source.
--
-- Solution:
-- Keep requested_start/requested_end as legacy compatibility fields
-- and automatically fill them from requested_datetime.
-- ============================================================

alter table public.appointment_request
add column if not exists requested_datetime timestamptz;

alter table public.appointment_request
add column if not exists requested_start timestamptz;

alter table public.appointment_request
add column if not exists requested_end timestamptz;

alter table public.appointment_request
add column if not exists duration_minutes integer not null default 15;

update public.appointment_request
set requested_start = requested_datetime
where requested_start is null
  and requested_datetime is not null;

update public.appointment_request
set requested_datetime = requested_start
where requested_datetime is null
  and requested_start is not null;

update public.appointment_request
set requested_end = requested_start + ((coalesce(duration_minutes, 15) || ' minutes')::interval)
where requested_end is null
  and requested_start is not null;

create or replace function public.sync_appointment_request_requested_columns()
returns trigger
language plpgsql
as $$
begin
    if new.requested_start is null and new.requested_datetime is not null then
        new.requested_start := new.requested_datetime;
    end if;

    if new.requested_datetime is null and new.requested_start is not null then
        new.requested_datetime := new.requested_start;
    end if;

    if new.requested_end is null and new.requested_start is not null then
        new.requested_end := new.requested_start + ((coalesce(new.duration_minutes, 15) || ' minutes')::interval);
    end if;

    return new;
end;
$$;

drop trigger if exists trg_sync_appointment_request_requested_columns
on public.appointment_request;

create trigger trg_sync_appointment_request_requested_columns
before insert or update on public.appointment_request
for each row
execute function public.sync_appointment_request_requested_columns();

alter table public.appointment_request
alter column requested_start drop not null;

alter table public.appointment_request
alter column requested_end drop not null;