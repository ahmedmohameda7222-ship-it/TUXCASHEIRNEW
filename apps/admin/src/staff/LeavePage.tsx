import type { EmployeeDetail, StaffLeaveType } from '@tux/admin-contracts';
import { useState } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';
import type { StaffCommandDraft } from './SchedulePage';

function leaveTypeLabel(type: StaffLeaveType): string {
  return type === 'SICK'
    ? 'Sick leave'
    : type === 'UNPAID'
      ? 'Unpaid leave'
      : type === 'OTHER'
        ? 'Other leave'
        : 'Vacation';
}

function leaveStatusLabel(status: string): string {
  return status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : 'Pending';
}

export function LeavePage({
  employee,
  shopId,
  canManage,
  onCommand,
}: {
  employee: EmployeeDetail;
  shopId: string;
  canManage: boolean;
  onCommand(command: StaffCommandDraft): void;
}) {
  const [leaveType, setLeaveType] = useState<StaffLeaveType>('VACATION');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [note, setNote] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);

  return (
    <section aria-label="Leave">
      <h3>Leave</h3>
      {employee.leaveRequests.length === 0 ? <p>No leave requests.</p> : null}
      {employee.leaveRequests.map((request) => (
        <article className="admin-inventory-row" key={request.id}>
          <span>
            <strong>{leaveTypeLabel(request.leaveType)}</strong>
            <small>
              {request.startsOn} → {request.endsOn}
            </small>
          </span>
          <span>
            {leaveStatusLabel(request.status)}
            {canManage && request.status === 'PENDING' ? (
              <>
                <button
                  className="admin-destructive-button"
                  type="button"
                  onClick={() =>
                    onCommand({
                      type: 'leave.decide',
                      leaveRequestId: request.id,
                      shopId,
                      expectedVersion: request.version,
                      decision: 'APPROVED',
                      reason: null,
                    })
                  }
                >
                  Approve
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() =>
                    onCommand({
                      type: 'leave.decide',
                      leaveRequestId: request.id,
                      shopId,
                      expectedVersion: request.version,
                      decision: 'REJECTED',
                      reason: null,
                    })
                  }
                >
                  Reject
                </button>
              </>
            ) : null}
          </span>
        </article>
      ))}

      {canManage ? (
        <>
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => setRequestOpen(true)}
          >
            New leave request
          </button>
          <AdminDialog
            open={requestOpen}
            variant="sheet"
            title="New leave request"
            description="Record the requested dates and leave type."
            onOpenChange={setRequestOpen}
          >
            <label className="admin-field">
              <span>Type</span>
              <select
                value={leaveType}
                onChange={(event) => setLeaveType(event.target.value as StaffLeaveType)}
              >
                <option value="VACATION">Vacation</option>
                <option value="SICK">Sick</option>
                <option value="UNPAID">Unpaid</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="admin-field">
              <span>Start date</span>
              <input
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>End date</span>
              <input
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Note</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <button
              className="admin-primary-button"
              type="button"
              disabled={!startsOn || !endsOn}
              onClick={() => {
                onCommand({
                  type: 'leave.create',
                  employeeId: employee.id,
                  shopId,
                  leaveType,
                  startsOn,
                  endsOn,
                  note: note.trim() || null,
                });
                setRequestOpen(false);
              }}
            >
              Request leave
            </button>
          </AdminDialog>
        </>
      ) : null}
    </section>
  );
}
