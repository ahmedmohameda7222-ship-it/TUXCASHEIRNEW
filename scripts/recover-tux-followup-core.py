from pathlib import Path
import re
R=Path.cwd()
def f(p): return (R/p).read_text()
def w(p,s): (R/p).write_text(s)
def sub(s,p,r,n):
 c=len(re.findall(p,s,re.S))
 if c!=1: raise SystemExit(f'{n}: expected 1 match, got {c}')
 return re.sub(p,r,s,count=1,flags=re.S)
def add(p,mark,block):
 s=f(p)
 if mark in s: raise SystemExit(f'duplicate marker in {p}')
 w(p,s.rstrip()+'\n\n'+block.strip()+'\n')

# App + icon
p='apps/operations/src/app/App.tsx'; s=f(p)
s=sub(s,r"import \{ SyncStatusIndicator \} from './SyncStatusIndicator';", "import { UserIcon } from './icons';\nimport { SyncStatusIndicator } from './SyncStatusIndicator';",'user import')
s=sub(s,r'\{session\.operator\.displayName\} <span aria-hidden="true">▾</span>', '<UserIcon className="operator-user-icon" />\n              <span>{session.operator.displayName}</span>\n              <span aria-hidden="true">▾</span>','operator markup'); w(p,s)
p='apps/operations/src/app/icons.tsx'; s=f(p)
if 'export function UserIcon(' in s: raise SystemExit('UserIcon already exists')
w(p,s.rstrip()+'''\n\nexport function UserIcon(props: IconProps) {\n  return (\n    <IconFrame {...props} data-icon="user">\n      <path d="M5 20V19C5 15.134 8.13401 12 12 12V12C15.866 12 19 15.134 19 19V20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />\n      <path d="M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />\n    </IconFrame>\n  );\n}\n''')
add('apps/operations/src/styles/brand.css','TUX follow-up: exact welcome logo','''/* TUX follow-up: exact welcome logo */\n.greeting-content .tux-brand { width: 96px; height: 96px; }''')

# Reset
p='apps/operations/src/app/sessionClient.ts'; s=f(p)
s=sub(s,r"categoryOrder: \[\], categoryAlignment: 'center'", "categoryOrder: [], categoryAlignment: 'left'",'reset alignment'); w(p,s)

# Orders cart
p='apps/operations/src/app/OrdersCart.tsx'; s=f(p)
s=sub(s,r"  const productsWithExtras = useMemo\(\(\) => \{.*?\n  \}, \[configuration\.modifiers, configuration\.productModifierLinks\]\);\n",'', 'extra gate set')
s=sub(s,r"\s*const supportsExtras = productsWithExtras\.has\(line\.productId\);",'', 'extra gate line')
A='''<div className="line-actions" aria-label={`${line.productName} actions`}>\n                      <div className="line-quantity-stepper" aria-label={`${line.productName} quantity`}>\n                        <button type="button" aria-label={`Decrease ${line.productName} quantity`} disabled={busy} onClick={() => onDecrementLine(line.id)}>−</button>\n                        <output aria-label={`${line.productName} quantity`}>{line.quantity}</output>\n                        <button type="button" aria-label={`Increase ${line.productName} quantity`} disabled={busy} onClick={() => onIncrementLine(line.id)}>+</button>\n                      </div>\n                      <button type="button" disabled={busy} onClick={() => onEditLine(line.id)}>Edit</button>\n                      <button type="button" className="line-extra-action" disabled={busy} onClick={() => onEditLineExtras(line.id)}>\n                        {line.modifiers.length > 0 ? <EditPencilIcon data-icon="edit-pencil" /> : <PlusCircleIcon data-icon="plus-circle" />}\n                        <span>Extra</span>\n                      </button>\n                    </div>'''
s=sub(s,r'<div className="line-actions" aria-label=\{`\$\{line\.productName\} actions`\}>.*?</div>\n\s*</article>',A+'\n                  </article>','line controls')
s=sub(s,r'\s*<MoneyInput\n\s*id=\{controlId\(\'delivery-fee\'\)\}.*?<p className="fee-reference">.*?</p>\n\s*\)\}', '', 'upper delivery fee')
# Cash editor before split button
m=re.search(r"(\s*\{methods\.length >= 2 \? \(.*?\) : null\}\n\n)(\s*\{draft\.payment\.mode === 'SINGLE' && pricing !== null \? \(.*?\) : null\}\n)",s,re.S)
if not m: raise SystemExit('payment reachability block not found')
s=s[:m.start()]+m.group(2)+'\n'+m.group(1).lstrip('\n')+s[m.end():]
D='''{delivery ? (\n            <div className="delivery-total-editor">\n              <MoneyInput id={controlId('delivery-fee')} label="Delivery" value={draft.delivery.finalFeeMinor} disabled={busy} compact onCommit={(finalFeeMinor) => onMutate((current) => ({ ...current, delivery: { ...current.delivery, finalFeeMinor } }))} />\n              {draft.delivery.zoneId === null || draft.delivery.configuredFeeMinor === draft.delivery.finalFeeMinor ? null : (\n                <span className="delivery-zone-reference">Zone reference: {formatMoneyMinor(draft.delivery.configuredFeeMinor)}</span>\n              )}\n            </div>\n          ) : null}'''
s=sub(s,r'\{!delivery \? null : \(\s*<div>\s*<dt>Delivery</dt>.*?</div>\s*\)\}',D,'delivery totals'); w(p,s)

