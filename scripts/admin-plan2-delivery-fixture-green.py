from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old!r}")
    file.write_text(text.replace(old, new, 1))


online = "packages/application/src/onlineOrderAcceptance.sqlite.test.ts"
replace_once(online, "    finalDeliveryFeeMinor: moneyMinor(2_500),", "    finalDeliveryFeeMinor: moneyMinor(3_000),")
replace_once(
    online,
    "    expect(result.value.order.deliveryFeeMinor).toBe(moneyMinor(2_500));",
    "    expect(result.value.order.deliveryFeeMinor).toBe(moneyMinor(3_000));",
)
replace_once(
    online,
    "    expect(result.value.order.totalMinor).toBe(moneyMinor(21_500));",
    "    expect(result.value.order.totalMinor).toBe(moneyMinor(22_000));",
)

desktop = "apps/operations-desktop/src/main/orders.integration.test.ts"
replace_once(desktop, "        finalFeeMinor: moneyMinor(2_500),", "        finalFeeMinor: moneyMinor(3_000),")
replace_once(
    desktop,
    "    expect(result.value.order.fulfillment.delivery.finalFeeMinor).toBe(moneyMinor(2_500));",
    "    expect(result.value.order.fulfillment.delivery.finalFeeMinor).toBe(moneyMinor(3_000));",
)
replace_once(
    desktop,
    "    expect(result.value.order.totalMinor).toBe(moneyMinor(18_500));",
    "    expect(result.value.order.totalMinor).toBe(moneyMinor(19_000));",
)
