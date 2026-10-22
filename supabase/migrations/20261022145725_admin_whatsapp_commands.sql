-- Transactional Admin WhatsApp configuration commands with CAS, audit and replay safety.

create table public.whatsapp_admin_command_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null,
  command_id text not null check (char_length(btrim(command_id)) between 1 and 160),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  unique (business_id, command_id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

alter table public.whatsapp_admin_command_receipts enable row level security;
revoke all on table public.whatsapp_admin_command_receipts from public, anon, authenticated;

create or replace function public.manage_admin_whatsapp_v1(
  p_business_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_command_id text,
  p_expected_version bigint,
  p_command_type text,
  p_payload jsonb
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_authorized boolean;
  v_authorized_business uuid;
  v_hash text;
  v_receipt public.whatsapp_admin_command_receipts%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_id uuid;
  v_template public.whatsapp_starter_templates%rowtype;
begin
  select authorized, business_id into v_authorized, v_authorized_business
  from public.resolve_admin_authorization_v1(p_employee_id, p_shop_id, 'whatsapp.manage');
  if not coalesce(v_authorized, false) or v_authorized_business is distinct from p_business_id then
    return jsonb_build_object('ok', false, 'code', 'permission_forbidden');
  end if;
  if p_expected_version < 0 or nullif(btrim(p_command_id), '') is null
     or jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_command');
  end if;

  v_hash := encode(extensions.digest(convert_to(concat_ws('|', p_business_id, p_shop_id, p_command_type, p_expected_version, p_payload::text), 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-whatsapp:' || p_business_id::text || ':' || p_command_id, 0));
  select * into v_receipt from public.whatsapp_admin_command_receipts
  where business_id = p_business_id and command_id = btrim(p_command_id);
  if v_receipt.id is not null then
    if v_receipt.request_hash <> v_hash then return jsonb_build_object('ok', false, 'code', 'command_id_conflict'); end if;
    return v_receipt.result || jsonb_build_object('replayed', true);
  end if;

  if p_command_type = 'preferences.update' then
    select to_jsonb(pref) into v_before from public.whatsapp_admin_preferences pref
    where business_id=p_business_id and shop_id=p_shop_id for update;
    if coalesce((v_before->>'version')::bigint, 0) <> p_expected_version then v_result:=jsonb_build_object('ok',false,'code','stale_version');
    elsif coalesce((p_payload->>'automationEnabled')::boolean, false) and not exists (
      select 1 from public.whatsapp_event_message_rules rule
      join public.whatsapp_starter_templates template on template.shop_id=rule.shop_id and template.provider_template_name=rule.provider_template_id and template.language_code=rule.language_code
      where rule.business_id=p_business_id and rule.shop_id=p_shop_id and rule.enabled and rule.event_type='ORDER_ACCEPTED' and template.active and template.provider_status='APPROVED'
    ) then v_result:=jsonb_build_object('ok',false,'code','approved_rule_required');
    else
      update public.whatsapp_admin_preferences set automation_enabled=(p_payload->>'automationEnabled')::boolean, updated_by_employee_id=p_employee_id, version=version+1, updated_at=now()
      where business_id=p_business_id and shop_id=p_shop_id returning to_jsonb(whatsapp_admin_preferences.*) into v_after;
      v_result:=jsonb_build_object('ok',true,'code','updated','version',(v_after->>'version')::bigint);
    end if;
  elsif p_command_type = 'channel.assign' then
    select to_jsonb(pref) into v_before from public.whatsapp_admin_preferences pref where business_id=p_business_id and shop_id=p_shop_id for update;
    if coalesce((v_before->>'version')::bigint,0) <> p_expected_version then v_result:=jsonb_build_object('ok',false,'code','stale_version');
    elsif not exists(select 1 from public.whatsapp_channels channel where channel.id=(p_payload->>'channelId')::uuid and channel.shop_id=p_shop_id and channel.active) then v_result:=jsonb_build_object('ok',false,'code','channel_not_available');
    else
      update public.whatsapp_admin_preferences set channel_configured=true, updated_by_employee_id=p_employee_id, version=version+1, updated_at=now() where business_id=p_business_id and shop_id=p_shop_id returning to_jsonb(whatsapp_admin_preferences.*) into v_after;
      v_result:=jsonb_build_object('ok',true,'code','updated','version',(v_after->>'version')::bigint);
    end if;
  elsif p_command_type = 'quick-reply.upsert' then
    if p_payload->>'id' is null then
      if p_expected_version <> 0 then v_result:=jsonb_build_object('ok',false,'code','stale_version');
      else
        insert into public.whatsapp_admin_quick_replies(business_id,shop_id,title,body,sort_position,updated_by_employee_id)
        values(p_business_id,p_shop_id,btrim(p_payload->>'title'),btrim(p_payload->>'body'),(p_payload->>'sortPosition')::integer,p_employee_id)
        returning id,to_jsonb(whatsapp_admin_quick_replies.*) into v_id,v_after;
        v_result:=jsonb_build_object('ok',true,'code','created','version',1,'id',v_id);
      end if;
    else
      v_id:=(p_payload->>'id')::uuid;
      select to_jsonb(reply) into v_before from public.whatsapp_admin_quick_replies reply where business_id=p_business_id and id=v_id and (shop_id is null or shop_id=p_shop_id) for update;
      if v_before is null then v_result:=jsonb_build_object('ok',false,'code','quick_reply_not_found');
      elsif (v_before->>'version')::bigint <> p_expected_version then v_result:=jsonb_build_object('ok',false,'code','stale_version');
      else
        update public.whatsapp_admin_quick_replies set title=btrim(p_payload->>'title'),body=btrim(p_payload->>'body'),sort_position=(p_payload->>'sortPosition')::integer,enabled=true,updated_by_employee_id=p_employee_id,version=version+1,updated_at=now() where business_id=p_business_id and id=v_id returning to_jsonb(whatsapp_admin_quick_replies.*) into v_after;
        v_result:=jsonb_build_object('ok',true,'code','updated','version',(v_after->>'version')::bigint,'id',v_id);
      end if;
    end if;
  elsif p_command_type = 'quick-reply.disable' then
    v_id:=(p_payload->>'id')::uuid;
    select to_jsonb(reply) into v_before from public.whatsapp_admin_quick_replies reply where business_id=p_business_id and id=v_id and (shop_id is null or shop_id=p_shop_id) for update;
    if v_before is null then v_result:=jsonb_build_object('ok',false,'code','quick_reply_not_found');
    elsif (v_before->>'version')::bigint <> p_expected_version then v_result:=jsonb_build_object('ok',false,'code','stale_version');
    else
      update public.whatsapp_admin_quick_replies set enabled=false,updated_by_employee_id=p_employee_id,version=version+1,updated_at=now() where business_id=p_business_id and id=v_id returning to_jsonb(whatsapp_admin_quick_replies.*) into v_after;
      v_result:=jsonb_build_object('ok',true,'code','disabled','version',(v_after->>'version')::bigint,'id',v_id);
    end if;
  elsif p_command_type = 'event-rule.set' then
    v_id:=(p_payload->>'id')::uuid;
    select to_jsonb(rule) into v_before from public.whatsapp_event_message_rules rule where business_id=p_business_id and shop_id=p_shop_id and id=v_id for update;
    if v_before is null then v_result:=jsonb_build_object('ok',false,'code','event_rule_not_found');
    elsif (v_before->>'version')::bigint <> p_expected_version then v_result:=jsonb_build_object('ok',false,'code','stale_version');
    else
      select * into v_template from public.whatsapp_starter_templates template where template.id=(p_payload->>'templateId')::uuid and template.shop_id=p_shop_id and template.language_code=btrim(p_payload->>'languageCode');
      if v_template.id is null then v_result:=jsonb_build_object('ok',false,'code','template_not_found');
      elsif coalesce((p_payload->>'enabled')::boolean,false) and (not v_template.active or v_template.provider_status<>'APPROVED') then v_result:=jsonb_build_object('ok',false,'code','template_not_approved');
      elsif coalesce((p_payload->>'enabled')::boolean,false) and v_before->>'event_type'<>'ORDER_ACCEPTED' then v_result:=jsonb_build_object('ok',false,'code','event_source_unsupported');
      else
        update public.whatsapp_event_message_rules set provider_template_id=v_template.provider_template_name,language_code=v_template.language_code,enabled=(p_payload->>'enabled')::boolean,unsupported_reason=case when v_before->>'event_type'='ORDER_ACCEPTED' then null else 'No canonical delivery event source is available.' end,updated_by_employee_id=p_employee_id,version=version+1,updated_at=now() where business_id=p_business_id and shop_id=p_shop_id and id=v_id returning to_jsonb(whatsapp_event_message_rules.*) into v_after;
        v_result:=jsonb_build_object('ok',true,'code','updated','version',(v_after->>'version')::bigint,'id',v_id);
      end if;
    end if;
  else v_result:=jsonb_build_object('ok',false,'code','unsupported_command');
  end if;

  if coalesce((v_result->>'ok')::boolean,false) then
    perform public.append_admin_audit_event_v1(p_business_id,p_shop_id,p_employee_id,'WHATSAPP_'||upper(replace(p_command_type,'.','_')),'WHATSAPP_CONFIGURATION',coalesce(v_id::text,p_shop_id::text),v_before,v_after,null,null,null,jsonb_build_object('commandId',btrim(p_command_id)));
  end if;
  insert into public.whatsapp_admin_command_receipts(business_id,shop_id,command_id,request_hash,result) values(p_business_id,p_shop_id,btrim(p_command_id),v_hash,v_result);
  return v_result;
exception when invalid_text_representation or not_null_violation or check_violation then
  return jsonb_build_object('ok',false,'code','invalid_command');
end;
$$;

revoke all on function public.manage_admin_whatsapp_v1(uuid,uuid,uuid,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_admin_whatsapp_v1(uuid,uuid,uuid,text,bigint,text,jsonb) to service_role;

-- Configuration changes are only allowed through the authorization, CAS,
-- idempotency and audit boundary above. The BFF may read these rows directly,
-- but cannot bypass the command function with table writes.
revoke insert, update, delete on public.whatsapp_admin_preferences from service_role;
revoke insert, update, delete on public.whatsapp_admin_quick_replies from service_role;
revoke insert, update, delete on public.whatsapp_event_message_rules from service_role;
grant select on public.whatsapp_admin_preferences to service_role;
grant select on public.whatsapp_admin_quick_replies to service_role;
grant select on public.whatsapp_event_message_rules to service_role;
