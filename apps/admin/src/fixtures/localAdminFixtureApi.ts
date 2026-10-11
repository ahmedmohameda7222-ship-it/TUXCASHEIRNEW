// Local-only Admin workspace data. Never import this module from a server/API entrypoint.
// All balances and business events below exist only in this browser session.
type Row = Record<string, any>;
const uuid = (n: number) => 'a7000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const shopA = uuid(1);
const shopB = uuid(2);
const businessId = uuid(3);
const ownerId = uuid(4);
const cashId = uuid(5);
const bankId = uuid(6);
const categoryId = uuid(7);
const productId = uuid(8);
const itemId = uuid(9);
const supplierId = uuid(10);
const poId = uuid(11);
const employeeId = uuid(12);
const customerId = uuid(13);
const riderId = uuid(14);
const zoneId = uuid(15);
const orderId = uuid(16);
const approvalId = uuid(17);
const cancellationReasonId = uuid(18);
const refundReasonId = uuid(19);
const businessDayId = uuid(20);
const paymentId = uuid(21);
const lineId = uuid(22);
const orderItemId = uuid(23);
const paymentMethodId = uuid(24);
const orderTypeId = uuid(25);
const promotionId = uuid(26);
const recurringId = uuid(27);
const secondOrderId = uuid(28);
const secondEmployeeId = uuid(29);
const secondCustomerId = uuid(30);
const expenseId = uuid(31);
const reportEventId = uuid(32);
const scheduleId = uuid(33);
const stocktakeId = uuid(34);
const transferId = uuid(35);
const reasonId = uuid(36);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const now = () => new Date().toISOString();
const daysAgo = (d: number) => new Date(Date.now()-d*86400_000).toISOString();
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const FIXTURE_SHOPS = [
  { id: shopA, name: 'TUX Maadi', address: 'Road 9, Maadi, Cairo' },
  { id: shopB, name: 'TUX Zamalek', address: '26 July Street, Zamalek, Cairo' },
] as const;
const perms = [
  'reports.view','staff.view','staff.manage','staff.payments','delivery.view','delivery.manage',
  'finance.view','finance.adjust','finance.reconcile','finance.manage_accounts',
  'catalog.view','catalog.edit','catalog.pricing','catalog.publish',
  'inventory.view','inventory.adjust','inventory.transfer','purchasing.view','purchasing.manage',
  'orders.view','orders.cancel','orders.refund','customers.view','customers.manage','loyalty.manage',
  'promotions.view','promotions.manage','settings.manage','approvals.review','audit.view',
  'alerts.view','devices.view','whatsapp.view',
];
const principal = { businessId, employeeId: ownerId, role: 'OWNER', permissions: perms, shopIds: [shopA, shopB] };
const csrfToken = 'd'.repeat(64);

