-- Enrich newly generated immutable Owner Summaries from posted reconciliations.
create or replace function private.plan7_cash_variance_before_summary_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare v_variance bigint;
begin
  select coalesce(sum(c.variance_minor),0) into v_variance
  from public.cashier_reconciliations c
  where c.business_id=new.business_id and c.shop_id=new.shop_id
    and c.business_day_id=new.business_day_id;
  new.summary:=new.summary||jsonb_build_object('cashVarianceMinor',v_variance);
  new.source_fingerprint:=encode(extensions.digest(convert_to(new.summary::text,'UTF8'),'sha256'),'hex');
  return new;
end;$$;
create trigger plan7_owner_summary_cash_variance
before insert on public.daily_owner_summaries for each row
execute function private.plan7_cash_variance_before_summary_v1();
revoke all on function private.plan7_cash_variance_before_summary_v1() from public,anon,authenticated;
