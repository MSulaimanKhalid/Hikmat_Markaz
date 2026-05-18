-- ============================================================
-- Fix online appointment request overlap logic during PA confirm
-- ============================================================
-- Problem:
-- prevent_appointment_request_overlap() checks appointment_request
-- against appointment, but during PA confirmation the backend creates
-- an appointment from the request and then marks the request confirmed.
-- The trigger then sees the newly created appointment as a conflict.
--
-- Fix:
-- 1. Use requested_start/requested_datetime compatibility safely.
-- 2. Use duration_minutes/requested_duration_minutes compatibility safely.
-- 3. Do not treat confirmed_appointment_id as a conflicting appointment.
-- 4. Do not re-check appointment overlap on a status-only confirmation update.
--    The real appointment insert is already protected by
--    prevent_appointment_overlap().
-- ============================================================

create or replace function public.prevent_appointment_request_overlap()
returns trigger
language plpgsql
as $$
declare
    new_start timestamptz;
    new_end timestamptz;
    old_start timestamptz;
    old_end timestamptz;
    new_duration integer;
    old_duration integer;
    schedule_changed boolean := false;
begin
    if coalesce(new.status, 'pending') not in ('pending', 'confirmed') then
        return new;
    end if;

    new_duration := coalesce(new.duration_minutes, new.requested_duration_minutes, 15);

    new_start := coalesce(new.requested_datetime, new.requested_start);

    if new_start is null then
        raise exception 'Requested start time is required.';
    end if;

    new_end := coalesce(
        new.requested_end,
        new_start + ((new_duration || ' minutes')::interval)
    );

    if new_end <= new_start then
        raise exception 'Requested end time must be after requested start time.';
    end if;

    if tg_op = 'UPDATE' then
        old_duration := coalesce(old.duration_minutes, old.requested_duration_minutes, 15);
        old_start := coalesce(old.requested_datetime, old.requested_start);
        old_end := coalesce(
            old.requested_end,
            old_start + ((old_duration || ' minutes')::interval)
        );

        schedule_changed :=
            old.doctor_hospital_id is distinct from new.doctor_hospital_id
            or old_start is distinct from new_start
            or old_end is distinct from new_end
            or old_duration is distinct from new_duration;

        /*
          If PA is only changing request status to confirmed,
          do not check request-vs-appointment overlap here.

          Reason:
          The confirmation flow can create the appointment first.
          That appointment naturally overlaps its source request.
          The actual appointment insert is already protected by
          public.prevent_appointment_overlap().
        */
        if schedule_changed is false
           and old.status is distinct from new.status
           and new.status = 'confirmed' then
            return new;
        end if;
    end if;

    if new.doctor_hospital_id is null then
        return new;
    end if;

    perform pg_advisory_xact_lock(new.doctor_hospital_id);

    if exists (
        select 1
        from public.appointment a
        where a.doctor_hospital_id = new.doctor_hospital_id
          and coalesce(a.status, '') not in ('cancelled', 'no_show')
          and (
                new.confirmed_appointment_id is null
                or a.appointment_id <> new.confirmed_appointment_id
          )
          and tstzrange(
                coalesce(a.appointment_datetime, a.scheduled_start),
                coalesce(
                    a.scheduled_end,
                    coalesce(a.appointment_datetime, a.scheduled_start)
                        + ((coalesce(a.duration_minutes, 15) || ' minutes')::interval)
                ),
                '[)'
              )
              &&
              tstzrange(new_start, new_end, '[)')
    ) then
        raise exception 'Requested slot overlaps with an existing appointment.';
    end if;

    if exists (
        select 1
        from public.appointment_request ar
        where ar.doctor_hospital_id = new.doctor_hospital_id
          and ar.request_id <> coalesce(new.request_id, -1)
          and coalesce(ar.status, '') in ('pending', 'confirmed')
          and tstzrange(
                coalesce(ar.requested_datetime, ar.requested_start),
                coalesce(
                    ar.requested_end,
                    coalesce(ar.requested_datetime, ar.requested_start)
                        + ((coalesce(ar.duration_minutes, ar.requested_duration_minutes, 15) || ' minutes')::interval)
                ),
                '[)'
              )
              &&
              tstzrange(new_start, new_end, '[)')
    ) then
        raise exception 'Requested slot overlaps with another pending or confirmed request.';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_prevent_appointment_request_overlap
on public.appointment_request;

create trigger trg_prevent_appointment_request_overlap
before insert or update
on public.appointment_request
for each row
execute function public.prevent_appointment_request_overlap();