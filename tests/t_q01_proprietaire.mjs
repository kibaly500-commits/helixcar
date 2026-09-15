// Q01-003 / Q02-002 : vrai gestionnaire Edge, services doublés, aucun réseau.
import assert from 'node:assert/strict';
import { creerDouble, etatDeBase, appeler, ID_DEVIS } from './t_devis_securite.mjs';
import { hasherToken } from '../supabase/functions/devis-secure/index.ts';
let pass=0, fail=0;
async function cas(nom, fn) { try { await fn(); pass++; console.log('PASS - '+nom); }
  catch(e) { fail++; console.log('FAIL - '+nom+': '+e.message); } }
const token='TEST-QA-CLAUDE-HELIXCAR-token-non-reel';
async function fixture() {
  const etat=etatDeBase(); etat.tables.clients[0].auth_user_id='u-client';
  const row=etat.tables.devis[0]; Object.assign(row, {statut:'envoye',version_envoyee:1,
    acceptation_token_hash:await hasherToken(token), date_expiration_token:new Date(Date.now()+86400000).toISOString()});
  return {etat,d:creerDouble(etat),row};
}
for(const action of ['get','accept','refuse']) {
  await cas(action+' : anonyme porteur du lien refusé',async()=>{
    const {d}=await fixture();const r=await appeler(d,{action,token},{jwt:null});assert.equal(r.statut,401);
    assert.equal(d.journal.majsDevis.length,0);assert.equal(d.journal.signatures.length,0);
  });
  await cas(action+' : autre identité portant le bon lien refusée',async()=>{
    const {d}=await fixture();const r=await appeler(d,{action,token},{jwt:'jwt-partenaire'});assert.equal(r.statut,404);
    assert.equal(d.journal.majsDevis.length,0);assert.equal(d.journal.signatures.length,0);
  });
  await cas(action+' : propriétaire authentifié autorisé',async()=>{
    const {d,row}=await fixture();const r=await appeler(d,{action,token},{jwt:'jwt-client'});assert.equal(r.statut,200);
    if(action==='accept')assert.equal(row.accepte_par,'u-client');
    if(action==='refuse')assert.equal(row.refuse_par,'u-client');
  });
}
await cas('Depuis le Dashboard : ID canonique + identité, sans jeton exposé',async()=>{
  const {d}=await fixture();const r=await appeler(d,{action:'get',devis_id:ID_DEVIS},{jwt:'jwt-client'});
  assert.equal(r.statut,200);assert.equal(r.json.devis.reference,'DEV-2026-0062');
  assert.ok(!JSON.stringify(r.json).includes('acceptation_token_hash'));
});
await cas('ID canonique d’un autre client : même refus',async()=>{
  const {d}=await fixture();const r=await appeler(d,{action:'get',devis_id:ID_DEVIS},{jwt:'jwt-partenaire'});assert.equal(r.statut,404);
});
await cas('Devis annulé : aucun téléchargement ni acceptation',async()=>{
  const {d,row}=await fixture();row.annule_le=new Date().toISOString();
  const r=await appeler(d,{action:'accept',token},{jwt:'jwt-client'});assert.equal(r.statut,409);
  assert.equal(d.journal.majsDevis.length,0);
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);process.exitCode=fail?1:0;
