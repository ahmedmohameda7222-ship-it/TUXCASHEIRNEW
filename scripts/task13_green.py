from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    target = Path(path)
    text = target.read_text()
    if after in text:
        return
    if before not in text:
        raise SystemExit(f"Expected source block not found in {path}: {before[:80]!r}")
    target.write_text(text.replace(before, after, 1))


workspace = "apps/operations/src/app/OrdersWorkspace.tsx"
styles = "apps/operations/src/styles/orders.css"

replace_once(
    workspace,
    "import { useEffect, useMemo, useRef, useState } from 'react';\nimport { EditPencilIcon, SearchIcon } from './icons';",
    "import { useEffect, useMemo, useRef, useState } from 'react';\nimport {\n  CART_WIDTH_MAX_PX,\n  CART_WIDTH_MIN,\n  clampCartWidth,\n  readCartWidth,\n  writeCartWidth,\n} from './cartWidthPreference';\nimport { EditPencilIcon, SearchIcon } from './icons';",
)

replace_once(
    workspace,
    "type ActiveSession = Extract<OperationsSessionState, { status: 'ACTIVE' }>;\n",
    "type ActiveSession = Extract<OperationsSessionState, { status: 'ACTIVE' }>;\n\nconst DESKTOP_CART_RESIZE_QUERY = '(min-width: 54.0625rem)';\nconst CART_RESIZE_KEYBOARD_STEP = 16;\n\nfunction desktopCartResizeMatches(): boolean {\n  return (\n    typeof window !== 'undefined' && window.matchMedia(DESKTOP_CART_RESIZE_QUERY).matches\n  );\n}\n",
)

replace_once(
    workspace,
    "  const undoTimerRef = useRef<number | null>(null);\n",
    "  const undoTimerRef = useRef<number | null>(null);\n  const cartResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);\n",
)

replace_once(
    workspace,
    "  const [mobileCartOpen, setMobileCartOpen] = useState(false);\n\n  function setCurrentDraft(next: OrderDraft): void {",
    "  const [mobileCartOpen, setMobileCartOpen] = useState(false);\n  const [desktopCartResizable, setDesktopCartResizable] = useState(desktopCartResizeMatches);\n  const [cartWidth, setCartWidth] = useState(() =>\n    typeof window === 'undefined'\n      ? CART_WIDTH_MIN\n      : readCartWidth(window.localStorage, window.innerWidth),\n  );\n\n  function commitCartWidth(nextWidth: number): void {\n    const next = clampCartWidth(nextWidth, window.innerWidth);\n    setCartWidth(next);\n    writeCartWidth(window.localStorage, next);\n  }\n\n  function setCurrentDraft(next: OrderDraft): void {",
)

replace_once(
    workspace,
    "  useEffect(\n    () => () => {\n      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);\n    },\n    [],\n  );\n\n  function beginPendingSave(): void {",
    "  useEffect(\n    () => () => {\n      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);\n    },\n    [],\n  );\n\n  useEffect(() => {\n    const media = window.matchMedia(DESKTOP_CART_RESIZE_QUERY);\n    const sync = () => setDesktopCartResizable(media.matches);\n    sync();\n    media.addEventListener('change', sync);\n    return () => media.removeEventListener('change', sync);\n  }, []);\n\n  useEffect(() => {\n    function clampToViewport(): void {\n      if (!desktopCartResizeMatches()) return;\n      setCartWidth((current) => {\n        const next = clampCartWidth(current, window.innerWidth);\n        if (next !== current) writeCartWidth(window.localStorage, next);\n        return next;\n      });\n    }\n\n    clampToViewport();\n    window.addEventListener('resize', clampToViewport);\n    return () => window.removeEventListener('resize', clampToViewport);\n  }, []);\n\n  function beginPendingSave(): void {",
)

replace_once(
    workspace,
    "  return (\n    <main className=\"orders-workspace\">",
    "  return (\n    <main\n      className=\"orders-workspace\"\n      style={\n        desktopCartResizable\n          ? { gridTemplateColumns: `minmax(0, 1fr) 0.5rem ${cartWidth}px` }\n          : undefined\n      }\n    >",
)

separator = """      {desktopCartResizable ? (\n        <div\n          className=\"cart-resize-separator\"\n          role=\"separator\"\n          aria-label=\"Resize Current Order\"\n          aria-orientation=\"vertical\"\n          aria-valuemin={CART_WIDTH_MIN}\n          aria-valuemax={Math.floor(Math.min(CART_WIDTH_MAX_PX, window.innerWidth * 0.45))}\n          aria-valuenow={Math.round(cartWidth)}\n          tabIndex={0}\n          onKeyDown={(event) => {\n            if (event.key === 'ArrowLeft') {\n              event.preventDefault();\n              commitCartWidth(cartWidth + CART_RESIZE_KEYBOARD_STEP);\n            } else if (event.key === 'ArrowRight') {\n              event.preventDefault();\n              commitCartWidth(cartWidth - CART_RESIZE_KEYBOARD_STEP);\n            } else if (event.key === 'Home') {\n              event.preventDefault();\n              commitCartWidth(CART_WIDTH_MIN);\n            } else if (event.key === 'End') {\n              event.preventDefault();\n              commitCartWidth(CART_WIDTH_MAX_PX);\n            }\n          }}\n          onPointerDown={(event) => {\n            cartResizeRef.current = { startX: event.clientX, startWidth: cartWidth };\n            event.currentTarget.setPointerCapture(event.pointerId);\n          }}\n          onPointerMove={(event) => {\n            const drag = cartResizeRef.current;\n            if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;\n            commitCartWidth(drag.startWidth + drag.startX - event.clientX);\n          }}\n          onPointerUp={(event) => {\n            if (event.currentTarget.hasPointerCapture(event.pointerId)) {\n              event.currentTarget.releasePointerCapture(event.pointerId);\n            }\n            cartResizeRef.current = null;\n          }}\n          onPointerCancel={(event) => {\n            if (event.currentTarget.hasPointerCapture(event.pointerId)) {\n              event.currentTarget.releasePointerCapture(event.pointerId);\n            }\n            cartResizeRef.current = null;\n          }}\n        />\n      ) : null}\n\n"""

replace_once(
    workspace,
    "      <div className=\"desktop-cart-wrap\">\n        <OrdersCart",
    separator + "      <div className=\"desktop-cart-wrap\">\n        <OrdersCart",
)

workspace_block = """.orders-workspace {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) minmax(23.75rem, 26rem);\n  height: calc(100vh - 4rem);\n  min-height: 36rem;\n  overflow: hidden;\n  background: var(--tux-surface-canvas);\n}\n"""
separator_styles = workspace_block + """\n.cart-resize-separator {\n  position: relative;\n  min-width: 0.5rem;\n  min-height: 0;\n  align-self: stretch;\n  cursor: col-resize;\n  touch-action: none;\n  outline: none;\n}\n\n.cart-resize-separator::before {\n  content: '';\n  position: absolute;\n  top: 0;\n  bottom: 0;\n  left: 50%;\n  width: 1px;\n  transform: translateX(-50%);\n  background: var(--tux-border-subtle);\n}\n\n.cart-resize-separator:hover::before,\n.cart-resize-separator:focus-visible::before {\n  width: 2px;\n  background: var(--tux-accent-strong);\n}\n"""
replace_once(styles, workspace_block, separator_styles)