function seed() {
  const products = [
    { id: productId, shopId: shopA, categoryId, name:'Classic Smash Burger', slug:'classic-smash-burger',
      description:'Smash beef patty, American cheese, signature sauce', priceMinor:18500, imageKey:null,
      family:'burger', bestSeller:true, active:true, soldOut:false, isCombo:false, sortOrder:10 },
    { id: uuid(40), shopId:shopA, categoryId, name:'Double Cheese Burger', slug:'double-cheese-burger',
      description:'Two beef patties, double cheese', priceMinor:24500, imageKey:null,
      family:'burger', bestSeller:true, active:true, soldOut:false, isCombo:false, sortOrder:20 },
    { id: uuid(41), shopId:shopA, categoryId, name:'Crispy Chicken Burger', slug:'crispy-chicken',
      description:'Crispy chicken, lettuce and house mayo', priceMinor:16900, imageKey:null,
      family:'chicken', bestSeller:false, active:true, soldOut:false, isCombo:false, sortOrder:30 },
    { id: uuid(42), shopId:shopA, categoryId, name:'Loaded Fries', slug:'loaded-fries',
      description:'Fries, cheese sauce and jalapeno', priceMinor:8500, imageKey:null,
      family:'side', bestSeller:false, active:true, soldOut:false, isCombo:false, sortOrder:40 },
  ];
  const customers = [
    { id:customerId, normalizedPhone:'+201023456781', displayName:'Mariam Hassan',
      orderCount:14, lifetimeSpendMinor:274500, lastOrderAt:daysAgo(0), loyaltyBalance:185,
      segments:['Returning','VIP','Top Spenders'] },
    { id:secondCustomerId, normalizedPhone:'+201101234567', displayName:'Omar Mostafa',
      orderCount:8, lifetimeSpendMinor:129000, lastOrderAt:daysAgo(1), loyaltyBalance:62,
      segments:['Returning','Frequent Delivery'] },
  ];
  const order = (id: string, no: number, name: string, phone: string, source:'POS'|'ONLINE',
    status:'ACTIVE'|'DONE', total: number, age: number) => ({
    id, shopId:shopA, status, operationalRevision:status==='ACTIVE'?3:7, source,
    displayOrderNo:no, displayOrderLabel:'#'+no, createdAt:daysAgo(age), totalMinor:total,
    customer:{contactId: id===orderId?customerId:secondCustomerId, name, normalizedPhone:phone},
    fulfillment:{orderTypeLabel:source==='ONLINE'?'Delivery':'Take away',
      behavior:source==='ONLINE'?'DELIVERY':'TAKE_AWAY',
      address:source==='ONLINE'?'Road 9, Maadi, Cairo':null,
      deliveryZoneLabel:source==='ONLINE'?'Maadi Core':null,finalDeliveryFeeMinor:source==='ONLINE'?2500:0},
    payments:[{id:paymentId, methodLabel:source==='ONLINE'?'Card':'Cash',
      logicType:source==='ONLINE'?'CARD':'CASH',allocatedMinor:total,receivedMinor:total,changeMinor:0}],
    items:[{id:id===orderId?orderItemId:uuid(43),productId,productName:'Classic Smash Burger',
      quantity:1,unitPriceMinor:18500,itemNote:null,modifiers:[],comboBeverages:[]}],
    statusHistory:[{id:uuid(44),eventType:status==='DONE'?'MARKED_DONE':'PLACED',
      operationalRevision:status==='DONE'?7:0,fromStatus:status==='DONE'?'ACTIVE':null,
      toStatus:status,workerName:'Youssef Ahmed',adminEmployeeId:null,
      reason:null,note:null,createdAt:daysAgo(age)}],
    financialEvents:[],inventoryMovements:[],auditEvents:[],
  });
  const orders=[order(orderId, 1042,'Mariam Hassan','+201023456781','ONLINE','ACTIVE',22500,0),
    order(secondOrderId,1041,'Omar Mostafa','+201101234567','POS','DONE',18500,1)];
  const employees=[
    {id:employeeId,displayName:'Mona Ali',phone:'+201012345678',role:'MANAGER',active:true,
      shopIds:[shopA],operationsSetupRequiredShopIds:[]},
    {id:secondEmployeeId,displayName:'Youssef Ahmed',phone:'+201095432123',role:'STAFF',active:true,
      shopIds:[shopA],operationsSetupRequiredShopIds:[]},
  ];
  const approvals=[
    {id:approvalId,requesterName:'Mona Ali',requesterEmployeeId:employeeId,approverName:null,
      shopId:shopA,shopName:'TUX Maadi',actionLabel:'Inventory stock adjustment',
      valueSummary:'Beef stock: -2.0 kg',reason:'Stock count reconciliation',
      consequence:'The stock correction is posted after approval.',status:'PENDING',
      displayStatus:'PENDING',canDecide:true,executionLabel:'Not started',
      expiresAt:new Date(Date.now()+3*86400_000).toISOString(),createdAt:daysAgo(0),decidedAt:null},
    {id:uuid(45),requesterName:'Youssef Ahmed',requesterEmployeeId:secondEmployeeId,approverName:'Mona Ali',
      shopId:shopA,shopName:'TUX Maadi',actionLabel:'Order refund',
      valueSummary:'185.00 EGP',reason:'Customer service recovery',
      consequence:'The refund was reviewed.',status:'APPROVED',
      displayStatus:'APPROVED',canDecide:false,executionLabel:'Completed',
      expiresAt:new Date(Date.now()+2*86400_000).toISOString(),createdAt:daysAgo(1),decidedAt:daysAgo(1)},
  ];
  const accounts=[
    {id:cashId,name:'Front Till',accountType:'CASH',shopId:shopA,active:true,
      openingBalanceMinor:250000,balanceMinor:437500,version:1},
    {id:bankId,name:'Business Bank Account',accountType:'BANK',shopId:shopA,active:true,
      openingBalanceMinor:1250000,balanceMinor:1640000,version:2},
    {id:uuid(46),name:'Card Settlement',accountType:'PENDING_SETTLEMENT',
      shopId:shopA,active:true,openingBalanceMinor:0,balanceMinor:125000,version:1},
  ];
  const inventory=[
    {id:itemId,name:'Beef Patty',unitLabel:'kg',trackingMode:'RECIPE_TRACKED',active:true,
      onHandMicros:34_500_000,reservedMicros:4_000_000,availableMicros:30_500_000,
      weightedUnitCostMinor:18000,history:[],reorderPointMicros:12_000_000},
    {id:uuid(47),name:'Burger Buns',unitLabel:'pcs',trackingMode:'RECIPE_TRACKED',active:true,
      onHandMicros:125_000_000,reservedMicros:18_000_000,availableMicros:107_000_000,
      weightedUnitCostMinor:1200,history:[],reorderPointMicros:40_000_000},
    {id:uuid(48),name:'Cheddar Cheese',unitLabel:'kg',trackingMode:'RECIPE_TRACKED',active:true,
      onHandMicros:8_000_000,reservedMicros:2_000_000,availableMicros:6_000_000,
      weightedUnitCostMinor:14000,history:[],reorderPointMicros:10_000_000},
    {id:uuid(49),name:'French Fries',unitLabel:'kg',trackingMode:'BULK',active:true,
      onHandMicros:42_000_000,reservedMicros:0,availableMicros:42_000_000,
      weightedUnitCostMinor:6500,history:[],reorderPointMicros:15_000_000},
  ];
  const supplier={id:supplierId,businessId,name:'Cairo Prime Foods',
    contactName:'Ahmed Khaled',phone:'+201067890123',email:'purchasing@cairoprime.example',
    active:true};
  const po={id:poId,shopId:shopA,supplierId,supplierName:supplier.name,status:'ORDERED',
    reference:'PO-2026-041',expectedDeliveryDate:today(),version:2,orderedAt:daysAgo(2),
    createdAt:daysAgo(3),updatedAt:daysAgo(2),
    lines:[{id:lineId,inventoryItemId:itemId,itemName:'Beef Patty',unitLabel:'kg',
      purchaseUnitLabel:'case',baseMicrosPerPurchaseUnit:2_000_000,
      orderedPurchaseUnitsMicros:5_000_000,receivedPurchaseUnitsMicros:0,
      returnedPurchaseUnitsMicros:0,orderedBaseMicros:10_000_000,
      receivedBaseMicros:0,returnedBaseMicros:0,remainingBaseMicros:10_000_000,
      expectedPurchaseUnitCostMinor:36000,expectedUnitCostMinor:18000}]};
  return {products,customers,orders,employees,approvals,accounts,inventory,
    suppliers:[supplier],purchaseOrders:[po],
    zones:[{id:zoneId,shopId:shopA,name:'Maadi Core',feeMinor:2500,
      minimumOrderMinor:12000,priority:20,active:true,
      boundary:{kind:'RADIUS',latitude:29.9602,longitude:31.2569,radiusMeters:4500},
      fallbackShopId:null,fallbackEnabled:false,sortOrder:1,version:3}],
    riders:[{id:riderId,shopId:shopA,displayName:'Ahmed Samir',phone:'+201015555555',
      active:true,state:'AVAILABLE',version:2}],
    deliveries:[{orderId,displayOrderNo:1042,displayOrderLabel:'#1042',
      shopId:shopA,riderId,state:'ASSIGNED',version:4,updatedAt:now()}],
    promotions:[{id:promotionId,businessId,name:'Lunch 10% Off',active:true,
      kind:'PERCENT',percentBasisPoints:1000,fixedDiscountMinor:null,freeProductId:null,
      startsAt:null,endsAt:null,minimumOrderMinor:12000,shopIds:[shopA,shopB],
      channel:'BOTH',productIds:[],categoryIds:[],totalUsageLimit:100,
      perCustomerUsageLimit:2,stackingPolicy:'ONE_ORDER_LEVEL',version:2,updatedAt:now()}],
    audit:[{id:uuid(50),shopId:shopA,shopName:'TUX Maadi',actorEmployeeId:employeeId,
      actorLabel:'Mona Ali',actorRole:'MANAGER',actionType:'INVENTORY_ADJUSTMENT_REQUESTED',
      entityType:'INVENTORY_ITEM',entityId:itemId,beforeValue:{availableMicros:34500000},
      afterValue:{availableMicros:30500000},reason:'Stock count reconciliation',
      approvalRequestId:approvalId,approvalStatus:'PENDING',createdAt:daysAgo(0)}],
    expenses:[{id:expenseId,shopId:shopA,categoryName:'Utilities',description:'Electricity bill',
      amountMinor:385000,occurredAt:daysAgo(1),createdAt:daysAgo(1),status:'POSTED'}],
    transfers:[] as Row[], stocktakes:[] as Row[], schedules:[] as Row[], shifts:[] as Row[],
    settingsVersion:7, publishVersion:48, loggedIn:true,
  };
}
let state=seed();
export function resetLocalAdminData(): void { state=seed(); }
const error = (status:number, errorCode:string): never => {
  throw Object.assign(new Error(errorCode), {name:'AdminApiError',status,errorCode});
};
function checkShop(shopId: string|null) {
  if (!shopId || !FIXTURE_SHOPS.some(s=>s.id===shopId)) error(403,'shop_forbidden');
  return shopId;
}
function reason(key:string,family:string,label:string,id:string) {
  return {id,scope:'BUSINESS',key,family,label,active:true,version:2};
}
const reasons=[
  reason('CUSTOMER_REQUEST','CANCELLATION','Customer request',cancellationReasonId),
  reason('QUALITY_ISSUE','REFUND_RETURN','Quality issue',refundReasonId),
  reason('STOCK_COUNT','STOCK_ADJUSTMENT','Stock count correction',reasonId),
];
function summary(o:Row) {
  return {id:o.id,shopId:o.shopId,status:o.status,operationalRevision:o.operationalRevision,
    source:o.source,displayOrderNo:o.displayOrderNo,displayOrderLabel:o.displayOrderLabel,
    createdAt:o.createdAt,totalMinor:o.totalMinor,customerName:o.customer.name,
    normalizedPhone:o.customer.normalizedPhone,orderTypeLabel:o.fulfillment.orderTypeLabel};
}
function settingWorkspace(shopId:string) {
  const shop = FIXTURE_SHOPS.find(s=>s.id===shopId)!;
  return {shop:{id:shopId,name:shop.name,lifecycleState:'ACTIVE',active:true,
    address:shop.address,contactPhone:'+20225255000',latitude:29.9602,longitude:31.2569,
    timezone:'Africa/Cairo',temporaryClosed:false,onlineOrdersPaused:false},
    settingsVersion:state.settingsVersion,
    businessDefaults:[
      {key:'checkout.minimumOrderMinor',value:12000,version:1},
      {key:'checkout.serviceChargeBps',value:500,version:1},
      {key:'checkout.taxBps',value:1400,version:1},
      {key:'checkout.requireCustomerPhone',value:false,version:1},
      {key:'checkout.allowScheduledOrders',value:true,version:1},
      {key:'receipt.footer',value:'Thank you for visiting TUX',version:2},
      {key:'receipt.orderPrefix',value:'TUX-',version:1},
      {key:'receipt.sequenceStart',value:1,version:1},
      {key:'receipt.sequenceResetPolicy',value:'BUSINESS_DAY',version:1},
    ],shopOverrides:[{key:'receipt.orderPrefix',value:'MD-',version:4}],
    orderTypes:[
      {id:orderTypeId,name:'Take Away',behavior:'TAKE_AWAY',active:true,sortOrder:10,editVersion:3},
      {id:uuid(55),name:'Delivery',behavior:'DELIVERY',active:true,sortOrder:20,editVersion:1}],
    paymentMethods:[{id:paymentMethodId,displayName:'Cash',logicType:'CASH',
      requiresReconciliation:true,active:true,sortOrder:10,channel:'BOTH',
      requiresReference:false,manualConfirmationRequired:false,refundAllowed:true,
      integrationReference:null,editVersion:5},
      {id:uuid(56),displayName:'Card',logicType:'CARD',
        requiresReconciliation:true,active:true,sortOrder:20,channel:'BOTH',
        requiresReference:true,manualConfirmationRequired:false,refundAllowed:true,
        integrationReference:null,editVersion:2}],
    deliveryZones:state.zones.filter(x=>x.shopId===shopId),
    reasonCodes:reasons,weeklyHours:[],specialHours:[]};
}
function employeeDetail(id:string) {
  const e=state.employees.find(x=>x.id===id);
  if(!e) error(404,'employee_not_found');
  return {...e,businessId,hireDate:'2026-06-01',notes:null,profileVersion:3,credentialVersion:4,
    customPermissions:[],assignments:e.shopIds.map((shopId:string)=>({shopId,assigned:true})),
    operationsIdentities:[],compensation:[{id:uuid(57),shopId:shopA,
      effectiveFrom:today(),baseAmountMinor:1600000,frequency:'MONTHLY'}],
    shifts:state.shifts.filter(x=>x.employeeId===id),
    attendanceEvents:[{id:uuid(58),employeeId:id,shopId:shopA,workerId:uuid(59),
      workerSessionId:uuid(60),eventType:'SESSION_START',
      occurredAt:daysAgo(0),createdAt:daysAgo(0)}],
    attendanceCorrections:[],attendanceSummaries:[],leaveRequests:[],payments:[]};
}
function customerDetail(id:string) {
  const c=state.customers.find(x=>x.id===id);
  if(!c) error(404,'customer_not_found');
  return {...c,deliveryOrderCount:5,
    segments:[...new Set([...c.segments,'Loyalty Members','Frequent Delivery'])],
    linkedShops:[{shopId:shopA,shopName:'TUX Maadi'}],
    addresses:[{id:uuid(61),shopId:shopA,address:'Road 9, Maadi, Cairo',
      deliveryZoneId:zoneId,lastUsedAt:daysAgo(1)}],
    loyaltyHistory:[{id:uuid(62),shopId:shopA,orderId, eventType:'EARN',
      pointsDelta:20,monetaryValueMinor:0,earnExpiresAt:null,reason:null,note:null,
      sourceEventId:uuid(63),createdAt:daysAgo(0)}]};
}
function settingsResults(cmd:Row) {
  if(cmd.type==='settings.publish'){state.settingsVersion++;return {ok:true,settingsVersion:state.settingsVersion,operationsConfigurationVersion:state.settingsVersion+20};}
  if(cmd.type==='setting.override.upsert') return {ok:true,version:5};
  if(cmd.type==='order-type.update'||cmd.type==='payment-method.update')return {ok:true,editVersion:4};
  if(cmd.type==='reason-code.upsert')return {ok:true,reasonCodeId:cmd.reasonCodeId||reasonId,version:3};
  if(cmd.type==='settings.schedule-publish'||cmd.type==='shop.online-orders.schedule'){
    const schedule={id:scheduleId,scheduleId,status:'PENDING',scheduledFor:now(),
      localScheduledAt:cmd.localScheduledAt,timezone:'Africa/Cairo'};
    state.schedules.push(schedule);return {ok:true,...schedule};
  }
  if(cmd.type==='settings.schedule.cancel'){state.schedules=[];return {ok:true,status:'CANCELLED'};}
  if(cmd.type==='shop.identity.update'||cmd.type==='shop.weekly-hours.upsert'||
     cmd.type==='shop.special-hours.upsert'||cmd.type==='shop.operational-state.update')return {ok:true,settingsVersion:++state.settingsVersion};
  if(cmd.type==='shop.delete-or-archive')return {ok:true,action:'ARCHIVED'};
  error(400,'unsupported_settings_command');
}
function reports(url:URL) {
  const view=url.searchParams.get('view');
  if(view==='configuration')return {savedViews:[],targets:[
    {id:uuid(64),shopId:shopA,metric:'NET_SALES',periodStart:today(),periodEnd:today(),
      targetValue:125000,version:1}]};
  if(view==='filter-options')return {options:{
    paymentMethods:[{id:paymentMethodId,label:'Cash'}],
    orderTypes:[{id:orderTypeId,label:'Take Away'}],
    products:state.products.map(x=>({id:x.id,label:x.name})),
    employees:state.employees.map(x=>({id:x.id,label:x.displayName}))}};
  if(view==='dashboard') {
    const trends=Array.from({length:7},(_,i)=>({
      date:new Date(Date.now()-(6-i)*86400_000).toISOString().slice(0,10),
      netSalesMinor:[2180000,2530000,2410000,2850000,2970000,3210000,3585000][i]}));
    return {ok:true,netSalesMinor:3585000,orderCount:142,averageOrderMinor:25246,
      estimatedOperatingProfitMinor:1123500,lowStockCount:1,outOfStockCount:0,
      failedOnlineOrderCount:1,pendingApprovalCount:1,staffOnShiftCount:6,deliveryOpenCount:2,
      salesTrend:trends,topProducts:state.products.map((p,i)=>({
        name:p.name,quantity:62-i*12,recordedSalesMinor:p.priceMinor*(62-i*12)})),
      sourceMix:[{source:'POS',orderCount:98},{source:'ONLINE',orderCount:44}],
      shopComparison:[{shopName:'TUX Maadi',orderCount:142,netSalesMinor:3585000},
        {shopName:'TUX Zamalek',orderCount:106,netSalesMinor:2430000}]};
  }
  const area=url.searchParams.get('area')||'sales';
  const rows=Array.from({length:12},(_,i)=>({id:i===0?reportEventId:uuid(80+i),
    shopId:shopA,sourceKind:area==='sales'?'payment':area,occurredAt:daysAgo(i%7),
    label:i%3===0?'Classic Smash Burger':i%3===1?'Double Cheese Burger':'Loaded Fries',
    amountMinor:18500+i*900,quantity:1+i%4,orderSource:i%3?'POS':'ONLINE',
    costMissing:false,drilldown:null}));
  return {ok:true,area,summary:{eventCount:142,orderCount:142,totalAmountMinor:3585000,
    totalQuantity:249,incompleteCostEvents:0,coverageNote:null},
    rows,nextOffset:null};
}
function finance(view:string|null,url:URL,shopId:string) {
  if(view==='days')return {days:[{id:businessDayId,shop_id:shopId,status:'OPEN',
    started_at:daysAgo(0),ended_at:null}]};
  if(view==='day')return {ok:true,shopId,businessDayId,businessDayStatus:'OPEN',
    startedAt:daysAgo(0),endedAt:null,orderCount:142,netSalesMinor:3585000,
    postedRefundsMinor:18500,cashSalesNetMinor:1975000,totalExpensesMinor:385000,
    cogsMinor:860000,estimatedOperatingProfitMinor:1123500,missingInventoryCostCount:0,
    unattributedPaymentCount:0,missingCashierReconciliationCount:0,
    paymentBreakdown:{Cash:1975000,Card:1610000},cashierReconciliations:[],financialFinalized:false};
  if(view==='day-history')return {snapshots:[],adjustments:[]};
  if(view==='cashiers')return {workers:state.employees.map(x=>({id:x.id,displayName:x.displayName})),
    cashiers:[],reconciliations:[]};
  if(view==='owner-summary')return {summaries:[{shopId:shopA,shopName:'TUX Maadi',
    netSalesMinor:3585000,orderCount:142,estimatedOperatingProfitMinor:1123500}]};
  if(view==='expenses')return {expenses:state.expenses,nextCursor:null};
  if(view==='categories')return {categories:[{id:uuid(100),name:'Utilities'},
    {id:uuid(101),name:'Supplies'},{id:uuid(102),name:'Maintenance'}]};
  if(view==='settlements')return {settlements:[]};
  if(view==='recurring')return {recurringExpenses:[{id:recurringId,description:'Monthly rent',
    amountMinor:2400000,status:'ACTIVE',frequency:'MONTHLY',nextDueDate:today()}]};
  if(view==='account-history')return {accountId:url.searchParams.get('accountId'),
    movements:[{id:uuid(103),amountMinor:215000,movementType:'DEPOSIT',
      description:'Daily cash deposit',createdAt:daysAgo(0)}]};
  return {setupState:'READY',accounts:state.accounts.filter(x=>x.shopId===shopId),
    paymentMethods:[{id:paymentMethodId,displayName:'Cash',financeAccountId:cashId}],
    moneyPosition:{totalTrackedMoneyMinor:2202500,cashMinor:437500,
      bankMinor:1640000,walletMinor:0,pendingSettlementMinor:125000},
    profitSummary:{netSalesMinor:3585000,cogsMinor:860000,expensesMinor:385000,
      estimatedOperatingProfitMinor:1123500},unmappedPaymentMethodCount:0};
}
function respondGet(section:string,url:URL):unknown {
  const view=url.searchParams.get('view');
  if(section==='session') {if(!state.loggedIn)error(401,'session_required');return {principal,csrfToken};}
  if(section==='approvals') {
    const id=url.searchParams.get('id');
    const approvals=id?state.approvals.filter(x=>x.id===id):state.approvals;
    return {approvals,nextCursor:null};
  }
  if(section==='audit') {
    const id=url.searchParams.get('eventId');
    return {events:id?state.audit.filter(x=>x.id===id):state.audit,nextCursor:null};
  }
  const shopId=checkShop(url.searchParams.get('shopId'));
  if(section==='catalog') {
    const data={shopId,currentPublishVersion:state.publishVersion,
      categories:[{id:categoryId,shopId,name:'Burgers',slug:'burgers',
        description:'Fresh burgers',sortOrder:10,active:true}],
      products:state.products.map(x=>({...x,shopId})),drafts:[]};
    if(view==='publishing')return {...data,versions:[],scheduledPublishes:[],
      history:[],schedules:[],activeDraft:null};
    return data;
  }
  if(section==='inventory') {
    const selected=url.searchParams.get('inventoryItemId');
    if(selected) {
      const it=state.inventory.find(x=>x.id===selected);
      if(!it)error(404,'inventory_item_not_found');
      return {inventoryItemId:selected,history:[{id:uuid(120),movementType:'BULK_STOCK_RECEIVED',
        quantityDeltaMicros:12_000_000,reservedDeltaMicros:0,reasonLabel:null,
        createdAt:daysAgo(3)}]};
    }
    return {shopId,shops:FIXTURE_SHOPS,items:state.inventory,transfers:state.transfers,
      stocktakes:state.stocktakes,reasonCodes:[
        reason('COUNT_CORRECTION','STOCK_ADJUSTMENT','Count correction',reasonId),
        reason('SPOILAGE','WASTE','Spoilage',uuid(125))]};
  }
  if(section==='purchasing')return {shopId,suppliers:state.suppliers,inventoryItems:state.inventory.map(x=>({id:x.id,name:x.name,unitLabel:x.unitLabel})),
    purchaseOrders:state.purchaseOrders};
  if(section==='orders') {
    if(view==='action-reasons')return {reasons};
    const id=url.searchParams.get('orderId');
    if(id){const o=state.orders.find(x=>x.id===id);if(!o)error(404,'order_not_found');return o;}
    const term=(url.searchParams.get('q')||'').toLowerCase();
    const statuses=url.searchParams.getAll('status');
    const source=url.searchParams.get('source');
    const rows=state.orders.filter(x=>(!statuses.length||statuses.includes(x.status))&&(!source||source===x.source)&&
      (!term||[x.displayOrderNo,x.customer.name,x.customer.normalizedPhone].some(v=>String(v).toLowerCase().includes(term))))
      .map(summary);
    return {shopId,rows,nextCursor:null};
  }
  if(section==='customers'){
    if(view==='customers') {
      const term=(url.searchParams.get('q')||'').toLowerCase();
      return {customers:state.customers.filter(c=>(c.displayName+' '+c.normalizedPhone).toLowerCase().includes(term))};}
    if(view==='customer')return {customer:customerDetail(url.searchParams.get('customerId')||'')};
    if(view==='promotions')return {promotions:state.promotions};
    if(view==='loyalty-program')return {program:{businessId,enabled:true,
      earnPointsPer100Minor:3,redemptionMinorPerPoint:17,minimumRedemptionPoints:75,
      pointExpiryDays:180,shopIds:[shopA,shopB],version:3,updatedAt:now()}};
    return {reasons:[reason('SERVICE_RECOVERY','DISCOUNT_COMP','Service recovery',uuid(126))]};
  }
  if(section==='delivery')return {shopId,shops:FIXTURE_SHOPS,zones:state.zones,
    riders:state.riders,orders:state.deliveries};
  if(section==='staff'){
    const employeeId=url.searchParams.get('employeeId');
    if(employeeId) return {employee:employeeDetail(employeeId)};
    return {employees:{rows:state.employees,nextCursor:null},workers:[],shops:FIXTURE_SHOPS,
      financeAccounts:state.accounts.filter(x=>x.active&&x.shopId===shopId).map(x=>({
        id:x.id,shopId:x.shopId,accountType:x.accountType,name:x.name}))};
  }
  if(section==='settings')return settingWorkspace(shopId);
  if(section==='settings-schedule')return {schedules:state.schedules};
  if(section==='finance')return finance(view,url,shopId);
  if(section==='reports')return reports(url);
  error(404,'admin_surface_not_found');
}
function respondPost(section:string,cmd:Row):unknown {
  if(section==='login'){state.loggedIn=true;return {principal,csrfToken};}
  if(section==='logout'){state.loggedIn=false;return {ok:true};}
  if(section==='reauth')return {ok:true,reauthenticatedAt:now()};
  if(!state.loggedIn)error(401,'session_required');
  checkShop(cmd.shopId);
  const type=String(cmd.type||'');
  if(section==='settings'||section==='settings-schedule')return settingsResults(cmd);
  if(section==='delivery'){
    if(type==='delivery.transition'){
      const o=state.deliveries.find(x=>x.orderId===cmd.orderId);
      if(!o)error(404,'delivery_order_not_found');
      o.state=cmd.toState;o.version++;o.updatedAt=now();
      return {ok:true,orderId:o.orderId,state:o.state,version:o.version,replayed:false};
    }
    if(type==='delivery.zone.upsert'){return {ok:true,zoneId:zoneId,version:4};}
    if(type==='delivery.rider.upsert'){return {ok:true,riderId,version:3};}
  }
  if(section==='orders'){
    const o=state.orders.find(x=>x.id===cmd.orderId);
    if(!o)error(404,'order_not_found');
    if(type==='order.cancel'){o.status='CANCELLED';o.operationalRevision++;
      return {ok:true,orderId:o.id,status:o.status,operationalRevision:o.operationalRevision,replayed:false};}
    if(type==='order.refund'||type==='order.return')return {ok:true,orderId:o.id,state:'POSTED',replayed:false};
  }
  if(section==='inventory'){
    const it=state.inventory.find(x=>x.id===cmd.inventoryItemId);
    if(type==='stock.adjust'||type==='stock.waste'){
      if(!it)error(404,'inventory_item_not_found');
      const delta=Number(cmd.quantityDeltaMicros||cmd.quantityMicros||0);
      it.onHandMicros+=type==='stock.waste'?-Math.abs(delta):delta;
      it.availableMicros=it.onHandMicros-it.reservedMicros;
      return {ok:true,inventoryItemId:it.id,availableMicros:it.availableMicros,replayed:false};
    }
    if(type==='transfer.send'||type==='transfer.receive')return {ok:true,transferId,replayed:false};
    if(type==='stocktake.begin'||type==='stocktake.post')return {ok:true,stocktakeId,replayed:false};
    if(type==='replenishment.update')return {ok:true,replayed:false};
  }
  if(section==='purchasing'){
    if(type==='supplier.create'){
      const id=uuid(140+state.suppliers.length);
      state.suppliers.push({id,businessId,name:String(cmd.name),contactName:cmd.contactName||null,
        phone:cmd.phone||null,email:cmd.email||null,active:true});
      return {ok:true,supplierId:id,replayed:false};
    }
    if(type.startsWith('po.')){
      const po=state.purchaseOrders.find(x=>x.id===cmd.purchaseOrderId)||state.purchaseOrders[0];
      if(!po)error(404,'purchase_order_not_found');
      if(type==='po.order')po.status='ORDERED';
      if(type==='po.receive')po.status='PARTIALLY_RECEIVED';
      if(type==='po.return')po.status='PARTIALLY_RECEIVED';
      po.version++;
      return {ok:true,purchaseOrderId:po.id,status:po.status,version:po.version,replayed:false};
    }
  }
  if(section==='approvals'&&(type==='approval.decide'||cmd.requestId)){
    const a=state.approvals.find(x=>x.id===(cmd.requestId||cmd.approvalRequestId));
    if(!a)error(404,'approval_not_found');
    a.status=cmd.decision==='REJECT'?'REJECTED':'APPROVED';
    a.displayStatus=a.status;a.canDecide=false;a.decidedAt=now();
    return {ok:true,requestId:a.id,status:a.status};
  }
  if(section==='finance'&&type.startsWith('finance.')){
    if(type==='finance.transfer'){
      const from=state.accounts.find(x=>x.id===cmd.fromAccountId);
      const to=state.accounts.find(x=>x.id===cmd.toAccountId);
      if(!from||!to)error(404,'account_not_found');
      const amount=Number(cmd.amountMinor);
      if(!Number.isSafeInteger(amount)||amount<=0||from.balanceMinor<amount)error(409,'insufficient_funds');
      from.balanceMinor-=amount;to.balanceMinor+=amount;
    }
    return {ok:true,replayed:false,accountId:cmd.accountId||cashId,version:2};
  }
  if(section==='customers'){
    if(type==='promotion.upsert')return {ok:true,promotionId,version:3,replayed:false};
    if(type==='loyalty.adjust'){
      const c=state.customers.find(x=>x.id===cmd.customerId)||state.customers[0];
      c.loyaltyBalance+=Number(cmd.pointsDelta||0);
      return {ok:true,ledgerEventId:uuid(149),balance:c.loyaltyBalance,replayed:false};
    }
    if(type==='customer.merge')return {ok:true,survivorCustomerId:customerId,
      mergedCustomerId:secondCustomerId,replayed:false};
    if(type==='loyalty.program.update')return {ok:true,version:4};
  }
  if(section==='staff'){
    if(type==='employee.create'){
      const id=uuid(150+state.employees.length);
      state.employees.push({id,displayName:String(cmd.displayName||cmd.name||'New employee'),
        phone:String(cmd.phone||''),role:'STAFF',active:true,
        shopIds:[cmd.shopId],operationsSetupRequiredShopIds:[cmd.shopId]});
      return {ok:true,employeeId:id,replayed:false};
    }
    if(type==='employee.suspend'||type==='employee.reactivate'){
      const employee=state.employees.find(x=>x.id===cmd.employeeId);
      if(!employee)error(404,'employee_not_found');
      employee.active=type==='employee.reactivate';
    }
    if(type==='shift.create'||type==='shift.add')state.shifts.push({id:uuid(153+state.shifts.length),...cmd});
    if(type==='employee.update'){
      const employee=state.employees.find(x=>x.id===cmd.employeeId);
      if(employee&&cmd.displayName)employee.displayName=String(cmd.displayName);
    }
    return {ok:true,replayed:false,employeeId:cmd.employeeId||employeeId};
  }
  if(section==='catalog'){
    if(type==='availability.set'){
      const p=state.products.find(x=>x.id===cmd.productId);
      if(!p)error(404,'product_not_found');
      p.soldOut=Boolean(cmd.soldOut);state.publishVersion++;
      return {ok:true,productId:p.id,soldOut:p.soldOut,
        publishVersion:state.publishVersion,operationsConfigurationVersion:state.publishVersion};
    }
    if(type==='draft.create'||type==='draft.resume'||type==='draft.save'){
      return {ok:true,draftId:uuid(154),draftRevision:2,basePublishVersion:state.publishVersion,
        bundleJson:{snapshot:{shopId:shopA,version:state.publishVersion,
          categories:[],products:state.products},inventoryItems:[]}};
    }
    if(type==='draft.publish'||type==='draft.schedule'||type==='version.restore'||
      type==='schedule.cancel')return {ok:true,publishVersion:++state.publishVersion};
  }
  if(section==='reports'&&(type==='report.view.save'||type==='report.view.delete'||type==='report.target.set'))
    return {ok:true,id:uuid(155),version:2};
  error(400,'unsupported_admin_command');
}
export async function requestLocalAdmin<T=unknown>(path:string, init:RequestInit={}):Promise<T> {
  if(!path.startsWith('/api/admin/'))error(400,'admin_api_path_required');
  const url=new URL(path,'http://localhost');
  const section=url.pathname.split('/')[3]||'';
  const method=(init.method||'GET').toUpperCase();
  let result:unknown;
  if(method==='GET')result=respondGet(section,url);
  else if(method==='POST'){
    let cmd:unknown;
    try{cmd=init.body?JSON.parse(String(init.body)):{};}catch{error(400,'invalid_json_body');}
    if(!cmd||typeof cmd!=='object'||Array.isArray(cmd))error(400,'invalid_json_body');
    result=respondPost(section,cmd as Row);
  } else error(405,'method_not_allowed');
  return copy(result) as T;
}
