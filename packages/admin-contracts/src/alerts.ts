export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type AlertSource = 'APPROVAL' | 'INVENTORY' | 'DELIVERY' | 'OPERATIONS' | 'WHATSAPP';

export type AdminAlert = {
  id: string;
  businessId: string;
  shopId: string | null;
  shopName: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  description: string;
  observedAt: string;
  entityId: string | null;
  href: string;
  state: 'ACTIVE' | 'RESOLVED';
};

export type AdminAlertsPage = {
  rows: AdminAlert[];
  nextCursor: string | null;
  asOf: string;
  scopeLabel: string;
  unavailableSources: AlertSource[];
};
