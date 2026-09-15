-- Preserve accepted second/fractional-second precision when enforcing published ONLINE service hours.

create or replace function private.catalog_public_local_second_v1(p_value text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog, private
as $$
declare
  v_match text[];
  v_hour integer;
  v_minute integer;
  v_second numeric;
begin
  if p_value is null then
    return null;
  end if;

  v_match := regexp_match(
    p_value,
    '^([0-9]{2}):([0-9]{2})(:([0-9]{2}(\.[0-9]+)?))?$'
  );
  if v_match is null then
    return null;
  end if;

  v_hour := v_match[1]::integer;
  v_minute := v_match[2]::integer;
  v_second := coalesce(v_match[4], '0')::numeric;
  if v_hour > 23 or v_minute > 59 or v_second < 0 or v_second >= 60 then
    return null;
  end if;

  return v_hour * 3600 + v_minute * 60 + v_second;
end;
$$;

create or replace function private.catalog_public_online_ordering_open_v1(
  p_settings jsonb,
  p_now timestamptz
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, private
as $$
declare
  v_weekly jsonb;
  v_special jsonb;
  v_local timestamp without time zone;
  v_service_date date;
  v_day_of_week integer;
  v_second_of_day numeric;
  v_previous_day integer;
  v_current_special jsonb;
  v_previous_special jsonb;
  v_hours jsonb;
  v_opens numeric;
  v_closes numeric;
  v_has_online_weekly boolean;
  v_has_online_special boolean;
begin
  if jsonb_typeof(p_settings) <> 'object' or p_now is null then
    return false;
  end if;

  v_weekly := coalesce(p_settings -> 'weeklyHours', '[]'::jsonb);
  v_special := coalesce(p_settings -> 'specialHours', '[]'::jsonb);
  if jsonb_typeof(v_weekly) <> 'array' or jsonb_typeof(v_special) <> 'array' then
    return false;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_weekly) hours
    where jsonb_typeof(hours) = 'object'
      and hours ->> 'serviceKind' = 'ONLINE'
      and hours ->> 'active' = 'true'
  ) into v_has_online_weekly;

  select exists (
    select 1
    from jsonb_array_elements(v_special) hours
    where jsonb_typeof(hours) = 'object'
      and hours ->> 'serviceKind' = 'ONLINE'
  ) into v_has_online_special;

  if not v_has_online_weekly and not v_has_online_special then
    return true;
  end if;

  v_local := p_now at time zone 'Africa/Cairo';
  v_service_date := v_local::date;
  v_day_of_week := extract(dow from v_local)::integer;
  v_second_of_day := extract(hour from v_local)::numeric * 3600
    + extract(minute from v_local)::numeric * 60
    + extract(second from v_local);

  select candidate.hours
    into v_current_special
  from jsonb_array_elements(v_special) with ordinality candidate(hours, ordinality)
  where jsonb_typeof(candidate.hours) = 'object'
    and candidate.hours ->> 'serviceKind' = 'ONLINE'
    and candidate.hours ->> 'serviceDate' = to_char(v_service_date, 'YYYY-MM-DD')
  order by candidate.ordinality
  limit 1;

  if found then
    if jsonb_typeof(v_current_special -> 'closed') <> 'boolean'
       or (v_current_special ->> 'closed')::boolean
       or jsonb_typeof(v_current_special -> 'opensLocal') <> 'string'
       or jsonb_typeof(v_current_special -> 'closesLocal') <> 'string' then
      return false;
    end if;

    v_opens := private.catalog_public_local_second_v1(v_current_special ->> 'opensLocal');
    v_closes := private.catalog_public_local_second_v1(v_current_special ->> 'closesLocal');
    if v_opens is null or v_closes is null then
      return false;
    end if;

    if v_opens < v_closes then
      return v_second_of_day >= v_opens and v_second_of_day < v_closes;
    end if;
    return v_second_of_day >= v_opens;
  end if;

  select candidate.hours
    into v_previous_special
  from jsonb_array_elements(v_special) with ordinality candidate(hours, ordinality)
  where jsonb_typeof(candidate.hours) = 'object'
    and candidate.hours ->> 'serviceKind' = 'ONLINE'
    and candidate.hours ->> 'serviceDate' = to_char(v_service_date - 1, 'YYYY-MM-DD')
  order by candidate.ordinality
  limit 1;

  if found then
    if jsonb_typeof(v_previous_special -> 'closed') = 'boolean'
       and (v_previous_special ->> 'closed')::boolean is false
       and jsonb_typeof(v_previous_special -> 'opensLocal') = 'string'
       and jsonb_typeof(v_previous_special -> 'closesLocal') = 'string' then
      v_opens := private.catalog_public_local_second_v1(v_previous_special ->> 'opensLocal');
      v_closes := private.catalog_public_local_second_v1(v_previous_special ->> 'closesLocal');
      if v_opens is null or v_closes is null then
        return false;
      end if;
      if v_closes < v_opens and v_second_of_day < v_closes then
        return true;
      end if;
    end if;
  else
    v_previous_day := (v_day_of_week + 6) % 7;
    for v_hours in
      select candidate.hours
      from jsonb_array_elements(v_weekly) with ordinality candidate(hours, ordinality)
      where jsonb_typeof(candidate.hours) = 'object'
        and candidate.hours ->> 'serviceKind' = 'ONLINE'
        and candidate.hours ->> 'active' = 'true'
        and candidate.hours ->> 'dayOfWeek' ~ '^[0-6]$'
        and (candidate.hours ->> 'dayOfWeek')::integer = v_previous_day
      order by candidate.ordinality
    loop
      if jsonb_typeof(v_hours -> 'opensLocal') <> 'string'
         or jsonb_typeof(v_hours -> 'closesLocal') <> 'string' then
        return false;
      end if;
      v_opens := private.catalog_public_local_second_v1(v_hours ->> 'opensLocal');
      v_closes := private.catalog_public_local_second_v1(v_hours ->> 'closesLocal');
      if v_opens is null or v_closes is null then
        return false;
      end if;
      if v_closes < v_opens and v_second_of_day < v_closes then
        return true;
      end if;
    end loop;
  end if;

  for v_hours in
    select candidate.hours
    from jsonb_array_elements(v_weekly) with ordinality candidate(hours, ordinality)
    where jsonb_typeof(candidate.hours) = 'object'
      and candidate.hours ->> 'serviceKind' = 'ONLINE'
      and candidate.hours ->> 'active' = 'true'
      and candidate.hours ->> 'dayOfWeek' ~ '^[0-6]$'
      and (candidate.hours ->> 'dayOfWeek')::integer = v_day_of_week
    order by candidate.ordinality
  loop
    if jsonb_typeof(v_hours -> 'opensLocal') <> 'string'
       or jsonb_typeof(v_hours -> 'closesLocal') <> 'string' then
      return false;
    end if;
    v_opens := private.catalog_public_local_second_v1(v_hours ->> 'opensLocal');
    v_closes := private.catalog_public_local_second_v1(v_hours ->> 'closesLocal');
    if v_opens is null or v_closes is null then
      return false;
    end if;
    if v_opens < v_closes then
      if v_second_of_day >= v_opens and v_second_of_day < v_closes then
        return true;
      end if;
    elsif v_second_of_day >= v_opens then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function private.catalog_public_local_second_v1(text) from public;
revoke all on function private.catalog_public_online_ordering_open_v1(jsonb, timestamptz) from public;
