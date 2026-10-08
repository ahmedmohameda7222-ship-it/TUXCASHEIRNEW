import { Link } from 'wouter';
import { useState } from 'react';

import { EmptyState, ErrorState, InlineError, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from '../shops/ShopScopeProvider';
import { formatEgp, parseEgpMinor } from './money';
import { useFinance } from './useFinance';
import { useFinanceOperations } from './useFinanceOperations';

function cairoToday():string {
  const parts=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',
    day:'2-digit',timeZone:'Africa/Cairo'}).formatToParts(new Date());
  const field=(type:string)=>parts.find(p=>p.type===type)?.value??'';
  return `${field('year')}-${field('month')}-${field('day')}`;
}

export function ExpensesPage() {
  const {scope,principal}=useShopScope();
  const shopId=scope.kind==='shop'?scope.shopId:undefined;
  const [open,setOpen]=useState(false);
  const [dayId,setDayId]=useState('');
  const [amount,setAmount]=useState('');
  const [description,setDescription]=useState('');
  const [reason,setReason]=useState('');
  const [expenseDate,setExpenseDate]=useState(cairoToday());
  const [accountId,setAccountId]=useState('unpaid');
  const [categoryId,setCategoryId]=useState('uncategorized');
  const [receipt,setReceipt]=useState('');
  const [validation,setValidation]=useState<string|null>(null);
  const finance=useFinance(shopId,null);
  const operations=useFinanceOperations(shopId,undefined);
  const days=operations.daysQuery.data?.days??[];
  const availableDays=days.filter((day)=>day.status==='OPEN');
  const accounts=finance.workspaceQuery.data?.accounts.filter((account)=>account.active)??[];
  const categories=operations.categoriesQuery.data?.categories??[];
  const canPost=principal.permissions.includes('finance.adjust');

  function submit() {
    if (!shopId) return;
    try {
      const amountMinor=parseEgpMinor(amount);
      if (amountMinor<=0) throw new Error('Enter a positive amount.');
      if (!availableDays.some((day)=>day.id===dayId)) {
        throw new Error('Choose an open Operations Business Day.');
      }
      if (!description.trim()||!reason.trim()) {
        throw new Error('Description and reason are required.');
      }
      operations.command.mutate({draft:{
        type:'finance.expense.post',shopId,businessDayId:dayId,
        amountMinor,description:description.trim(),reason:reason.trim(),
        accountId:accountId==='unpaid'?null:accountId,
        categoryId:categoryId==='uncategorized'?null:categoryId,
        receiptReference:receipt.trim()||null,expenseDate,
      }},{
        onSuccess:()=>{
          setOpen(false);setAmount('');setDescription('');setReason('');
          setReceipt('');setValidation(null);
        },
      });
    } catch(err) {
      setValidation(err instanceof Error?err.message:'Invalid expense');
    }
  }
  if (!shopId) return <PageScaffold eyebrow="Finance" title="Expenses"
    description="Choose a shop before recording expenses." />;

  return <PageScaffold eyebrow="Finance" title="Expenses"
    description="Record business expenses against the canonical ledger. Staff payments remain separate source events."
    primaryAction={canPost?<button type="button" className="admin-primary-button"
      onClick={()=>{setDayId(availableDays[0]?.id??'');setOpen(true);}}>
      Record expense
    </button>:undefined}
  >
    <nav className="tux-finance-toolbar" aria-label="Finance sections">
      <Link className="admin-secondary-button" href="/finance">Bank & Cash</Link>
      <Link className="admin-secondary-button" href="/finance/settlements">Settlements</Link>
      <Link className="admin-secondary-button" href="/finance/end-day">End Day</Link>
    </nav>
    {operations.expensesQuery.isLoading?<LoadingState title="Loading expenses" />:null}
    {operations.expensesQuery.isError?<ErrorState title="Expenses unavailable"
      action={<button type="button" className="admin-secondary-button"
        onClick={()=>void operations.expensesQuery.refetch()}>Retry</button>} />:null}
    {operations.expensesQuery.data?.expenses.length===0?<EmptyState
      title="No expenses recorded" description="Open-day management expenses will appear here." />:null}
    <ul className="tux-finance-ledger-list">
      {(operations.expensesQuery.data?.expenses??[]).map((expense)=>
        <li key={expense.id}>
          <div><strong>{expense.description}</strong>
            <small>{new Date(expense.created_at).toLocaleString('en-EG',{
              timeZone:'Africa/Cairo'})}</small>
          </div>
          <strong>{formatEgp(expense.amount_minor)}</strong>
        </li>)}
    </ul>
    <AdminDialog open={open} onOpenChange={setOpen} variant="sheet"
      title="Record expense"
      description="This is a posted management expense. Historical records cannot be edited after posting."
      footer={<>
        <button type="button" className="admin-secondary-button" onClick={()=>setOpen(false)}>Cancel</button>
        <button type="button" className="admin-primary-button"
          disabled={operations.command.isPending||availableDays.length===0}
          onClick={submit}>{operations.command.isPending?'Posting…':'Post expense'}</button>
      </>}
    >
      <div className="tux-finance-form">
        <label>Operations Business Day
          <select value={dayId} onChange={(e)=>setDayId(e.target.value)}>
            <option value="">Choose open day</option>
            {availableDays.map((day)=><option key={day.id} value={day.id}>
              {new Date(day.started_at).toLocaleString('en-EG',{timeZone:'Africa/Cairo'})}
            </option>)}
          </select>
        </label>
        {availableDays.length===0?<p>No OPEN Business Day; expense posting is unavailable until Operations opens one.</p>:null}
        <label>Amount (EGP)
          <input inputMode="decimal" value={amount} onChange={(e)=>setAmount(e.target.value)} />
        </label>
        <label>Category
          <select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)}>
            <option value="uncategorized">Uncategorized</option>
            {categories.map((category)=><option key={category.id} value={category.id}>
              {category.name}</option>)}
          </select>
        </label>
        <label>Description
          <input maxLength={500} value={description} onChange={(e)=>setDescription(e.target.value)} />
        </label>
        <label>Expense date
          <input type="date" value={expenseDate} onChange={(e)=>setExpenseDate(e.target.value)} />
        </label>
        <label>Payment source
          <select value={accountId} onChange={(e)=>setAccountId(e.target.value)}>
            <option value="unpaid">Not paid from tracked account</option>
            {accounts.map((account)=><option key={account.id} value={account.id}>
              {account.name}</option>)}
          </select>
        </label>
        <label>Reason
          <textarea maxLength={500} value={reason} onChange={(e)=>setReason(e.target.value)} />
        </label>
        <label>Receipt reference (optional)
          <input maxLength={600} value={receipt} onChange={(e)=>setReceipt(e.target.value)} />
        </label>
        {validation?<InlineError>{validation}</InlineError>:null}
        {operations.command.error?<InlineError>{operations.command.error instanceof Error?
          operations.command.error.message:'Expense posting failed'}</InlineError>:null}
      </div>
    </AdminDialog>
  </PageScaffold>;
}
