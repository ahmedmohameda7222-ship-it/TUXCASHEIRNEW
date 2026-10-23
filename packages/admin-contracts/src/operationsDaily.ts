export type DailyChecklistKind = 'OPEN' | 'CLOSE';

export type DailyChecklistItem = {
  id: string;
  label: string;
  required: boolean;
  done: boolean;
  doneByEmployeeId: string | null;
  doneAt: string | null;
};

export type DailyChecklistWorkspace = {
  shopId: string;
  businessDayId: string | null;
  kind: DailyChecklistKind;
  configured: boolean;
  templateId: string | null;
  templateTitle: string | null;
  templateVersion: number | null;
  runId: string | null;
  runVersion: number | null;
  openedAt: string | null;
  completedAt: string | null;
  actorEmployeeId: string | null;
  items: DailyChecklistItem[];
};

export type ManagerLogEntry = {
  id: string;
  shopId: string;
  note: string;
  authorEmployeeId: string;
  createdAt: string;
  correctionOfId: string | null;
};

export type ManagerLogPage = { rows: ManagerLogEntry[]; nextCursor: string | null };
