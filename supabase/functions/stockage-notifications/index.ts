import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {traiterNotificationsStockage} from '../_shared/stockage-notifications.mjs';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response(null,{status:405});
 const token=req.headers.get('x-stockage-worker')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return new Response(null,{status:401});
 const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const {data,error}=await sb.rpc('verifier_stockage_worker',{p_token:token});
 if(error||data!==true)return new Response(null,{status:403});
 try {
  const result=await traiterNotificationsStockage({sb,env:{RESEND_API_KEY:Deno.env.get('RESEND_API_KEY'),RESEND_FROM:Deno.env.get('RESEND_FROM')}});
  return Response.json(result);
 } catch {return Response.json({ok:false},{status:503});}
});
