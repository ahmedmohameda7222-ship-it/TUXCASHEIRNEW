from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
text = path.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)


replace_once(
    '''  return reconciled;\n}\n\ninterface UndoState {''',
    '''  return reconciled;\n}\n\nexport function productFamiliesForCategory(\n  products: readonly Product[],\n  categoryId: MenuCategoryId | null,\n): readonly string[] {\n  if (categoryId === null) return [];\n\n  const seen = new Set<string>();\n  const families: string[] = [];\n  const categoryProducts = products\n    .filter((product) => product.active && product.categoryId === categoryId)\n    .slice()\n    .sort((left, right) => left.sortOrder - right.sortOrder);\n\n  for (const product of categoryProducts) {\n    const family = product.family?.trim();\n    if (!family || seen.has(family)) continue;\n    seen.add(family);\n    families.push(family);\n  }\n\n  return families;\n}\n\nexport function filterProductsForMenu(\n  products: readonly Product[],\n  options: {\n    readonly selectedCategoryId: MenuCategoryId | null;\n    readonly selectedFamily: string | null;\n    readonly search: string;\n  },\n): readonly Product[] {\n  const active = products.filter((product) => product.active);\n  const query = options.search.trim().toLocaleLowerCase();\n\n  if (query.length > 0) {\n    return active\n      .filter((product) => product.name.toLocaleLowerCase().includes(query))\n      .slice()\n      .sort((left, right) => left.sortOrder - right.sortOrder);\n  }\n\n  if (options.selectedCategoryId === null) return [];\n\n  return active\n    .filter((product) => product.categoryId === options.selectedCategoryId)\n    .filter((product) => options.selectedFamily === null || product.family === options.selectedFamily)\n    .slice()\n    .sort((left, right) => left.sortOrder - right.sortOrder);\n}\n\ninterface UndoState {''',
)

replace_once(
    '''  const [selectedCategoryId, setSelectedCategoryId] = useState<MenuCategoryId | null>(null);\n  const [search, setSearch] = useState('');''',
    '''  const [selectedCategoryId, setSelectedCategoryId] = useState<MenuCategoryId | null>(null);\n  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);\n  const [search, setSearch] = useState('');''',
)

replace_once(
    '''      setSelectedCategoryId((current) =>\n        current !== null && categories.some((category) => category.id === current) ? current : null,\n      );''',
    '''      const defaultCategoryId = categories[0]?.id ?? null;\n      setSelectedCategoryId((current) =>\n        current !== null && categories.some((category) => category.id === current)\n          ? current\n          : defaultCategoryId,\n      );\n      setSelectedFamily(null);''',
)

replace_once(
    '''  }, [categoryEditOrder, configuredActiveCategories]);\n  const products = useMemo(() => {\n    if (configuration === null) return [];\n    const active = configuration.products.filter((product) => product.active);\n    const query = search.trim().toLocaleLowerCase();\n    const filtered =\n      query.length > 0\n        ? active.filter((product) => product.name.toLocaleLowerCase().includes(query))\n        : selectedCategoryId === null\n          ? active\n          : active.filter((product) => product.categoryId === selectedCategoryId);\n    return [...filtered].sort((left, right) => left.sortOrder - right.sortOrder);\n  }, [configuration, search, selectedCategoryId]);''',
    '''  }, [categoryEditOrder, configuredActiveCategories]);\n  const activeFamilies = useMemo(\n    () => productFamiliesForCategory(configuration?.products ?? [], selectedCategoryId),\n    [configuration, selectedCategoryId],\n  );\n\n  useEffect(() => {\n    if (selectedFamily !== null && !activeFamilies.includes(selectedFamily)) {\n      setSelectedFamily(null);\n    }\n  }, [activeFamilies, selectedFamily]);\n\n  const products = useMemo(\n    () =>\n      filterProductsForMenu(configuration?.products ?? [], {\n        selectedCategoryId,\n        selectedFamily,\n        search,\n      }),\n    [configuration, search, selectedCategoryId, selectedFamily],\n  );''',
)

replace_once(
    '''                  <button\n                    type="button"\n                    className={\n                      selectedCategoryId === null ? 'category-tab selected' : 'category-tab'\n                    }\n                    onClick={() => {\n                      setSelectedCategoryId(null);\n                      setSearch('');\n                    }}\n                  >\n                    All\n                  </button>\n''',
    '',
)

replace_once(
    '''                      onClick={() => {\n                        setSelectedCategoryId(category.id);\n                        setSearch('');\n                      }}''',
    '''                      onClick={() => {\n                        setSelectedCategoryId(category.id);\n                        setSelectedFamily(null);\n                        setSearch('');\n                      }}''',
)

replace_once(
    '''                </div>\n              </div>\n            </div>\n          )}\n        </div>\n\n        <div className="product-grid" aria-live="polite">''',
    '''                </div>\n              </div>\n              {activeFamilies.length > 0 ? (\n                <div className="segmented-control product-family-filter" aria-label="Product families">\n                  <button\n                    type="button"\n                    className={selectedFamily === null ? 'selected' : undefined}\n                    onClick={() => setSelectedFamily(null)}\n                  >\n                    All\n                  </button>\n                  {activeFamilies.map((family) => (\n                    <button\n                      type="button"\n                      key={family}\n                      className={selectedFamily === family ? 'selected' : undefined}\n                      onClick={() => setSelectedFamily(family)}\n                    >\n                      {family}\n                    </button>\n                  ))}\n                </div>\n              ) : null}\n            </div>\n          )}\n        </div>\n\n        <div className="product-grid" aria-live="polite">''',
)

path.write_text(text)
