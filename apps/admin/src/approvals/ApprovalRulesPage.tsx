import type { AdminPermission } from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { adminFetch } from '../lib/adminApi';
import './approvalRules.css';

type ThresholdKind = 'none' | 'minimumMinor' | 'minimumQuantityImpact';

type ApprovalRule = {
  id: string;
  shopId: string | null;
  actionType: string;
  requesterPermission: AdminPermission;
  approverPermission: 'approvals.review';
  requiresSecondPerson: boolean;
  requiresRequesterRepin: boolean;
  expiresAfterSeconds: number;
  thresholdContext: Readonly<Record<string, unknown>>;
  active: boolean;
  editVersion: number;
};

type ConfigurableApprovalAction = {
  actionType: string;
  label: string;
  requesterPermission: AdminPermission;
  thresholdKind: 'minimumMinor' | 'minimumQuantityImpact' | null;
};
type ApprovalRulesResponse = {
  rules: ApprovalRule[];
  availableActions: ConfigurableApprovalAction[];
};

type RuleForm = {
  ruleId: string | null;
  shopId: string | null;
  actionType: string;
  requesterPermission: AdminPermission;
  requiresSecondPerson: boolean;
  requiresRequesterRepin: boolean;
  expiresAfterSeconds: string;
  thresholdKind: ThresholdKind;
  thresholdValue: string;
  active: boolean;
  expectedVersion: number | null;
};

function initialForm(shopId: string | null): RuleForm {
  return {
    ruleId: null,
    shopId,
    actionType: '',
    requesterPermission: 'inventory.adjust',
    requiresSecondPerson: true,
    requiresRequesterRepin: false,
    expiresAfterSeconds: '86400',
    thresholdKind: 'none',
    thresholdValue: '',
    active: true,
    expectedVersion: null,
  };
}

function editableRule(row: ApprovalRule): RuleForm | null {
  const entries = Object.entries(row.thresholdContext);
  if (entries.length > 1) return null;
  const entry = entries[0];
  if (
    entry &&
    ((entry[0] !== 'minimumMinor' && entry[0] !== 'minimumQuantityImpact') ||
      typeof entry[1] !== 'number' ||
      !Number.isSafeInteger(entry[1]) ||
      entry[1] <= 0)
  ) {
    return null;
  }
  return {
    ruleId: row.id,
    shopId: row.shopId,
    actionType: row.actionType,
    requesterPermission: row.requesterPermission,
    requiresSecondPerson: row.requiresSecondPerson,
    requiresRequesterRepin: row.requiresRequesterRepin,
    expiresAfterSeconds: String(row.expiresAfterSeconds),
    thresholdKind: entry ? (entry[0] as ThresholdKind) : 'none',
    thresholdValue: entry ? String(entry[1]) : '',
    active: row.active,
    expectedVersion: row.editVersion,
  };
}

function buildWriteCommand(form: RuleForm) {
  const expiry = Number(form.expiresAfterSeconds);
  if (!Number.isSafeInteger(expiry) || expiry < 60 || expiry > 604800) {
    throw new Error('Expiry must be between 60 and 604800 seconds.');
  }
  let threshold:
    { kind: 'none' } | { kind: 'minimumMinor' | 'minimumQuantityImpact'; value: number } = {
    kind: 'none',
  };
  if (form.thresholdKind !== 'none') {
    const value = Number(form.thresholdValue);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('Threshold must be a positive whole number.');
    }
    threshold = { kind: form.thresholdKind, value };
  }
  return {
    type: 'rule.upsert' as const,
    ruleId: form.ruleId,
    shopId: form.shopId,
    actionType: form.actionType.trim(),
    requesterPermission: form.requesterPermission,
    approverPermission: 'approvals.review' as const,
    requiresSecondPerson: form.requiresSecondPerson,
    requiresRequesterRepin: form.requiresRequesterRepin,
    expiresAfterSeconds: expiry,
    threshold,
    active: form.active,
    expectedVersion: form.expectedVersion,
  };
}

function thresholdLabel(rule: ApprovalRule): string {
  const entries = Object.entries(rule.thresholdContext);
  if (entries.length === 0) return 'Every matching action';
  if (entries.length === 1) {
    if (entries[0]![0] === 'minimumMinor') {
      return `Amount ≥ ${(Number(entries[0]![1]) / 100).toFixed(2)} EGP`;
    }
    if (entries[0]![0] === 'minimumQuantityImpact') {
      return `Quantity impact ≥ ${entries[0]![1]}`;
    }
  }
  return 'Unsupported legacy threshold — editing disabled';
}

