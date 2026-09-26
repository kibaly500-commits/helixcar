import test from 'node:test';import assert from 'node:assert/strict';
import {messageStockage,traiterNotificationsStockage} from '../supabase/functions/_shared/stockage-notifications.mjs';
function fixture(depot=true,recovery=true){
 const row={id:'qa-notification',client_id:'qa-client',devis_id:'qa-devis',snapshot:{email:'qa@example.test',reference:'QA',depotClient:depot,recuperationClient:recovery,dateDepot:'2026-10-08',heureDepot:'15:30:00',dateRecuperation:'2026-10-13',heureRecuperation:'16:00:00',test:true}};
 const d={client_id:row.client_id,statut:'accepte',paiement_statut:'paye'};
 const c={email:row.snapshot.email,type_service:'stockage',stockage_acheminement:depot?'depot_client':'helixcar',stockage_sortie:recovery?'recuperation_client':'helixcar'};
 const deliveries=new Map();let failSave=false;
 const sb={rpc:async()=>({data:row.fournisseur_id?[]:[structuredClone(row)]}),from:table=>{let patch,condition;const q={select:()=>q,eq:()=>q,is:(k,v)=>(condition=k,q),single:()=>q,update:v=>(patch=v,q),then:resolve=>{
  if(table!=='notifications_stockage')return resolve({data:table==='devis'?d:c});
  if(patch){if(failSave&&patch.fournisseur_id){failSave=false;return resolve({error:true});}if(!condition||row[condition]==null)Object.assign(row,patch);}
  resolve({data:structuredClone(row)});
 }};return q;}};
 const deps={sb,env:{RESEND_API_KEY:'fake',RESEND_FROM:'qa@example.test'},now:()=>Date.parse('2026-09-20T18:00:00Z'),fetchFn:async(url,opts)=>{
  const key=opts.headers['Idempotency-Key'];if(deliveries.has(key))assert.equal(deliveries.get(key),opts.body);else deliveries.set(key,opts.body);
  return Response.json({id:'resend-qa'});
 }};
 return {row,d,c,deliveries,deps,failSave:()=>failSave=true};
}
for(const [depot,recovery] of [[true,false],[false,true],[true,true]])test('mail stockage '+depot+'/'+recovery+' et reprise sans doublon',async()=>{
 const f=fixture(depot,recovery);assert.equal((await traiterNotificationsStockage(f.deps)).sent,1);await traiterNotificationsStockage(f.deps);assert.equal(f.deliveries.size,1);
 const body=JSON.parse([...f.deliveries.values()][0]);assert.match(body.text,/ALDI — 12 rue de l’Université/);assert.equal(body.text.includes('Dépôt de votre véhicule'),depot);assert.equal(body.text.includes('Récupération de votre véhicule'),recovery);assert.match(body.subject,/TEST/);
 if(depot)assert.match(body.text,/08\/10\/2026 à 15:30/);if(recovery)assert.match(body.text,/13\/10\/2026 à 16:00/);
});
test('panne après acceptation fournisseur : même clé et même corps',async()=>{const f=fixture();f.failSave();assert.equal((await traiterNotificationsStockage(f.deps)).failed,1);await traiterNotificationsStockage(f.deps);assert.equal(f.deliveries.size,1);assert.equal(f.row.fournisseur_id,'resend-qa');});
test('concurrence : pas de deuxième message',async()=>{const f=fixture();await Promise.all([traiterNotificationsStockage(f.deps),traiterNotificationsStockage(f.deps)]);assert.equal(f.deliveries.size,1);});
test('fenêtre Resend dépassée : rapprochement, jamais de renvoi',async()=>{const f=fixture();f.failSave();await traiterNotificationsStockage(f.deps);f.deps.now=()=>Date.parse('2026-09-22T18:00:00Z');await traiterNotificationsStockage(f.deps);assert.equal(f.deliveries.size,1);assert.equal(f.row.erreur,'RECONCILIATION_REQUIRED');});
for(const change of [f=>f.d.paiement_statut='en_attente',f=>f.d.statut='envoye',f=>f.c.email='autre@example.test',f=>f.c.stockage_sortie='helixcar',f=>f.c.type_service='convoyage'])test('dossier non éligible : aucun envoi '+change,async()=>{const f=fixture();change(f);await traiterNotificationsStockage(f.deps);assert.equal(f.deliveries.size,0);assert.equal(f.row.erreur,'DOSSIER_MODIFIE');});
test('aucun déplacement client : pas de contenu envoyé',async()=>{const f=fixture(false,false);await traiterNotificationsStockage(f.deps);assert.equal(f.deliveries.size,0);});
test('contenu échappé',()=>{const f=fixture();f.row.snapshot.reference='<img onerror=x>';assert.doesNotMatch(messageStockage(f.row,'qa').html,/<img/);});
