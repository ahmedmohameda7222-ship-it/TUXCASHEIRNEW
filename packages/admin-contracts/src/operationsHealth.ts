export type HealthState =
  'HEALTHY' | 'ATTENTION' | 'CRITICAL' | 'UNKNOWN' | 'STALE' | 'NOT_CONFIGURED';

export type ComponentHealth = {
  key: 'DEVICES' | 'SYNC' | 'BUSINESS_DAY' | 'ONLINE_ORDERS' | 'PRINTERS' | 'WHATSAPP';
  state: HealthState;
  observedAt: string | null;
  reason: string;
  href: string | null;
};

export type ShopHealth = {
  shopId: string;
  shopName: string;
  asOf: string;
  overall: HealthState;
  components: ComponentHealth[];
};

export type DeviceSessionState = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'UNKNOWN';

export type DeviceCapabilities = {
  canRename: boolean;
  canRevoke: boolean;
  canMoveShop: boolean;
  canEnroll: boolean;
  canRefreshConfig: boolean;
  canTestPrint: boolean;
};

export type DeviceSummary = {
  id: string;
  shopId: string;
  label: string;
  revoked: boolean;
  lastSeenAt: string | null;
  observedAt: string | null;
  sessionState: DeviceSessionState;
  configVersion: string | null;
  capabilities: DeviceCapabilities;
};

export type OperationsHealthResponse =
  | { view: 'summary'; health: ShopHealth }
  | { view: 'devices'; asOf: string; devices: DeviceSummary[] }
  | { view: 'device'; asOf: string; device: DeviceSummary };
