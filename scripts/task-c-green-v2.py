from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


# The one-shot patch uses the same legacy modifier parser body for the public
# and admin contracts. Make the admin call temporarily text-distinct so the
# patch can target the public parser deterministically, then restore it after.
contract_path = Path("packages/catalog-contracts/src/index.ts")
contract = contract_path.read_text()
admin_marker = "function parseAdminModifier(value: unknown, path: string): AdminModifierInputV1 {"
admin_index = contract.index(admin_marker)
admin_prefix = contract[:admin_index]
admin_tail = contract[admin_index:]
admin_line = "  exactKeys(row, ['id', 'name', 'priceMinor', 'active', 'sortOrder'], path);"
admin_temp = """  exactKeys(
    row,
    ['id', 'name', 'priceMinor', 'active', 'sortOrder'],
    path,
  );"""
admin_tail = replace_once(admin_tail, admin_line, admin_temp, "admin modifier disambiguation")
contract_path.write_text(admin_prefix + admin_tail)

# Normalize the already-refined presentation-only Extras category projection to
# the exact legacy block expected by the one-shot correction. The correction
# removes this block entirely and replaces authorization with product links.
order_now_path = Path("apps/menu/src/pages/OrderNow.tsx")
order_now = order_now_path.read_text()
current_extras_block = """  const extraProducts = useMemo(
    () =>
      products
        .filter(
          (product) =>
            extrasSectionId !== null && product.section_id === extrasSectionId && product.is_active,
        )
        .sort((a, b) => a.sort_order - b.sort_order),
    [products, extrasSectionId],
  );
"""
legacy_extras_block = """  const extraProducts = useMemo(
    () =>
      extrasSectionId === null
        ? []
        : products.filter(
            (product) => product.section_id === extrasSectionId && product.is_active,
          ),
    [extrasSectionId, products],
  );
"""
order_now_path.write_text(
    replace_once(order_now, current_extras_block, legacy_extras_block, "OrderNow extras normalization")
)

source = Path("scripts/task-c-green.py").read_text()
exec(compile(source, "scripts/task-c-green.py", "exec"), {"__name__": "__main__"})

# Keep the admin parser itself unchanged in the committed correction.
updated_contract = contract_path.read_text()
contract_path.write_text(
    replace_once(updated_contract, admin_temp, admin_line, "admin modifier restoration")
)
