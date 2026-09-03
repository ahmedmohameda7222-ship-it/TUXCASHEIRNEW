from pathlib import Path

path = Path('apps/operations/src/app/App.tsx')
source = path.read_text()

replacements = [
    (
        "import { OrdersWorkspace } from './OrdersWorkspace';\n",
        "import { OrdersWorkspace } from './OrdersWorkspace';\nimport { WhatsAppWorkspace } from './WhatsAppWorkspace';\nimport {\n  createBrowserWhatsAppInboxEnvironment,\n  WhatsAppInboxController,\n} from './whatsappInboxController';\nimport { formatUnreadBadge } from './whatsappView';\n",
    ),
    (
        "  createOperationsOrdersClient,\n  createOperationsSessionClient,\n",
        "  createOperationsOrdersClient,\n  createOperationsSessionClient,\n  createOperationsWhatsAppClient,\n",
    ),
    (
        "type OperationsArea = 'ORDERS' | 'ORDERS_BOARD' | 'EXPENSES' | 'BULK_STOCK';",
        "type OperationsArea = 'ORDERS' | 'ORDERS_BOARD' | 'WHATSAPP' | 'EXPENSES' | 'BULK_STOCK';",
    ),
    (
        "  const preferencesClient = useMemo(() => createWorkerUiPreferencesClient(), []);\n",
        "  const preferencesClient = useMemo(() => createWorkerUiPreferencesClient(), []);\n  const whatsappController = useMemo(\n    () =>\n      new WhatsAppInboxController(\n        createOperationsWhatsAppClient(),\n        createBrowserWhatsAppInboxEnvironment(),\n      ),\n    [],\n  );\n  const [whatsappState, setWhatsAppState] = useState(() => whatsappController.getState());\n  const whatsappUnreadBadge = formatUnreadBadge(whatsappState.totalUnread);\n",
    ),
    (
        "  const [systemColorSaving, setSystemColorSaving] = useState(false);\n  const [systemColorSaveError, setSystemColorSaveError] = useState<string | null>(null);\n\n  useEffect(() => {\n    if (theme === 'system')",
        "  const [systemColorSaving, setSystemColorSaving] = useState(false);\n  const [systemColorSaveError, setSystemColorSaveError] = useState<string | null>(null);\n\n  useEffect(() => {\n    setWhatsAppState(whatsappController.getState());\n    const unsubscribe = whatsappController.subscribe(setWhatsAppState);\n    whatsappController.start();\n    return () => {\n      unsubscribe();\n      whatsappController.stop();\n    };\n  }, [whatsappController]);\n\n  useEffect(() => {\n    if (theme === 'system')",
    ),
    (
        "  function discardMenuChangesAndContinue(): void {\n    const action = pendingProtectedActionRef.current;\n    pendingProtectedActionRef.current = null;\n    menuLayoutExitController.discard();\n    setDiscardMenuChangesOpen(false);\n    action?.();\n  }\n\n  if (!accentHydrated) {",
        "  function discardMenuChangesAndContinue(): void {\n    const action = pendingProtectedActionRef.current;\n    pendingProtectedActionRef.current = null;\n    menuLayoutExitController.discard();\n    setDiscardMenuChangesOpen(false);\n    action?.();\n  }\n\n  useEffect(() => {\n    if (area === 'WHATSAPP') {\n      whatsappController.onAreaSelected();\n    }\n  }, [area, whatsappController]);\n\n  if (!accentHydrated) {",
    ),
    (
        "          <button\n            type=\"button\"\n            className={area === 'EXPENSES' ? 'nav-item nav-item-active' : 'nav-item'}",
        "          <button\n            type=\"button\"\n            className={area === 'WHATSAPP' ? 'nav-item nav-item-active' : 'nav-item'}\n            onClick={() =>\n              requestProtectedTransition(() => {\n                setArea('WHATSAPP');\n              })\n            }\n          >\n            WhatsApp\n            {whatsappUnreadBadge === null ? null : (\n              <span\n                className=\"nav-unread-badge\"\n                aria-label={`${whatsappState.totalUnread} unread WhatsApp messages`}\n              >\n                {whatsappUnreadBadge}\n              </span>\n            )}\n          </button>\n          <button\n            type=\"button\"\n            className={area === 'EXPENSES' ? 'nav-item nav-item-active' : 'nav-item'}",
    ),
    (
        "      ) : area === 'EXPENSES' ? (\n        <ExpensesWorkspace client={expensesClient} />\n      ) : (",
        "      ) : area === 'WHATSAPP' ? (\n        <WhatsAppWorkspace controller={whatsappController} state={whatsappState} />\n      ) : area === 'EXPENSES' ? (\n        <ExpensesWorkspace client={expensesClient} />\n      ) : (",
    ),
]

for before, after in replacements:
    occurrences = source.count(before)
    if occurrences != 1:
        raise SystemExit(f'Expected exactly one occurrence, found {occurrences}: {before[:80]!r}')
    source = source.replace(before, after, 1)

path.write_text(source)