# Expenses
p='apps/operations/src/app/ExpensesWorkspace.tsx'; s=f(p)
s=sub(s,r'function ExpenseFields\(\{\n  prefix,\n  values,\n  disabled,\n  onChange,\n\}: \{\n  readonly prefix: string;\n  readonly values: ExpenseFormValues;\n  readonly disabled: boolean;\n  readonly onChange: \(values: ExpenseFormValues\) => void;\n\}\)', '''function ExpenseFields({\n  prefix, values, disabled, onChange, noteExpanded = true, onToggleNote,\n}: {\n  readonly prefix: string; readonly values: ExpenseFormValues; readonly disabled: boolean;\n  readonly onChange: (values: ExpenseFormValues) => void; readonly noteExpanded?: boolean; readonly onToggleNote?: () => void;\n})''','expense fields signature')
NOTE='''</fieldset>\n      <p className="expense-paid-helper">{values.paidFrom === 'CASH' ? 'Cash reduces Expected Cash at End Day.' : 'Other does not reduce Expected Cash at End Day.'}</p>\n      {onToggleNote === undefined ? null : (\n        <button type="button" className="expense-note-disclosure" aria-expanded={noteExpanded} disabled={disabled} onClick={onToggleNote}>{values.note.trim().length > 0 ? 'Note added' : 'Add note'}</button>\n      )}\n      {noteExpanded ? (\n        <label className="expense-note-field" htmlFor={`${prefix}-note`}>Note <span>optional</span><textarea id={`${prefix}-note`} value={values.note} disabled={disabled} maxLength={500} rows={2} onChange={(event) => onChange({ ...values, note: event.target.value })} /></label>\n      ) : null}'''
s=sub(s,r'</fieldset>\n\s*<label className="expense-note-field".*?</label>',NOTE,'expense helper/note')
s=sub(s,r"const \[form, setForm\] = useState<ExpenseFormValues>\(EMPTY_FORM\);", "const [form, setForm] = useState<ExpenseFormValues>(EMPTY_FORM);\n  const [noteExpanded, setNoteExpanded] = useState(false);",'note state')
s=sub(s,r'setForm\(EMPTY_FORM\);\n\s*setCreateCommandId', 'setForm(EMPTY_FORM);\n    setNoteExpanded(false);\n    setCreateCommandId','note reset')
s=sub(s,r'<div className="expense-add-heading">.*?</div>\n\s*<ExpenseFields prefix="add-expense" values=\{form\} disabled=\{busy\} onChange=\{setForm\} />', '<div className="expense-add-heading"><h2>Add Expense</h2></div>\n        <ExpenseFields prefix="add-expense" values={form} disabled={busy} onChange={setForm} noteExpanded={noteExpanded} onToggleNote={() => setNoteExpanded((value) => !value)} />','add expense heading')
LED='''<div className="expense-ledger-heading"><h2 id="expense-ledger-title">Current ledger</h2><span>{expenses.length} entries · Newest first</span></div>\n        {expenses.length === 0 ? (\n          <div className="expense-empty"><strong>No expenses this business day</strong></div>\n        ) : (\n          <>\n            <div className="expense-ledger-columns" aria-hidden="true"><span>Time</span><span>Expense</span><span>Amount</span><span>Actions</span></div>\n            <div className="expense-list">\n              {expenses.map((expense) => expense.kind === 'MANUAL' ? (\n                <ManualExpenseRow key={expense.id} expense={expense} onEdit={(target) => { setDialogError(null); setEditTarget(target); }} onDelete={(target) => { setDialogError(null); setDeleteTarget(target); }} />\n              ) : (<DeliveryFailedRow key={expense.id} expense={expense} />))}\n            </div>\n          </>\n        )}'''
s=sub(s,r'<div className="expense-ledger-heading">.*?\{expenses\.length === 0 \? \(.*?\n\s*\)\}\n\s*</section>',LED+'\n      </section>','ledger'); w(p,s)

print('core follow-up patch applied')
