from pathlib import Path

path = Path('scripts/tmp_plan2_green_patch.py')
text = path.read_text()

start = text.index('replace_once(\n    path,\n    """  const [cancellationReasons, setCancellationReasons]')
end = text.index('\n\n# Update source regression to assert rollout-compatible immutable phone field.', start)
replacement = r'''regex_once(
    path,
    r"(const \[cancellationReasons, setCancellationReasons\] = useState<\s*readonly CancellationReasonOption\[\]\s*>\(\[\]\);)(\s*const \[tab, setTab\] = useState<BoardTab>\('ACTIVE'\);)",
    """\\1
  const [returnReasonMode, setReturnReasonMode] =
    useState<CancellationReasonMode>('LEGACY_FREE_TEXT');
  const [returnReasons, setReturnReasons] = useState<readonly CancellationReasonOption[]>([]);\\2""",
)
regex_once(
    path,
    r"(setCancellationReasonMode\(result\.value\.cancellationReasonMode\);\s*setCancellationReasons\(result\.value\.cancellationReasons\);)(\s*setError\(null\);)",
    """\\1
    setReturnReasonMode(result.value.returnReasonMode);
    setReturnReasons(result.value.returnReasons);\\2""",
)
regex_once(
    path,
    r"<ReturnDialog\s+order=\{returnTarget\}\s+busy=\{busy\}\s+onClose=\{\(\) => setReturnTarget\(null\)\}\s+onConfirm=\{async \(reason\) => \{\s+const changed = await mutate\(\s+\(\) => client\.returnDelivery\(\{ orderId: returnTarget\.id, reason \}\),\s+`Order #\$\{returnTarget\.displayOrderNo\} marked Delivery Failed\.`,\s+\);",
    """<ReturnDialog
        order={returnTarget}
        busy={busy}
        reasonMode={returnReasonMode}
        reasons={returnReasons}
        onClose={() => setReturnTarget(null)}
        onConfirm={async (submission) => {
          const changed = await mutate(
            () => client.returnDelivery({ orderId: returnTarget.id, ...submission }),
            `Order #${returnTarget.displayOrderNo} marked Delivery Failed.`,
          );""",
)'''
path.write_text(text[:start] + replacement + text[end:])
