from pathlib import Path

path = Path('scripts/tmp_plan2_green_patch.py')
text = path.read_text()
start_marker = '# Expose published REFUND_RETURN authority in rendered Orders Board UI.'
end_marker = '# Update source regression to assert rollout-compatible immutable phone field.'
start = text.index(start_marker)
end = text.index(end_marker)
replacement = r'''# Expose published REFUND_RETURN authority in rendered Orders Board UI.
path = "apps/operations/src/app/OrdersBoardWorkspace.tsx"
regex_once(
    path,
    r"(type CancellationSubmission = \{.*?\n\};)(\n\nconst TABS)",
    "\\1\n" + """type ReturnSubmission = {
  readonly reason: string;
  readonly reasonCodeId?: string;
  readonly note?: string;
};
""" + "\\2",
)
regex_once(
    path,
    r"function ReturnDialog\(\{.*?\n\}\n\nexport function OrdersBoardWorkspace",
    """function ReturnDialog({
  order,
  busy,
  reasonMode,
  reasons,
  onClose,
  onConfirm,
}: {
  readonly order: OrderSnapshot;
  readonly busy: boolean;
  readonly reasonMode: CancellationReasonMode;
  readonly reasons: readonly CancellationReasonOption[];
  readonly onClose: () => void;
  readonly onConfirm: (submission: ReturnSubmission) => Promise<void>;
}) {
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [legacyReason, setLegacyReason] = useState('');
  const [note, setNote] = useState('');
  const selectedReason = reasons.find((reason) => reason.id === selectedReasonId);
  const configured = reasonMode === 'CONFIGURED';
  const validReason = configured ? selectedReason !== undefined : legacyReason.trim().length > 0;
  return (
    <div className="modal-backdrop">
      <section
        className="board-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-order-title"
      >
        <header>
          <div>
            <p className="eyebrow">Delivery Failed</p>
            <h2 id="return-order-title">Order #{order.displayOrderNo}</h2>
          </div>
          <button className="board-quiet-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p>
          This records no collected payment, no recognized revenue, no inventory restoration,
          and creates the locked Delivery Failed expense event.
        </p>
        {configured ? (
          <>
            <label>
              Reason
              <select
                value={selectedReasonId}
                onChange={(event) => setSelectedReasonId(event.target.value)}
              >
                <option value="">Select a published refund/return reason</option>
                {reasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            {reasons.length === 0 ? (
              <p className="board-inline-error" role="alert">
                No active refund/return reasons are published. Delivery Failed is locked until Admin
                publishes one.
              </p>
            ) : null}
            <label>
              Note (optional)
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={240}
              />
            </label>
          </>
        ) : (
          <label>
            Reason
            <textarea
              value={legacyReason}
              onChange={(event) => setLegacyReason(event.target.value)}
              maxLength={240}
            />
          </label>
        )}
        <button
          className="board-danger-button"
          type="button"
          disabled={busy || !validReason}
          onClick={() => {
            if (configured) {
              if (selectedReason === undefined) return;
              void onConfirm({
                reason: selectedReason.label,
                reasonCodeId: selectedReason.id,
                ...(note.trim().length > 0 ? { note: note.trim() } : {}),
              });
              return;
            }
            void onConfirm({ reason: legacyReason.trim() });
          }}
        >
          Confirm Delivery Failed
        </button>
      </section>
    </div>
  );
}

export function OrdersBoardWorkspace""",
)
regex_once(
    path,
    r"(const \[cancellationReasons, setCancellationReasons\] = useState<\s*readonly CancellationReasonOption\[\]\s*>\(\[\]\);)(\s*const \[tab, setTab\])",
    "\\1\n  const [returnReasonMode, setReturnReasonMode] =\n    useState<CancellationReasonMode>('LEGACY_FREE_TEXT');\n  const [returnReasons, setReturnReasons] = useState<readonly CancellationReasonOption[]>([]);\n  \\2",
)
regex_once(
    path,
    r"(setCancellationReasonMode\(result\.value\.cancellationReasonMode\);\s*setCancellationReasons\(result\.value\.cancellationReasons\);)(\s*setError\(null\);)",
    "\\1\n    setReturnReasonMode(result.value.returnReasonMode);\n    setReturnReasons(result.value.returnReasons);\\2",
)
replace_once(
    path,
    """        <ReturnDialog
          order={returnTarget}
          busy={busy}
""",
    """        <ReturnDialog
          order={returnTarget}
          busy={busy}
          reasonMode={returnReasonMode}
          reasons={returnReasons}
""",
)
replace_once(
    path,
    """          onConfirm={async (reason) => {
""",
    """          onConfirm={async (submission) => {
""",
)
replace_once(
    path,
    """              () => client.returnDelivery({ orderId: returnTarget.id, reason }),
""",
    """              () => client.returnDelivery({ orderId: returnTarget.id, ...submission }),
""",
)

'''
path.write_text(text[:start] + replacement + text[end:])
print('Orders Board patch section hardened.')
