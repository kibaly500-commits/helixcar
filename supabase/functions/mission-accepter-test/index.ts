import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {envoyerNotificationsMissionTest} from '../_shared/notifications-mission-test.mjs';
import {PREVIEW} from '../_shared/stripe-payment.mjs';
Deno.serve(async req=>{
 const headers={'Access-Control-Allow-Origin':PREVIEW,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({ok:false},405);
 try{
  const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const authorization=req.headers.get('authorization')||'';
  const {data:a,error}=await sb.auth.getUser(authorization.replace(/^Bearer\s+/i,''));
  if(error||!a?.user)return reply({ok:false,message:'Reconnectez-vous.'},401);
  const body=await req.json();
  if(body.action==='notifications'){
    if(!/^[a-f0-9-]{36}$/i.test(body.mission_id||''))return reply({ok:false},400);
    const {data:m}=await sb.from('missions').select('id,devis_source_id,convoyeur_id').eq('id',body.mission_id).maybeSingle();
    if(!m?.devis_source_id)return reply({ok:false},404);
    const {data:c}=await sb.from('convoyeurs').select('auth_user_id').eq('id',m.convoyeur_id).maybeSingle();
    const {data:admin}=await sb.from('admins').select('id').eq('auth_user_id',a.user.id).eq('actif',true).maybeSingle();
    if(!admin&&c?.auth_user_id!==a.user.id)return reply({ok:false},403);
    await envoyerNotificationsMissionTest(m.id,{sb,env:{RESEND_API_KEY:Deno.env.get('RESEND_API_KEY'),RESEND_FROM:Deno.env.get('RESEND_FROM')}});
    return reply({ok:true});
  }
  if(!/^[a-f0-9-]{36}$/i.test(body.opportunite_id||''))return reply({ok:false},400);
  const userSb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}});
  const {data:result,error:rpcError}=await userSb.rpc('accepter_opportunite_payee_test',{p_opportunite_id:body.opportunite_id});
  if(rpcError)return reply({ok:false,message:'La mission ne peut pas être attribuée. Le dossier doit être validé.'},409);
  if(!result?.ok)return reply({ok:false,message:result?.code==='DEJA_PRISE'?'Cette mission vient d’être prise.':'Mission indisponible pour votre compte.'},409);
  let emails=true;
  try{await envoyerNotificationsMissionTest(result.mission_id,{sb,env:{RESEND_API_KEY:Deno.env.get('RESEND_API_KEY'),RESEND_FROM:Deno.env.get('RESEND_FROM')}});}catch{emails=false;}
  return reply({...result,emails_acceptes:emails,message:emails?'Mission attribuée. Les confirmations ont été envoyées.':'Mission attribuée. Les confirmations e-mail restent à envoyer.'});
 }catch{return reply({ok:false,message:'Impossible de confirmer pour le moment. Rechargez vos missions avant de réessayer.'},503);}
});
