-- Serialize every materialized row by its stable conflict identity rather than by
-- the full incoming payload. Different events that update the same row must contend
-- on the same transaction lock before monotonic guards are evaluated.

create or replace function private.apply_tux_remote_mutation(p_mutation jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_table text := p_mutation ->> 'table';
  v_mode text := p_mutation ->> 'mode';
  v_row jsonb := p_mutation -> 'row';
  v_guard jsonb := p_mutation -> 'guard';
  v_conflicts text[];
  v_columns text[];
  v_column text;
  v_column_list text := '';
  v_select_list text := '';
  v_update_list text := '';
  v_conflict_list text := '';
  v_match text := '';
  v_lock_identity text;
  v_existing jsonb;
  v_sql text;
  v_first boolean := true;
  v_existing_found boolean := false;
begin
  if not private.tux_plan_table_allowed(v_table) then
    raise exception 'TUX_SYNC_TABLE_NOT_ALLOWED:%', coalesce(v_table, '<null>');
  end if;
  if v_mode not in ('UPSERT', 'UPDATE') then
    raise exception 'TUX_SYNC_MODE_INVALID';
  end if;
  if jsonb_typeof(v_row) <> 'object' then
    raise exception 'TUX_SYNC_ROW_INVALID';
  end if;

  select array_agg(value order by ordinality)
    into v_conflicts
  from jsonb_array_elements_text(p_mutation -> 'conflictColumns') with ordinality;
  if coalesce(array_length(v_conflicts, 1), 0) = 0 then
    raise exception 'TUX_SYNC_CONFLICT_COLUMNS_REQUIRED';
  end if;

  select array_agg(key order by key)
    into v_columns
  from jsonb_object_keys(v_row) as key;

  foreach v_column in array v_columns loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = v_table
        and attribute.attname = v_column
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) then
      raise exception 'TUX_SYNC_COLUMN_NOT_ALLOWED:%.%', v_table, v_column;
    end if;

    if not v_first then
      v_column_list := v_column_list || ', ';
      v_select_list := v_select_list || ', ';
    end if;
    v_column_list := v_column_list || format('%I', v_column);
    v_select_list := v_select_list || format('r.%I', v_column);
    v_first := false;

    if not (v_column = any(v_conflicts)) then
      if v_update_list <> '' then v_update_list := v_update_list || ', '; end if;
      v_update_list := v_update_list || format('%I = excluded.%I', v_column, v_column);
    end if;
  end loop;

  v_lock_identity := v_table;
  foreach v_column in array v_conflicts loop
    if not (v_row ? v_column) then
      raise exception 'TUX_SYNC_CONFLICT_VALUE_MISSING:%', v_column;
    end if;
    if v_conflict_list <> '' then
      v_conflict_list := v_conflict_list || ', ';
      v_match := v_match || ' and ';
    end if;
    v_conflict_list := v_conflict_list || format('%I', v_column);
    v_match := v_match || format('t.%I is not distinct from r.%I', v_column, v_column);
    v_lock_identity := v_lock_identity || ':' || v_column || '=' || coalesce(v_row ->> v_column, '<null>');
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(v_lock_identity, 0));

  v_sql := format(
    'select to_jsonb(t) from public.%I t, jsonb_populate_record(null::public.%I, $1) r where %s limit 1',
    v_table,
    v_table,
    v_match
  );
  execute v_sql into v_existing using v_row;
  v_existing_found := v_existing is not null;

  if v_existing_found and not private.tux_guard_allows(v_existing, v_guard) then
    return;
  end if;

  if v_mode = 'UPDATE' then
    if not v_existing_found then
      raise exception 'TUX_DEPENDENCY_MISSING:%.%', v_table, coalesce(v_conflicts::text, '');
    end if;
    v_update_list := '';
    foreach v_column in array v_columns loop
      if not (v_column = any(v_conflicts)) then
        if v_update_list <> '' then v_update_list := v_update_list || ', '; end if;
        v_update_list := v_update_list || format('%I = r.%I', v_column, v_column);
      end if;
    end loop;
    if v_update_list = '' then return; end if;
    v_sql := format(
      'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where %s',
      v_table,
      v_update_list,
      v_table,
      v_match
    );
    execute v_sql using v_row;
    return;
  end if;

  if not v_existing_found then
    v_sql := format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) r',
      v_table,
      v_column_list,
      v_select_list,
      v_table
    );
    execute v_sql using v_row;
    return;
  end if;

  if v_update_list = '' then return; end if;
  v_update_list := '';
  foreach v_column in array v_columns loop
    if not (v_column = any(v_conflicts)) then
      if v_update_list <> '' then v_update_list := v_update_list || ', '; end if;
      v_update_list := v_update_list || format('%I = r.%I', v_column, v_column);
    end if;
  end loop;
  v_sql := format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where %s',
    v_table,
    v_update_list,
    v_table,
    v_match
  );
  execute v_sql using v_row;
end;
$$;

revoke all on function private.apply_tux_remote_mutation(jsonb) from public, anon, authenticated;
