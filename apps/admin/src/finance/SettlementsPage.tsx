import { Link } from 'wouter';
import { useState } from 'react';

import { EmptyState, ErrorState, InlineError, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from '../shops/ShopScopeProvider';
import { useFinance } from './useFinance';
import { formatEgp, parseEgpMinor } from './money';
import { useFinanceOperations } from './useFinanceOperations';

function cairoToday():string {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=(type:string)=>parts.find((part)=>part.type===type)?.value??'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function SettlementsPage() {
  const {scope,principal}=useShopScope();
  const shopId=scope.kind==='shop'?scope.shopId:undefined;
  const finance=useFinance(shopId,null);
  const operations=useFinanceOperations(shopId,undefined);
  const [open,setOpen]=useState(false);
  const [source,setSource]=useState('');
  const [destination,setDestination]=useState('');
  const [gross,setGross]=useState('');
  const [fee,setFee]=useState('0');
  const [settledOn,setSettledOn]=useState(cairoToday());
  const [reference,setReference]=useState('');
  const [validation,setValidation]=useState<string|null>(null);
  const accounts=finance.workspaceQuery.data?.accounts.filter((a)=>a.active)??[];
  const sources=accounts.filter((a)=>a.accountType==='PENDING_SETTLEMENT');
  const destinations=accounts.filter((a)=>['BANK','WALLET'].includes(a.accountType));
  const canRecord=principal.permissions.includes('finance.reconcile');
  function submit() {
    if (!shopId) return;
    try {
      const amountMinor=parseEgpMinor(gross);
      const feeMinor=parseEgpMinor(fee);
      if (amountMinor<=0||feeMinor<0||feeMinor>=amountMinor) {
        throw new Error('The fee must be nonnegative and less than the gross settlement.');
      }
      if (!sources.some((a)=>a.id===source)||!destinations.some((a)=>a.id===destination)) {
        throw new Error('Choose an active pending and a bank/wallet account.');
      }
      if (!reference.trim()) throw new Error('A settlement reference is required.');
      operations.command.mutate({draft:{
        type:'finance.settlement.record',shopId,
        fromAccountId:source,toAccountId:destination,
        amountMinor,feeMinor,reason:reference.trim(),settledOn,
      }},{onSuccess:()=>{
        setOpen(false);setGross('');setFee('0');setReference('');
        setValidation(null);
      }});
    } catch(error) {
      setValidation(error instanceof Error?error.message:'Invalid settlement');
    }
  }
  if (!shopId) return <PageScaffold eyebrow="Finance" title="Settlements"
    description="Choose a shop to inspect or record settlements." />;

  return <PageScaffold eyebrow="Finance" title="Settlements"
    description="Move a verified gross pending amount to bank/wallet, with the fee recorded exactly once."
    primaryAction={canRecord?<button type="button" className="admin-primary-button"
      onClick={()=>setOpen(true)}>Record settlement</button>:undefined}>
    <nav className="tux-finance-toolbar" aria-label="Finance sections">
      <Link className="admin-secondary-button" href="/finance">Bank & Cash</Link>
      <Link className="admin-secondary-button" href="/finance/expenses">Expenses</Link>
      <Link className="admin-secondary-button" href="/finance/end-day">End Day</Link>
    </nav>
    {operations.settlementsQuery.isLoading?<LoadingState title="Loading settlements" />:null}
    {operations.settlementsQuery.isError?<ErrorState title="Settlement history unavailable"
      action={<button type="button" className="admin-secondary-button"
        onClick={()=>void operations.settlementsQuery.refetch()}>Retry</button>} />:null}
    {operations.settlementsQuery.data?.settlements.length===0?<EmptyState
      title="No settlements recorded" description="Confirmed card/wallet settlements will appear here." />:null}
    <ul className="tux-finance-ledger-list">
      {(operations.settlementsQuery.data?.settlements??[]).map((settlement)=>
        <li key={settlement.id}>
          <div><strong>{settlement.settled_on}</strong>
            <small>Gross {formatEgp(settlement.gross_minor)} · Fee {formatEgp(settlement.fee_minor)}</small>
          </div>
          <strong>{formatEgp(settlement.net_minor)}</strong>
        </li>)}
    </ul>
    <AdminDialog open={open} onOpenChange={setOpen}
      title="Record payment settlement" variant="sheet"
      description="Gross pending funds leave the pending account. Only the net reaches the bank or wallet."
      footer={<>
        <button type="button" className="admin-secondary-button"
          onClick={()=>setOpen(false)}>Cancel</button>
        <button type="button" className="admin-primary-button"
          disabled={operations.command.isPending} onClick={submit}>
          {operations.command.isPending?'Recording…':'Record settlement'}
        </button>
      </>}
    >
      <div className="tux-finance-form">
        <label>Pending account
          <select value={source} onChange={(e)=>setSource(e.target.value)}>
            <option value="">Select pending account</option>
            {sources.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Bank or wallet
          <select value={destination} onChange={(e)=>setDestination(e.target.value)}>
            <option value="">Select destination</option>
            {destinations.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Gross amount (EGP)
          <input inputMode="decimal" value={gross} onChange={(e)=>setGross(e.target.value)} />
        </label>
        <label>Provider fee (EGP)
          <input inputMode="decimal" value={fee} onChange={(e)=>setFee(e.target.value)} />
        </label>
        <label>Settlement date
          <input type="date" value={settledOn} onChange={(e)=>setSettledOn(e.target.value)} />
        </label>
        <label>Reference and reason
          <textarea maxLength={500} value={reference} onChange={(e)=>setReference(e.target.value)} />
        </label>
        {validation?<InlineError>{validation}</InlineError>:null}
        {operations.command.error?<InlineError>{operations.command.error instanceof Error?
          operations.command.error.message:'Settlement failed'}</InlineError>:null}
      </div>
    </AdminDialog>
  </PageScaffold>;
}