export function ApprovalRulesPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const principal =
    session.state.status === 'authenticated' ? session.state.session.principal : null;
  const mayManageBusiness = principal?.role === 'OWNER' || principal?.role === 'ADMIN';
  const authorizedShops = principal?.shopIds ?? [];
  const authorizedShopNames = new Map(
    (principal?.shopSummaries ?? [])
      .filter((shop) => authorizedShops.includes(shop.id))
      .map((shop) => [shop.id, shop.name]),
  );
  const shopLabel = (shopId: string | null) =>
    shopId === null
      ? 'Business-wide'
      : (authorizedShopNames.get(shopId) ??
        `Authorized shop ${authorizedShops.indexOf(shopId) + 1}`);
  const [form, setForm] = useState<RuleForm>(() =>
    initialForm(
      session.state.status === 'authenticated'
        ? (session.state.session.principal.shopIds[0] ?? null)
        : null,
    ),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const rulesQuery = useQuery({
    queryKey: ['admin', 'approval-rules'],
    queryFn: () => adminFetch<ApprovalRulesResponse>('/api/admin/approval-rules'),
  });
  const availableActions = rulesQuery.data?.availableActions ?? [];
  const selectedAction = availableActions.find((action) => action.actionType === form.actionType);
  const write = useMutation({
    mutationFn: async (draft: RuleForm) => {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const result = await adminFetch<{
        ok: boolean;
        ruleId?: string;
        editVersion?: number;
        code?: string;
        currentVersion?: number;
      }>(
        '/api/admin/approval-rules',
        { method: 'POST', body: JSON.stringify(buildWriteCommand(draft)) },
        session.state.session.csrfToken,
      );
      if (!result.ok) {
        throw new Error(
          result.code === 'stale_approval_rule_version'
            ? 'Rule was updated by someone else. Reload before editing.'
            : (result.code ?? 'approval_rule_save_failed'),
        );
      }
      return result;
    },
    onSuccess: async () => {
      setForm(initialForm(authorizedShops[0] ?? null));
      setEditing(false);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'approval-rules'] });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (form.shopId === null && !mayManageBusiness) {
      setFormError('Business-wide rules require Owner or Admin authority.');
      return;
    }
    try {
      const command = buildWriteCommand(form);
      if (!availableActions.some((action) => action.actionType === command.actionType)) {
        throw new Error('Select a supported high-risk action.');
      }
      write.mutate(form);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Invalid approval rule');
    }
  }

  return (
    <PageScaffold
      eyebrow="Controls"
      title="Approval rules"
      description="Manage the threshold and authorization rules evaluated for future high-risk actions. Existing approval decisions are preserved."
    >
      {rulesQuery.isLoading ? <LoadingState title="Loading approval rules" /> : null}
      {rulesQuery.isError ? <ErrorState title="Approval rules could not be loaded" /> : null}
      {rulesQuery.data?.rules.length === 0 ? (
        <EmptyState title="No approval rules configured" />
      ) : null}
      <div className="admin-record-stack">
        {rulesQuery.data?.rules.map((rule) => {
          const supportedAction = availableActions.find(
            (action) => action.actionType === rule.actionType,
          );
          const candidate = supportedAction ? editableRule(rule) : null;
          const ruleLabel = supportedAction
            ? thresholdLabel(rule)
            : 'Unsupported legacy action — editing disabled';
          const legacy = candidate === null;
          return (
            <div className="admin-record-row" key={rule.id}>
              <div>
                <strong>{supportedAction?.label ?? 'Legacy approval policy'}</strong>
                <span>
                  {shopLabel(rule.shopId)} · {rule.active ? 'Enabled' : 'Disabled'} · {ruleLabel}
                </span>
                {legacy ? (
                  <p className="admin-approval-rule__legacy">
                    <strong>Legacy / cannot edit.</strong> Ask an authorized administrator to create
                    a supported rule after reviewing the existing policy. This legacy rule remains
                    unchanged.
                  </p>
                ) : null}
                <details className="admin-approval-rule__technical">
                  <summary>Technical policy details</summary>
                  <code>{rule.actionType}</code> · Revision {rule.editVersion}
                </details>
              </div>
              <button
                type="button"
                className="admin-secondary-button"
                disabled={!candidate || write.isPending}
                onClick={() => {
                  if (!candidate) return;
                  setForm(candidate);
                  setEditing(true);
                  setFormError(null);
                }}
                aria-label={`Edit rule ${rule.actionType}`}
              >
                Edit
              </button>
            </div>
          );
        })}
      </div>

      <section className="admin-form-section admin-approval-rule-builder">
        <h2>{editing ? 'Edit approval rule' : 'Add approval rule'}</h2>
        <p className="admin-approval-rule-builder__intro">
          Set a supported action, choose an authorized scope and review the exact approval
          requirements before saving.
        </p>
        <form onSubmit={submit} className="admin-form-section admin-form-section--compact">
          <p className="admin-approval-rule-builder__connector">When</p>
          <label className="admin-field">
            <span>Scope</span>
            <select
              aria-label="Rule scope"
              value={form.shopId ?? 'business'}
              disabled={editing || write.isPending}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  shopId: event.target.value === 'business' ? null : event.target.value,
                }))
              }
            >
              {mayManageBusiness ? <option value="business">Business-wide</option> : null}
              {authorizedShops.map((id) => (
                <option key={id} value={id}>
                  {shopLabel(id)}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Action type</span>
            <select
              aria-label="Rule action type"
              value={form.actionType}
              disabled={editing || write.isPending || rulesQuery.isLoading}
              required
              onChange={(event) => {
                const action = availableActions.find(
                  (candidate) => candidate.actionType === event.currentTarget.value,
                );
                setForm((current) => ({
                  ...current,
                  actionType: action?.actionType ?? '',
                  requesterPermission: action?.requesterPermission ?? current.requesterPermission,
                  thresholdKind: 'none',
                  thresholdValue: '',
                }));
              }}
            >
              <option value="">Select a supported action</option>
              {availableActions.map((action) => (
                <option value={action.actionType} key={action.actionType}>
                  {action.label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-approval-rule-builder__authority">
            <strong>Authorization</strong>
            <p className="admin-field__help">
              Requester permission: {selectedAction?.requesterPermission ?? 'Select an action'}
            </p>
            <p className="admin-field__help">An authorized reviewer needs approvals.review.</p>
          </div>
          <p className="admin-field__help">
            The selected action determines the required requester permission, not the rule editor.
          </p>
          <p className="admin-field__help">Approver permission: approvals.review (fixed).</p>
          <label className="admin-field">
            <span>Expiry (seconds)</span>
            <input
              aria-label="Rule expiry"
              type="number"
              min={60}
              max={604800}
              step={1}
              value={form.expiresAfterSeconds}
              disabled={write.isPending}
              onChange={(event) =>
                setForm((current) => ({ ...current, expiresAfterSeconds: event.target.value }))
              }
            />
          </label>
          <label className="admin-field">
            <span>Threshold</span>
            <select
              aria-label="Rule threshold type"
              value={form.thresholdKind}
              disabled={write.isPending}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  thresholdKind: event.target.value as ThresholdKind,
                  thresholdValue: '',
                }))
              }
            >
              <option value="none">Every matching action</option>
              {selectedAction?.thresholdKind === 'minimumMinor' ? (
                <option value="minimumMinor">Minimum amount (minor EGP units)</option>
              ) : null}
              {selectedAction?.thresholdKind === 'minimumQuantityImpact' ? (
                <option value="minimumQuantityImpact">Minimum quantity impact</option>
              ) : null}
            </select>
          </label>
          {form.thresholdKind !== 'none' ? (
            <label className="admin-field">
              <span>Threshold value</span>
              <input
                aria-label="Rule threshold value"
                type="number"
                min={1}
                step={1}
                value={form.thresholdValue}
                disabled={write.isPending}
                required
                onChange={(event) =>
                  setForm((current) => ({ ...current, thresholdValue: event.target.value }))
                }
              />
            </label>
          ) : null}
          <label className="admin-approval-rule-builder__toggle">
            <input
              type="checkbox"
              checked={form.requiresSecondPerson}
              disabled={write.isPending}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  requiresSecondPerson: event.target.checked,
                }))
              }
            />
            <span>Require different approver</span>
          </label>
          <label className="admin-approval-rule-builder__toggle">
            <input
              type="checkbox"
              checked={form.requiresRequesterRepin}
              disabled={write.isPending}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  requiresRequesterRepin: event.target.checked,
                }))
              }
            />
            <span>Require requester re-PIN</span>
          </label>
          <label className="admin-approval-rule-builder__toggle">
            <input
              type="checkbox"
              checked={form.active}
              disabled={write.isPending}
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
              }
            />
            <span>Rule enabled</span>
          </label>
          <section className="admin-approval-rule-preview" aria-label="Rule preview">
            <h3>Rule preview</h3>
            <p>
              When {selectedAction?.label ?? 'a supported action'} is requested in{' '}
              <strong>{shopLabel(form.shopId)}</strong>, an authorized reviewer with
              approvals.review decides the request.
            </p>
            <p>
              {form.thresholdKind === 'none'
                ? 'Applies to every matching action.'
                : form.thresholdKind === 'minimumMinor'
                  ? `Applies from ${(Number(form.thresholdValue || 0) / 100).toFixed(2)} EGP.`
                  : `Applies at quantity impact ${form.thresholdValue || '—'} or above.`}{' '}
              Expires after {form.expiresAfterSeconds || '—'} seconds.
            </p>
            <p>
              {form.requiresSecondPerson
                ? 'Requires a different approver.'
                : 'Second-person requirement not selected.'}{' '}
              {form.requiresRequesterRepin
                ? 'Requester must re-enter PIN.'
                : 'Requester re-PIN not required by this rule.'}{' '}
              {form.active ? 'Enabled when saved.' : 'Disabled when saved.'}
            </p>
          </section>
          {formError ? <p role="alert">{formError}</p> : null}
          {write.isError ? (
            <p role="alert">
              {write.error instanceof Error ? write.error.message : 'Unable to save approval rule'}
            </p>
          ) : null}
          <button
            type="submit"
            className="admin-primary-button"
            disabled={write.isPending || !selectedAction}
          >
            {write.isPending ? 'Saving…' : editing ? 'Save approval rule' : 'Create approval rule'}
          </button>
          {editing ? (
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => {
                setEditing(false);
                setForm(initialForm(authorizedShops[0] ?? null));
              }}
            >
              Cancel edit
            </button>
          ) : null}
        </form>
      </section>
    </PageScaffold>
  );
}
