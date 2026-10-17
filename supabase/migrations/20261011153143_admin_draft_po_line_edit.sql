CREATE TABLE IF NOT EXISTS public.admin_draft_po_line_commands(
 shop_id uuid NOT NULL REFERENCES public.shops(id),command_id text NOT NULL,
 request_digest text NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(shop_id,command_id));
ALTER TABLE public.admin_draft_po_line_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_draft_po_line_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.admin_draft_po_line_commands TO service_role;

CREATE OR REPLACE FUNCTION public.replace_draft_purchase_order_lines_v1(
 p_employee_id uuid,p_shop_id uuid,p_purchase_order_id uuid,
 p_expected_version bigint,p_lines jsonb,p_command_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private'
AS $$
DECLARE
 v_business uuid;v_po public.purchase_orders%rowtype;v_digest text;
 v_old public.admin_draft_po_line_commands%rowtype;
 v_line jsonb;v_item uuid;v_q bigint;v_cost numeric;v_unit text;v_base text;
 v_factor bigint;v_base_qty numeric;v_previous jsonb;v_result jsonb;
BEGIN
 v_business:=private.admin_purchasing_authority_v1(p_employee_id,p_shop_id,'purchasing.manage');
 IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 500
    OR nullif(btrim(coalesce(p_command_id,'')),'') IS NULL OR length(p_command_id)>160 THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_purchase_order_lines');
 END IF;
 v_digest:=md5(jsonb_build_object('po',p_purchase_order_id,'version',p_expected_version,'lines',p_lines)::text);
 PERFORM pg_advisory_xact_lock(hashtextextended('po-draft-lines:'||p_shop_id||':'||p_command_id,0));
 SELECT * INTO v_old FROM public.admin_draft_po_line_commands
  WHERE shop_id=p_shop_id AND command_id=p_command_id;
 IF FOUND THEN
  IF v_old.request_digest<>v_digest THEN
   RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');END IF;
  RETURN v_old.result||jsonb_build_object('idempotentReplay',true);
 END IF;
 SELECT * INTO v_po FROM public.purchase_orders
  WHERE id=p_purchase_order_id AND shop_id=p_shop_id FOR UPDATE;
 IF NOT FOUND OR v_po.business_id IS DISTINCT FROM v_business THEN
  RETURN jsonb_build_object('ok',false,'code','purchase_order_not_found');END IF;
 IF p_expected_version IS DISTINCT FROM v_po.version THEN
  RETURN jsonb_build_object('ok',false,'code','stale_version','currentVersion',v_po.version);END IF;
 IF v_po.status<>'DRAFT' THEN
  RETURN jsonb_build_object('ok',false,'code','purchase_order_not_draft');END IF;
 IF EXISTS(SELECT 1 FROM public.purchase_receipts WHERE purchase_order_id=v_po.id)
  OR EXISTS(SELECT 1 FROM public.purchase_order_lines
    WHERE purchase_order_id=v_po.id AND received_purchase_units_micros>0) THEN
  RETURN jsonb_build_object('ok',false,'code','purchase_order_receiving_history');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.suppliers
    WHERE id=v_po.supplier_id AND business_id=v_business AND active) THEN
  RETURN jsonb_build_object('ok',false,'code','supplier_not_found');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) t(value)
    GROUP BY t.value->>'inventoryItemId' HAVING count(*)>1) THEN
  RETURN jsonb_build_object('ok',false,'code','duplicate_inventory_item');END IF;

 -- Validate all items, purchase units, quantities and conversion math before rewrite.
 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(v_line)<>'object' OR
    v_line-'inventoryItemId'-'purchaseUnitLabel'-'orderedPurchaseUnitsMicros'-'expectedPurchaseUnitCostMinor'<>'{}'::jsonb THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_purchase_order_line');END IF;
  IF jsonb_typeof(v_line->'orderedPurchaseUnitsMicros') <> 'number'
      OR jsonb_typeof(v_line->'expectedPurchaseUnitCostMinor') <> 'number'
      OR (v_line->>'orderedPurchaseUnitsMicros')::numeric <>
         trunc((v_line->>'orderedPurchaseUnitsMicros')::numeric) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_purchase_order_line');
  END IF;
  v_item:=(v_line->>'inventoryItemId')::uuid;
  v_q:=(v_line->>'orderedPurchaseUnitsMicros')::bigint;
  v_cost:=(v_line->>'expectedPurchaseUnitCostMinor')::numeric;
  v_unit:=nullif(btrim(v_line->>'purchaseUnitLabel'),'');
  IF v_q<=0 OR v_cost<0 OR v_cost<>trunc(v_cost) OR v_unit IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_purchase_order_line');END IF;
  SELECT unit_label INTO v_base FROM public.inventory_items
   WHERE id=v_item AND shop_id=p_shop_id AND active FOR KEY SHARE;
  IF NOT FOUND THEN
   RETURN jsonb_build_object('ok',false,'code','inventory_item_not_found');END IF;
  v_factor:=NULL;
  IF lower(v_unit)=lower(btrim(v_base)) THEN v_factor:=1000000;
  ELSE SELECT base_micros_per_purchase_unit INTO v_factor
    FROM public.inventory_unit_conversions
    WHERE shop_id=p_shop_id AND inventory_item_id=v_item
      AND active AND lower(btrim(purchase_unit_label))=lower(v_unit) FOR SHARE;
  END IF;
  IF v_factor IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','purchase_unit_conversion_not_found');END IF;
  v_base_qty:=v_q::numeric*v_factor::numeric/1000000::numeric;
  IF v_base_qty<=0 OR v_base_qty<>trunc(v_base_qty) OR v_base_qty>9223372036854775807 THEN
   RETURN jsonb_build_object('ok',false,'code','purchase_unit_conversion_inexact');END IF;
 END LOOP;

 SELECT coalesce(jsonb_agg(to_jsonb(line)),'[]'::jsonb) INTO v_previous
   FROM public.purchase_order_lines line WHERE purchase_order_id=v_po.id;
 DELETE FROM public.purchase_order_lines WHERE purchase_order_id=v_po.id;
 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_item:=(v_line->>'inventoryItemId')::uuid;v_q:=(v_line->>'orderedPurchaseUnitsMicros')::bigint;
  v_cost:=(v_line->>'expectedPurchaseUnitCostMinor')::numeric;v_unit:=btrim(v_line->>'purchaseUnitLabel');
  SELECT unit_label INTO v_base FROM public.inventory_items WHERE id=v_item AND shop_id=p_shop_id;
  IF lower(v_unit)=lower(btrim(v_base)) THEN v_factor:=1000000;
  ELSE SELECT base_micros_per_purchase_unit INTO v_factor FROM public.inventory_unit_conversions
    WHERE shop_id=p_shop_id AND inventory_item_id=v_item AND active
      AND lower(btrim(purchase_unit_label))=lower(v_unit);END IF;
  INSERT INTO public.purchase_order_lines(
    purchase_order_id,inventory_item_id,purchase_unit_label,base_micros_per_purchase_unit,
    ordered_purchase_units_micros,ordered_base_micros,expected_purchase_unit_cost_minor,expected_unit_cost_minor)
  VALUES(v_po.id,v_item,v_unit,v_factor,v_q,
    (v_q::numeric*v_factor::numeric/1000000::numeric)::bigint,v_cost,
    v_cost*1000000::numeric/v_factor::numeric);
 END LOOP;
 UPDATE public.purchase_orders SET version=version+1,updated_at=now() WHERE id=v_po.id;
 PERFORM public.append_admin_audit_event_v1(v_business,p_shop_id,p_employee_id,
  'PURCHASING_PO_DRAFT_LINES_UPDATED','PURCHASE_ORDER',v_po.id::text,
  jsonb_build_object('version',v_po.version,'lines',v_previous),
  jsonb_build_object('version',v_po.version+1,'lines',p_lines),NULL,NULL,NULL,'{}'::jsonb);
 v_result:=jsonb_build_object('ok',true,'purchaseOrderId',v_po.id,'status','DRAFT',
  'version',v_po.version+1,'idempotentReplay',false);
 INSERT INTO public.admin_draft_po_line_commands(shop_id,command_id,request_digest,result)
  VALUES(p_shop_id,p_command_id,v_digest,v_result);
 RETURN v_result;
END;$$;
REVOKE ALL ON FUNCTION public.replace_draft_purchase_order_lines_v1(
 uuid,uuid,uuid,bigint,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_draft_purchase_order_lines_v1(
 uuid,uuid,uuid,bigint,jsonb,text) TO service_role;
