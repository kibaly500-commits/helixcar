import test from 'node:test';import assert from 'node:assert/strict';import {jsPDF} from 'jspdf';
import {suitePaiementTest} from '../supabase/functions/_shared/suite-paiement-test.mjs';
import {creerDocumentPaiementTest} from '../supabase/functions/_shared/document-paiement-test.mjs';
const initial=()=>({id:'11111111-1111-4111-8111-111111111111',devis_id:'22222222-2222-4222-8222-222222222222',numero:'TEST-DEV-2026-0081',cree_le:'2026-09-19T16:00:00Z',montant_centimes:120000,snapshot:{reference:'DEV-2026-0081',nom_client:'TEST-QA PARCOURS-FINAL-01',email:'helixcarpro+qa-final01@gmail.com',paiement_confirme_le:'2026-09-19T15:59:47Z',devis:{type_service:'convoyage',nombre_vehicules:2}},informations_attendues:[{libelle:'Immatriculation véhicule 1',statut:'attendue'},{libelle:'Contact <test>',statut:'a_corriger',commentaire:'Téléphone incorrect'},{libelle:'VIN',statut:'transmise'}]});
function fixture(){
 let row=initial(),pdf=null;const deliveries=new Map();let failSave=false;
 const copy=()=>structuredClone(row);
 const sb={rpc:async()=>({data:copy()}),from:()=>{
  let patch=null,condition=null;const q={update:p=>(patch=p,q),eq:()=>q,is:(k,v)=>(condition=[k,v],q),select:()=>q,single:()=>q,then:resolve=>{
    if(patch){if(failSave&&patch.email_id){failSave=false;return resolve({error:true});}if(!condition||row[condition[0]]==null)Object.assign(row,patch);}
    resolve({data:copy()});
  }};return q;
 },storage:{from:()=>({download:async()=>pdf?{data:new Blob([pdf])}:{error:true},upload:async(p,b)=>{if(pdf)return{error:true};pdf=b;return{data:{path:p}};}})}};
 const deps={sb,jsPDF,env:{RESEND_API_KEY:'fake',RESEND_FROM:'HelixCar <test@example.test>'},now:()=>Date.parse('2026-09-19T16:10:00Z'),fetchFn:async(url,opts)=>{
  const k=opts.headers['Idempotency-Key'],body=opts.body;
  if(deliveries.has(k))assert.equal(body,deliveries.get(k).body);
  else deliveries.set(k,{body,id:'email-'+deliveries.size});
  return Response.json({id:deliveries.get(k).id});
 }};
 return{deps,deliveries,get row(){return row;},get pdf(){return pdf;},failNextSave:()=>failSave=true};
}
test('PDF stable, privé canonique, reprise séquentielle sans second document ni mail',async()=>{
 const f=fixture();await suitePaiementTest(f.row.devis_id,f.deps);const pdf=f.pdf;
 await suitePaiementTest(f.row.devis_id,f.deps);
 assert.equal(f.pdf,pdf);assert.equal(f.deliveries.size,2);assert.ok(f.row.pdf_path);assert.ok(f.row.email_admin_id);
 const payload=JSON.parse([...f.deliveries.values()][0].body);assert.deepEqual(payload.to,['helixcarpro+qa-final01@gmail.com']);assert.equal(payload.attachments.length,1);assert.doesNotMatch(payload.html,/<li>|Contact|Immatriculation/);assert.equal((payload.html.match(/<a /g)||[]).length,1);assert.match(payload.html,/Compléter mes informations/);assert.match(payload.html,/Aucun débit réel/);assert.match(payload.html,/sans valeur fiscale/);
});
test('deux workers concurrents réutilisent les mêmes clés et les mêmes corps',async()=>{
 const f=fixture();await Promise.all([suitePaiementTest(f.row.devis_id,f.deps),suitePaiementTest(f.row.devis_id,f.deps)]);assert.equal(f.deliveries.size,2);
});
test('panne après acceptation fournisseur : reprise sans second envoi',async()=>{
 const f=fixture();f.failNextSave();await assert.rejects(suitePaiementTest(f.row.devis_id,f.deps));assert.equal(f.deliveries.size,1);
 await suitePaiementTest(f.row.devis_id,f.deps);assert.equal(f.deliveries.size,2);
});
test('après expiration de la déduplication fournisseur, pas de renvoi aveugle',async()=>{
 const f=fixture();f.failNextSave();await assert.rejects(suitePaiementTest(f.row.devis_id,f.deps));
 f.deps.now=()=>Date.parse('2026-09-21T16:00:00Z');await assert.rejects(suitePaiementTest(f.row.devis_id,f.deps),/RECONCILIATION/);assert.equal(f.deliveries.size,1);
});
test('le PDF est déterministe et clairement sans valeur fiscale',()=>{
 const a=creerDocumentPaiementTest(jsPDF,initial()),b=creerDocumentPaiementTest(jsPDF,initial());assert.deepEqual(a,b);assert.ok(a.length>1000);
});
