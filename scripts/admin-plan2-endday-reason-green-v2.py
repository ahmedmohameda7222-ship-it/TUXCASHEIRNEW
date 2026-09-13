from pathlib import Path

helper = Path('scripts/admin-plan2-endday-reason-green.py')
source = helper.read_text()

old = '''replace(
    'packages/application/src/endDay.ts',
    """        differenceMinor: line.differenceMinor,
        varianceReason: line.varianceReason,
      })),
""",
    """        differenceMinor: line.differenceMinor,
        varianceReason: line.varianceReason,
        ...(line.varianceReasonCode === undefined
          ? {}
          : { varianceReasonCode: line.varianceReasonCode }),
      })),
""",
)
'''

new = '''replace(
    'packages/application/src/endDay.ts',
    """      lines: preview.lines.map((line): ReconciliationLine => ({
        paymentMethod: {
          id: line.paymentMethod.id,
          label: line.paymentMethod.label,
          logicType: line.paymentMethod.logicType,
        },
        expectedMinor: line.expectedMinor,
        actualMinor: line.actualMinor,
        differenceMinor: line.differenceMinor,
        varianceReason: line.varianceReason,
      })),
""",
    """      lines: preview.lines.map((line): ReconciliationLine => ({
        paymentMethod: {
          id: line.paymentMethod.id,
          label: line.paymentMethod.label,
          logicType: line.paymentMethod.logicType,
        },
        expectedMinor: line.expectedMinor,
        actualMinor: line.actualMinor,
        differenceMinor: line.differenceMinor,
        varianceReason: line.varianceReason,
        ...(line.varianceReasonCode === undefined
          ? {}
          : { varianceReasonCode: line.varianceReasonCode }),
      })),
""",
)
'''

if source.count(old) != 1:
    raise SystemExit(f'End Day GREEN wrapper expected one ambiguous helper block, found {source.count(old)}')

fixed = source.replace(old, new, 1)
exec(compile(fixed, str(helper), 'exec'), {'__name__': '__main__'})
