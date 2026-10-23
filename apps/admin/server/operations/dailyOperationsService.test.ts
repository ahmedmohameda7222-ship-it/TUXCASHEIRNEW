import type {
  AdminSessionPrincipal,
  DailyChecklistWorkspace,
  ManagerLogPage,
} from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthorizationError } from '../authorization.js';
import { createDailyOperationsService } from './dailyOperationsService.js';

const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '22222222-2222-4222-8222-222222222222';
const principal: AdminSessionPrincipal = {
  employeeId: '33333333-3333-4333-8333-333333333333',
  businessId: '44444444-4444-4444-8444-444444444444',
  role: 'MANAGER',
  permissions: ['devices.view', 'devices.manage'],
  shopIds: [SHOP_A],
};
const workspace: DailyChecklistWorkspace = {
  shopId: SHOP_A,
  businessDayId: null,
  kind: 'OPEN',
  configured: false,
  templateId: null,
  templateTitle: null,
  templateVersion: null,
  runId: null,
  runVersion: null,
  openedAt: null,
  completedAt: null,
  actorEmployeeId: null,
  items: [],
};
const page: ManagerLogPage = { rows: [], nextCursor: null };

describe('daily operations service', () => {
  it('requires devices.view for reads and enforces shop scope before dependencies', async () => {
    const readChecklist = vi.fn(async () => workspace);
    const service = createDailyOperationsService({
      readChecklist,
      readManagerLog: async () => page,
      completeChecklist: async () => ({ ok: true }),
      appendManagerNote: async () => ({ ok: true }),
    });
    expect(() => service.readChecklist({ shopId: SHOP_B, kind: 'OPEN' }, principal)).toThrow(
      AdminAuthorizationError,
    );
    expect(readChecklist).not.toHaveBeenCalled();
  });

  it('blocks completion without a canonical business day before mutation', async () => {
    const completeChecklist = vi.fn(async () => ({ ok: true }));
    const service = createDailyOperationsService({
      readChecklist: async () => workspace,
      readManagerLog: async () => page,
      completeChecklist,
      appendManagerNote: async () => ({ ok: true }),
    });
    await expect(
      service.completeChecklist(
        {
          shopId: SHOP_A,
          kind: 'OPEN',
          businessDayId: null,
          templateId: '55555555-5555-4555-8555-555555555555',
          expectedVersion: 1,
          doneItemIds: [],
          commandId: 'command-1',
        },
        principal,
      ),
    ).resolves.toEqual({ ok: false, code: 'business_day_required' });
    expect(completeChecklist).not.toHaveBeenCalled();
  });

  it('requires devices.manage for completion and notes', async () => {
    const restricted = {
      ...principal,
      permissions: ['devices.view'] as AdminSessionPrincipal['permissions'],
    };
    const service = createDailyOperationsService({
      readChecklist: async () => workspace,
      readManagerLog: async () => page,
      completeChecklist: async () => ({ ok: true }),
      appendManagerNote: async () => ({ ok: true }),
    });
    expect(() =>
      service.appendManagerNote(
        { shopId: SHOP_A, note: 'Safe note', correctionOfId: null, commandId: 'note-1' },
        restricted,
      ),
    ).toThrow(AdminAuthorizationError);
  });

  it('rejects controls, HTML and notes over 2,000 characters', async () => {
    const appendManagerNote = vi.fn(async () => ({ ok: true }));
    const service = createDailyOperationsService({
      readChecklist: async () => workspace,
      readManagerLog: async () => page,
      completeChecklist: async () => ({ ok: true }),
      appendManagerNote,
    });
    for (const note of ['bad\u0000note', '<b>html</b>', 'x'.repeat(2001)]) {
      await expect(
        service.appendManagerNote(
          { shopId: SHOP_A, note, correctionOfId: null, commandId: 'note-1' },
          principal,
        ),
      ).resolves.toEqual({ ok: false, code: 'manager_note_invalid' });
    }
    expect(appendManagerNote).not.toHaveBeenCalled();
  });

  it('passes tenant and actor identity to canonical mutations', async () => {
    const appendManagerNote = vi.fn(async () => ({
      ok: true,
      entryId: 'entry-1',
      replayed: false,
    }));
    const service = createDailyOperationsService({
      readChecklist: async () => workspace,
      readManagerLog: async () => page,
      completeChecklist: async () => ({ ok: true }),
      appendManagerNote,
    });
    await service.appendManagerNote(
      { shopId: SHOP_A, note: '  Opening checked  ', correctionOfId: null, commandId: 'note-1' },
      principal,
    );
    expect(appendManagerNote).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: principal.businessId,
        actorEmployeeId: principal.employeeId,
        note: 'Opening checked',
      }),
    );
  });
});
