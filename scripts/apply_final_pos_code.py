from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
text = path.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'Expected OrdersWorkspace snippet not found: {old[:120]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "  const [selectedCategoryId, setSelectedCategoryId] = useState<MenuCategoryId | null>(null);\n  const [selectedProductFamily, setSelectedProductFamily] = useState<string | null>(null);\n",
    "  const [selectedCategoryId, setSelectedCategoryId] = useState<MenuCategoryId | null>(null);\n",
)

replace_once(
    "      setSelectedCategoryId((current) =>\n        current !== null && categories.some((category) => category.id === current)\n          ? current\n          : (categories[0]?.id ?? null),\n      );\n      setSelectedProductFamily(null);\n",
    "      setSelectedCategoryId((current) =>\n        current !== null && categories.some((category) => category.id === current) ? current : null,\n      );\n",
)

replace_once(
    "  const productFamilies = useMemo(() => {\n    if (configuration === null || selectedCategoryId === null) return [];\n    const seen = new Set<string>();\n    const families: string[] = [];\n    const categoryProducts = configuration.products\n      .filter((product) => product.active && product.categoryId === selectedCategoryId)\n      .slice()\n      .sort((left, right) => left.sortOrder - right.sortOrder);\n    for (const product of categoryProducts) {\n      const family = product.family?.trim();\n      if (!family || seen.has(family)) continue;\n      seen.add(family);\n      families.push(family);\n    }\n    return families;\n  }, [configuration, selectedCategoryId]);\n\n  useEffect(() => {\n    if (selectedProductFamily !== null && !productFamilies.includes(selectedProductFamily)) {\n      setSelectedProductFamily(null);\n    }\n  }, [productFamilies, selectedProductFamily]);\n\n",
    "",
)

replace_once(
    "  const products = useMemo(() => {\n    if (configuration === null) return [];\n    const active = configuration.products.filter((product) => product.active);\n    const query = search.trim().toLocaleLowerCase();\n    const filtered =\n      query.length > 0\n        ? active.filter((product) => product.name.toLocaleLowerCase().includes(query))\n        : active.filter(\n            (product) =>\n              product.categoryId === selectedCategoryId &&\n              (selectedProductFamily === null || product.family === selectedProductFamily),\n          );\n    return [...filtered].sort((left, right) => left.sortOrder - right.sortOrder);\n  }, [configuration, search, selectedCategoryId, selectedProductFamily]);\n",
    "  const products = useMemo(() => {\n    if (configuration === null) return [];\n    const active = configuration.products.filter((product) => product.active);\n    const query = search.trim().toLocaleLowerCase();\n    const filtered =\n      query.length > 0\n        ? active.filter((product) => product.name.toLocaleLowerCase().includes(query))\n        : selectedCategoryId === null\n          ? active\n          : active.filter((product) => product.categoryId === selectedCategoryId);\n    return [...filtered].sort((left, right) => left.sortOrder - right.sortOrder);\n  }, [configuration, search, selectedCategoryId]);\n",
)

replace_once(
    "                        setSelectedCategoryId(category.id);\n                        setSelectedProductFamily(null);\n                        setSearch('');\n",
    "                        setSelectedCategoryId(category.id);\n                        setSearch('');\n",
)

replace_once(
    "                        onChange={(event) => {\n                          const nextSearch = event.target.value;\n                          setSearch(nextSearch);\n                          if (nextSearch.trim().length > 0) setSelectedProductFamily(null);\n                        }}\n",
    "                        onChange={(event) => setSearch(event.target.value)}\n",
)

replace_once(
    "                  {activeCategories.map((category) => (\n",
    "                  <button\n                    type=\"button\"\n                    className={\n                      selectedCategoryId === null ? 'category-tab selected' : 'category-tab'\n                    }\n                    onClick={() => {\n                      setSelectedCategoryId(null);\n                      setSearch('');\n                    }}\n                  >\n                    All\n                  </button>\n                  {activeCategories.map((category) => (\n",
)

replace_once(
    "              {productFamilies.length > 1 ? (\n                <div className=\"segmented-control\" aria-label=\"Product families\">\n                  <button\n                    type=\"button\"\n                    className={selectedProductFamily === null ? 'selected' : undefined}\n                    onClick={() => setSelectedProductFamily(null)}\n                  >\n                    All\n                  </button>\n                  {productFamilies.map((family) => (\n                    <button\n                      type=\"button\"\n                      key={family}\n                      className={selectedProductFamily === family ? 'selected' : undefined}\n                      onClick={() => setSelectedProductFamily(family)}\n                    >\n                      {family}\n                    </button>\n                  ))}\n                </div>\n              ) : null}\n",
    "",
)

if 'selectedProductFamily' in text or 'productFamilies' in text:
    raise SystemExit('Product-family navigation references remain after patch')

path.write_text(text)
