import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creerDouble,etatDeBase,appeler,ID_DEVIS} from './t_devis_securite.mjs';
for(const jwt of [undefined,'jwt-client','jwt-partenaire'])test('PDF admin refuse '+jwt,async()=>{
 const d=creerDouble(etatDeBase());const r=await appeler(d,{action:'admin_pdf',devis_id:ID_DEVIS},{jwt});
 assert.ok([401,403].includes(r.statut));assert.equal(d.journal.signatures.length,0);
});
test('PDF envoyé conservé même après préparation d’une nouvelle version',async()=>{
 const e=etatDeBase();Object.assign(e.tables.devis[0],{date_envoi:'2026-10-10',pdf_path:'draft.pdf'});
 e.tables.devis_preparations=[{devis_id:ID_DEVIS,pdf_path:'sent.pdf',envoyee_le:'2026-10-10',created_at:'2026-10-10'},{devis_id:ID_DEVIS,pdf_path:'draft.pdf',envoyee_le:null,created_at:'2026-10-11'}];
 const d=creerDouble(e),before=JSON.stringify(e.tables);
 const r=await appeler(d,{action:'admin_pdf',devis_id:ID_DEVIS},{jwt:'jwt-admin'});
 assert.equal(r.statut,200);assert.equal(d.journal.signatures[0].chemin,'sent.pdf');assert.equal(JSON.stringify(e.tables),before);
});
test('Aucun PDF envoyé : refus sans génération silencieuse',async()=>{
 const d=creerDouble(etatDeBase());const r=await appeler(d,{action:'admin_pdf',devis_id:ID_DEVIS},{jwt:'jwt-admin'});
 assert.equal(r.statut,409);assert.equal(d.journal.signatures.length,0);
});
