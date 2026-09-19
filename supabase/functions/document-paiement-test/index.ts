import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {jsPDF} from 'npm:jspdf@4.2.1';
import {suitePaiementTest} from '../_shared/suite-paiement-test.mjs';
import {PREVIEW} from '../_shared/stripe-payment.mjs';
Deno.serve(async req=>{
 const headers={'Access-Control-Allow-Origin':PREVIEW,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({ok:false},405);
 const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 try{
   const body=await req.json();
   if(!/^[a-f0-9-]{36}$/i.test(body.devis_id||''))return reply({ok:false},400);
   if(body.action==='worker'){
     if(typeof body.jeton!=='string'||!/^[a-f0-9]{64}$/.test(body.jeton))return reply({ok:false},401);
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.jeton)))).map(x=>x.toString(16).padStart(2,'0')).join('');
     const {data:job}=await sb.from('documents_paiement_test').select('id').eq('devis_id',body.devis_id).eq('worker_token_hash',hash).gt('worker_expire_le',new Date().toISOString()).maybeSingle();
     if(!job)return reply({ok:false},401);
     await suitePaiementTest(body.devis_id,{sb,jsPDF,env:{RESEND_API_KEY:Deno.env.get('RESEND_API_KEY'),RESEND_FROM:Deno.env.get('RESEND_FROM')}});
     const {error:clearError}=await sb.from('documents_paiement_test').update({worker_token_hash:null,worker_expire_le:null}).eq('id',job.id).eq('worker_token_hash',hash);
     if(clearError)throw clearError;
     return reply({ok:true});
   }
   const {data:auth,error}=await sb.auth.getUser((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
   if(error||!auth?.user)return reply({ok:false,message:'Reconnectez-vous.'},401);
   const {data:d}=await sb.from('devis').select('id,client_id,paiement_statut').eq('id',body.devis_id).maybeSingle();
   if(!d)return reply({ok:false},404);
   const {data:c}=await sb.from('clients').select('auth_user_id').eq('id',d.client_id).single();
   const {data:a}=await sb.from('admins').select('auth_user_id').eq('auth_user_id',auth.user.id).eq('actif',true).maybeSingle();
   if(!a&&c?.auth_user_id!==auth.user.id)return reply({ok:false},404);
   if(d.paiement_statut!=='paye')return reply({ok:false,message:'Paiement non confirmé.'},409);
   // Reprise facultative, autorisée aux administrateurs seulement.
   if(body.action==='preparer'){
     if(!a)return reply({ok:false},403);
     await suitePaiementTest(d.id,{sb,jsPDF,env:{RESEND_API_KEY:Deno.env.get('RESEND_API_KEY'),RESEND_FROM:Deno.env.get('RESEND_FROM')}});
   }
   const {data:f}=await sb.from('documents_paiement_test').select('numero,pdf_path').eq('devis_id',d.id).maybeSingle();
   if(!f?.pdf_path)return reply({ok:false,message:'Document en cours de préparation.'},409);
   const {data:url,error:e}=await sb.storage.from('factures-client-test').createSignedUrl(f.pdf_path,300);
   if(e)throw e;
   return reply({ok:true,numero:f.numero,url:url.signedUrl});
 }catch{return reply({ok:false,message:'Document indisponible. Réessayez dans quelques instants.'},503);}
});
