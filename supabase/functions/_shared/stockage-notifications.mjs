import {preparerMailAccesStockage} from './stockage-acces.mjs';
const checked=async p=>{const r=await p;if(r.error)throw Error('PERSISTENCE');return r.data;};
const dateFr=value=>{const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'';};
export function messageStockage(n,from){
 const s=n.snapshot;
 const msg=preparerMailAccesStockage({...s,dateDepot:dateFr(s.dateDepot),dateRecuperation:dateFr(s.dateRecuperation),heureDepot:String(s.heureDepot||'').slice(0,5),heureRecuperation:String(s.heureRecuperation||'').slice(0,5)});
 if(s.test){msg.subject='[TEST] '+msg.subject;msg.text+='\n\nScénario de recette : aucun déplacement à effectuer.';msg.html+='<p>Scénario de recette : aucun déplacement à effectuer.</p>';}
 return {from,to:[s.email],...msg};
}
export async function traiterNotificationsStockage({sb,env,fetchFn=fetch,now=()=>Date.now()}){
 if(!env.RESEND_API_KEY||!env.RESEND_FROM)throw Error('EMAIL_CONFIGURATION');
 const rows=await checked(sb.rpc('reclamer_notifications_stockage'));
 let sent=0,failed=0;
 for(let n of rows){
  try{
   const d=await checked(sb.from('devis').select('statut,paiement_statut,client_id').eq('id',n.devis_id).single());
   const c=await checked(sb.from('clients').select('email,type_service,stockage_acheminement,stockage_sortie').eq('id',n.client_id).single());
   if(d.client_id!==n.client_id||d.statut!=='accepte'||d.paiement_statut!=='paye'||!['stockage','convoyage_stockage'].includes(c.type_service)||c.email!==n.snapshot.email||
    (c.stockage_acheminement==='depot_client')!==n.snapshot.depotClient||(c.stockage_sortie==='recuperation_client')!==n.snapshot.recuperationClient)throw Error('DOSSIER_MODIFIE');
   if(!n.premier_essai){await checked(sb.from('notifications_stockage').update({payload:messageStockage(n,env.RESEND_FROM),premier_essai:new Date(now()).toISOString()}).eq('id',n.id).is('premier_essai',null));}
   n=await checked(sb.from('notifications_stockage').select('*').eq('id',n.id).single());
   if(n.fournisseur_id)continue;
   if(now()-Date.parse(n.premier_essai)>=23*3600000)throw Error('RECONCILIATION_REQUIRED');
   const response=await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'helixcar-stockage/'+n.id},body:JSON.stringify(n.payload)});
   const result=await response.json();if(!response.ok||!result.id)throw Error('EMAIL_RETRY');
   await checked(sb.from('notifications_stockage').update({fournisseur_id:result.id,erreur:null,verrou_jusqua:null}).eq('id',n.id));sent++;
  }catch(e){failed++;await checked(sb.from('notifications_stockage').update({erreur:['DOSSIER_MODIFIE','RECONCILIATION_REQUIRED'].includes(e.message)?e.message:'EMAIL_RETRY',verrou_jusqua:new Date(now()+300000).toISOString()}).eq('id',n.id));}
 }
 return {ok:failed===0,sent,failed};
}
