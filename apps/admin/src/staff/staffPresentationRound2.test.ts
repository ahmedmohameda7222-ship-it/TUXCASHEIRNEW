import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(directory, file), 'utf8');

describe('staff Round 2 presentation', () => {
  it('uses canonical shop names and the complete employee IA', () => {
    const page = read('StaffPage.tsx');
    const detail = read('EmployeeDetailPage.tsx');
    expect(page).toContain('workspaceQuery.data?.shops');
    expect(page).not.toContain('`Shop ${index + 1}`');
    expect(page).not.toContain('{employee.role}');
    for (const label of [
      'Profile',
      'Schedule',
      'Attendance',
      'Leave',
      'Pay / Compensation',
      'Access & Permissions',
    ]) {
      expect(detail).toContain(`label: '${label}'`);
    }
  });

  it('uses focused sensitive confirmations instead of a permanent actor PIN', () => {
    const detail = read('EmployeeDetailPage.tsx');
    expect(detail).toContain('<AdminDialog');
    expect(detail).not.toContain('<span>Your Admin PIN</span>');
    expect(detail).toContain('Change role');
    expect(detail).toContain('Reset employee PIN');
    expect(detail).toContain('Restore Operations access');
  });

  it('groups permissions under human-readable labels', () => {
    const permissions = read('PermissionsEditor.tsx');
    expect(permissions).toContain('permissionGroups');
    expect(permissions).toContain('Role default');
    expect(permissions).toContain('Not allowed');
    expect(permissions).toContain('Confirm permission change');
    expect(permissions).toContain('onSensitiveCommand');
    expect(permissions).not.toContain('<strong>{permission}</strong>');
  });

  it('uses business attendance, leave, and pay copy', () => {
    expect(read('AttendancePage.tsx')).toContain(
      'Original clock events are preserved. Corrections are recorded separately for audit history.',
    );
    expect(read('StaffPaymentPage.tsx')).not.toContain('Admin PIN for approval policy');
    expect(read('LeavePage.tsx')).not.toContain('{request.status}');
  });
});
