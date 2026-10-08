import { timingSafeEqual } from 'node:crypto';

import { getAdminServerEnv } from '../../server/env.js';
import { firstHeader, sendJson, type AdminRequest, type AdminResponse } from '../../server/http.js';
import { AdminSupabaseClient } from '../../server/supabaseAdmin.js';

function sameSecret(provided:string,expected:string):boolean {
  const left=Buffer.from(provided,'utf8'),right=Buffer.from(expected,'utf8');
  return left.length===right.length && timingSafeEqual(left,right);
}
function cairoToday():string {
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(new Date());
  const component=(type:string)=>parts.find((item)=>item.type===type)?.value??'';
  return `${component('year')}-${component('month')}-${component('day')}`;
}

// Callable only by a scheduler holding CRON_SECRET, not by Admin browser roles.
export default async function handler(request:AdminRequest,response:AdminResponse):Promise<void> {
  if(request.method!=='GET') {
    response.setHeader('allow','GET');
    sendJson(response,405,{error:'method_not_allowed'});return;
  }
  const secret=process.env['CRON_SECRET'];
  if (!secret||secret.length<32) {
    sendJson(response,503,{error:'scheduler_not_configured'});return;
  }
  const bearer=firstHeader(request.headers.authorization);
  if (!sameSecret(bearer,`Bearer ${secret}`)) {
    sendJson(response,401,{error:'unauthorized'});return;
  }
  try {
    const client=new AdminSupabaseClient(getAdminServerEnv());
    const generated=await client.rpc<number>('generate_due_recurring_expenses_v1',{
      p_until:cairoToday(),
    });
    sendJson(response,200,{ok:true,dueOccurrencesGenerated:generated});
  } catch(error) {
    console.error('Recurring-expense scheduler failure',error instanceof Error?error.name:'unknown');
    sendJson(response,502,{error:'scheduler_backend_unavailable'});
  }
}
