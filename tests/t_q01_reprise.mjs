// P0 Q01 : perte de réponse APRES acceptation fournisseur, reprise après
// rechargement, et refus des faux succès. Services doublés, aucun réseau.
import assert from 'node:assert/strict';
import {creerDouble,etatDeBase,appeler,ID_DEVIS} from './t_devis_securite.mjs';
import {spawnSync} from 'node:child_process';
let pass=0,fail=0;
async function cas(n,fn){try{await fn();console.log('PASS - '+n);pass++;}catch(e){console.log('FAIL - '+n+': '+e.message);fail++;}}
const env={RESEND_API_KEY:'TEST-QA-CLAUDE-HELIXCAR-fausse-cle',HELIXCAR_ENV:'recette',HELIXCAR_DESTINATAIRES_RECETTE:'test-qa-claude-helixcar@example.invalid'};
async function pret(){const etat=etatDeBase(),d=creerDouble(etat);const r=await appeler(d,{action:'prepare',devis_id:ID_DEVIS},{jwt:'jwt-admin'});assert.equal(r.statut,200);return{etat,d,token:r.json.token};}
function envoyer(d,token,options={}){return appeler(d,{action:'send_email',devis_id:ID_DEVIS,token,envoi_cle:'TEST-QA-CLAUDE-HELIXCAR-essai'}, {jwt:'jwt-admin'}, {...env,...options});}
await cas('Le générateur PDF du serveur est synchronisé avec le Dashboard',async()=>{
  assert.equal(spawnSync(process.execPath,['tests/construire-pdf-serveur.cjs','--check']).status,0);
});
await cas('PDF, prix et destinataire fournis par le navigateur ne font pas foi',async()=>{
  const {d,etat}=await pret();const pdf=d.journal.pdfs[etat.tables.devis[0].pdf_path];
  assert.ok(Buffer.from(pdf).toString('latin1').startsWith('%PDF-'));assert.ok(pdf.length>10000);
  assert.equal(etat.tables.devis[0].snapshot_devis.prix,450);
});
await cas('Réponse perdue : même opération et même payload après une nouvelle session',async()=>{
  const {d,token,etat}=await pret();let mails=0,cle,payload;
  d.fetchFn=async(_u,options)=>{
    if(!cle){cle=options.headers['Idempotency-Key'];payload=options.body;mails++;throw new Error('réponse perdue après acceptation');}
    assert.equal(options.headers['Idempotency-Key'],cle);assert.equal(options.body,payload);
    return new Response(JSON.stringify({id:'TEST-QA-CLAUDE-HELIXCAR-email-1'}));
  };
  const a=await envoyer(d,token);assert.equal(a.json.code,'ENVOI_A_REPRENDRE');
  assert.equal(etat.tables.devis[0].statut,'genere');
  const b=await appeler(d,{action:'prepare',devis_id:ID_DEVIS},{jwt:'jwt-admin'});
  assert.equal(b.json.code,'ENVOI_A_REPRENDRE');
  // Ni token ni clé de tentative ne sont nécessaires au navigateur qui revient.
  const c=await appeler(d,{action:'resume_send',devis_id:ID_DEVIS},{jwt:'jwt-admin'},env);
  assert.equal(c.statut,200);assert.equal(mails,1);assert.equal(etat.tables.devis_envoi_operations.length,1);
  assert.equal(etat.tables.devis[0].statut,'envoye');
});
await cas('HTTP 200 sans identifiant prestataire reste un résultat inconnu',async()=>{
  const {d,token,etat}=await pret();d.fetchFn=async()=>new Response('{}');
  const r=await envoyer(d,token);assert.equal(r.statut,502);assert.equal(etat.tables.devis[0].statut,'genere');
  assert.ok(!d.journal.insertsJournal.some(x=>x.etape==='acceptee_prestataire'));
});
await cas('La fenêtre fournisseur expirée interdit tout renvoi automatique',async()=>{
  const {d,token,etat}=await pret();d.fetchFn=async()=>{throw new Error('réseau');};await envoyer(d,token);
  etat.tables.devis_envoi_operations[0].created_at=new Date(Date.now()-25*3600000).toISOString();
  let appels=0;d.fetchFn=async()=>{appels++;return new Response('{}');};
  const r=await appeler(d,{action:'resume_send',devis_id:ID_DEVIS},{jwt:'jwt-admin'},env);
  assert.equal(r.json.code,'ENVOI_A_RECONCILIER');assert.equal(appels,0);
});
await cas('La liste de destinataires autorisés est imposée côté serveur',async()=>{
  const {d,token}=await pret();let n=0;d.fetchFn=async()=>{n++;return new Response('{}');};
  const r=await envoyer(d,token,{HELIXCAR_DESTINATAIRES_RECETTE:''});assert.equal(r.statut,403);assert.equal(n,0);
});
await cas('Un autre rôle ne peut reprendre un envoi',async()=>{
  const {d}=await pret();const r=await appeler(d,{action:'resume_send',devis_id:ID_DEVIS},{jwt:'jwt-client'},env);assert.equal(r.statut,403);
});
await cas('Acceptation prestataire suivie de panne base : reprise sans deuxième appel',async()=>{
  const {d,token,etat}=await pret();let appels=0;etat.pannes={};
  d.fetchFn=async()=>{appels++;etat.pannes['devis:update']=true;return new Response(JSON.stringify({id:'TEST-QA-CLAUDE-HELIXCAR-id'}));};
  const premier=await envoyer(d,token);assert.equal(premier.json.code,'EMAIL_SENT_DB_UPDATE_FAILED');
  delete etat.pannes['devis:update'];
  const reprise=await envoyer(d,token);assert.equal(reprise.statut,200);assert.equal(reprise.json.statut,'envoye');assert.equal(appels,1);
});
await cas('Reprise après décision client : conserver la décision sans nouvel envoi',async()=>{
  const {d,token,etat}=await pret();await envoyer(d,token);
  etat.tables.devis[0].statut='accepte';d.fetchFn=async()=>{throw new Error('aucun nouvel appel autorisé');};
  const r=await envoyer(d,token);assert.equal(r.statut,200);assert.equal(r.json.statut,'accepte');
});
await cas('Devis annulé : aucune nouvelle préparation ni émission',async()=>{
 const {d,token,etat}=await pret();etat.tables.devis[0].annule_le=new Date().toISOString();let n=0;d.fetchFn=async()=>{n++;return new Response('{}')};
 assert.equal((await appeler(d,{action:'prepare',devis_id:ID_DEVIS},{jwt:'jwt-admin'})).statut,409);assert.equal((await envoyer(d,token)).statut,409);assert.equal(n,0);
});
await cas('Annulation après réponse perdue : pas de réémission aveugle',async()=>{
 const {d,token,etat}=await pret();d.fetchFn=async()=>{throw Error('réseau')};await envoyer(d,token);etat.tables.devis[0].annule_le=new Date().toISOString();let n=0;d.fetchFn=async()=>{n++;return new Response('{}')};
 assert.equal((await appeler(d,{action:'resume_send',devis_id:ID_DEVIS},{jwt:'jwt-admin'},env)).statut,409);assert.equal(n,0);
});
await cas('Technicien : snapshot sans véhicule ni trajet artificiel',async()=>{
 const etat=etatDeBase();Object.assign(etat.tables.clients[0],{type_service:'professionnel',professionnel_details:{categorie:'technicien'}});const d=creerDouble(etat);const r=await appeler(d,{action:'prepare',devis_id:ID_DEVIS},{jwt:'jwt-admin'});assert.equal(r.statut,200);const snap=etat.tables.devis[0].snapshot_devis;assert.equal(snap.nombre_vehicules,0);assert.equal(snap.vehicules,undefined);assert.equal(snap.trajet,undefined);
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);process.exitCode=fail?1:0;
