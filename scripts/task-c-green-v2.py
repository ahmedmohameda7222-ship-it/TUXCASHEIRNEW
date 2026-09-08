from pathlib import Path

source_path = Path('scripts/task-c-green.py')
source = source_path.read_text()
old = '''replace_once(
    "packages/catalog-contracts/src/index.ts",
    """  exactKeys(row, ['id', 'name', 'priceMinor', 'active', 'sortOrder'], path);\n  return {\n    id: requiredUuid(row.id, `${path}.id`),\n    name: requiredText(row.name, `${path}.name`, 200),\n    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),\n    active: requiredBoolean(row.active, `${path}.active`),\n    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),\n  };""",
    """  exactKeys(\n    row,\n    ['id', 'name', 'priceMinor', 'standaloneProductId', 'active', 'sortOrder'],\n    path,\n  );\n  return {\n    id: requiredUuid(row.id, `${path}.id`),\n    name: requiredText(row.name, `${path}.name`, 200),\n    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),\n    standaloneProductId: nullableUuid(row.standaloneProductId, `${path}.standaloneProductId`),\n    active: requiredBoolean(row.active, `${path}.active`),\n    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),\n  };""",
)
'''
new = '''replace_once(
    "packages/catalog-contracts/src/index.ts",
    """function parseModifier(value: unknown, path: string): PublicCatalogModifierV1 {\n  const row = asObject(value, path);\n  exactKeys(row, ['id', 'name', 'priceMinor', 'active', 'sortOrder'], path);\n  return {\n    id: requiredUuid(row.id, `${path}.id`),\n    name: requiredText(row.name, `${path}.name`, 200),\n    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),\n    active: requiredBoolean(row.active, `${path}.active`),\n    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),\n  };\n}""",
    """function parseModifier(value: unknown, path: string): PublicCatalogModifierV1 {\n  const row = asObject(value, path);\n  exactKeys(\n    row,\n    ['id', 'name', 'priceMinor', 'standaloneProductId', 'active', 'sortOrder'],\n    path,\n  );\n  return {\n    id: requiredUuid(row.id, `${path}.id`),\n    name: requiredText(row.name, `${path}.name`, 200),\n    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),\n    standaloneProductId: nullableUuid(row.standaloneProductId, `${path}.standaloneProductId`),\n    active: requiredBoolean(row.active, `${path}.active`),\n    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),\n  };\n}""",
)
'''
if old not in source:
    raise SystemExit('v2 parseModifier source anchor missing')
patched = source.replace(old, new, 1)
exec(compile(patched, 'scripts/task-c-green.py', 'exec'), {'__name__': '__main__'})
