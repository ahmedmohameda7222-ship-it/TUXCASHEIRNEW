from pathlib import Path

path = Path('packages/sync/src/remoteMaterializer.test.ts')
text = path.read_text()
old = """      payments: order.payments.map((payment) => ({
        ...payment,
        allocatedMinor: moneyMinor(11_970),
        receivedMinor: moneyMinor(11_970),
        changeMinor: moneyMinor(0),
      })),"""
new = """      payments: [
        {
          id: parseEntityId<PaymentId>('99999999-9999-4999-8999-999999999999'),
          method: {
            id: parseEntityId<PaymentMethodId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
            label: 'Cash',
            logicType: 'CASH',
          },
          allocatedMinor: moneyMinor(11_970),
          receivedMinor: moneyMinor(11_970),
          changeMinor: moneyMinor(0),
        },
      ],"""
if text.count(old) != 1:
    raise SystemExit(f'remote materializer charged-payment test drift: {text.count(old)}')
path.write_text(text.replace(old, new, 1))
