const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const P=require('../assets/preparation-missions.js'),C=require('../assets/planning-calcul.js');
const c={type_service:'stockage',stockage_acheminement:'helixcar',stockage_sortie:'helixcar',stockage_date_debut:'2026-11-14',stockage_date_fin:'2026-11-22'};
const v={id:'v1',position:1,marque_modele:'Clio',vin:'VIN-TEST',ville_depart:'Paris',ville_arrivee:'Lyon',date_prise_en_charge:'2026-11-14',heure_prise_en_charge:'09:00',date_livraison:'2026-11-22',heure_livraison:'11:00',livraison_apres_stockage:true};
test('départ de Noisy la veille, heure vierge, livraison client intacte',()=>{
 const before=JSON.stringify({c,v}),plans=P.build(c,[v]);assert.equal(plans.length,2);const post=plans[1];assert.equal(post.date_debut,'2026-11-21');assert.equal(post.mission.date_prise_en_charge,null);assert.equal(post.heure_prise_en_charge,'');assert.equal(post.mission.date_livraison,'2026-11-22T11:00');assert.equal(post.retrait_veille,true);assert.match(C.guidance(post).rule,/veille/);assert.equal(JSON.stringify({c,v}),before);
});
for(const [delivery,expected] of [['2027-01-01','2026-12-31'],['2026-03-01','2026-02-28'],['2028-03-01','2028-02-29'],['2026-10-26','2026-10-25']])test('veille civile '+delivery,()=>{const p=P.build({...c,stockage_acheminement:'client',stockage_date_debut:expected},[{...v,date_livraison:delivery}])[0];assert.equal(p.date_debut,expected);});
test('impossible de retirer avant arrivée au dépôt',()=>{const p=P.build({...c,stockage_acheminement:'client',stockage_date_debut:'2026-11-22'},[v])[0];assert(p.missing.some(x=>x.includes('Récupération la veille impossible')));});
const retour={...v,restitution_concernee:true,restit_destination:'adresse',restit_date:'2026-11-27',restit_heure:'15:00',restit_marque_modele:'Yaris',restit_vin:'VIN-RETOUR',restit_ville:'Paris'};
test('retour différé reste dans une seule mission après stockage',()=>{
 const plans=P.build(c,[retour]);assert.equal(plans.length,2);assert(!plans[0].mission.restitution);const p=plans[1];assert.equal(p.date_fin,'2026-11-27');assert.equal(p.mission.date_livraison,'2026-11-22T11:00');assert.equal(p.mission.date_restitution_depart,'2026-11-27T15:00');assert.match(p.rows.find(r=>r.label==='Garde du véhicule récupéré').value,/Chez le même convoyeur.*2026-11-22 au 2026-11-27.*rémunération totale/);
});
test('retour différé sur convoyage court ne provoque pas de découpage',()=>{const plans=P.build({type_service:'convoyage'},[{...retour,date_prise_en_charge:'2026-11-21'}]);assert.equal(plans.length,1);assert.equal(plans[0].kind,'direct');assert.equal(plans[0].date_fin,'2026-11-27');});
test('retour à Noisy conserve les deux rendez-vous internes',()=>{const p=P.build(c,[{...retour,restit_destination:'stockage',restit_recuperation_client:true}])[1];assert(p.retour_helixcar);assert.equal(p.retour_remise,'2026-11-27T15:00');assert(!p.rows.some(r=>r.label==='Garde du véhicule récupéré'));assert.equal(p.date_fin,'2026-11-22');});
test('client récupère lui-même : aucun départ convoyeur',()=>{assert.equal(P.build(c,[{...v,livraison_apres_stockage:false}]).length,1);});
test('services sans convoyage inchangés',()=>{for(const type_service of ['nettoyage','professionnel']){const p=P.build({type_service},[])[0];assert.equal(p.kind,'intervention');assert(!p.retrait_veille);}});
const ui=fs.readFileSync('assets/preparation-missions-ui.js','utf8');
const adoptSource=ui.slice(ui.indexOf('  function adopt('),ui.indexOf('  window.ouvrirPreparationDemande='));
const adopt=new Function('HCPreparation','HCPlanningCalcul','let state;'+adoptSource+';return s=>{adopt(s);return state;}')(P,C);
test('ancien brouillon : date recalculée et ancienne heure effacée',()=>{
 const old=P.build(c,[retour])[1];old.date_debut='2026-11-22';old.heure_retrait='08:00';old.mission.date_prise_en_charge='2026-11-22T08:00';old.remuneration=170;
 const state=adopt({client:c,vehicules:[retour],empreinte:'hash',brouillons:[{cle:old.key,empreinte:'hash',plan:old}]});const p=state.plans.find(p=>p.kind==='apres_stockage');assert.equal(p.date_debut,'2026-11-21');assert.equal(p.heure_retrait,'');assert.equal(p.mission.date_prise_en_charge,null);assert.equal(p.remuneration,170);assert.equal(p.date_fin,'2026-11-27');
});
test('missions publiées préservées',()=>{const old=P.build(c,[v])[1];old.date_debut='2026-11-22';old.heure_retrait='08:00';const state=adopt({client:c,vehicules:[v],empreinte:'hash',brouillons:[{cle:old.key,empreinte:'hash',plan:old,mission_id:'published'}]});assert.equal(state.plans[0].date_debut,'2026-11-22');assert.equal(state.plans[0].heure_retrait,'08:00');});
const cardSource=ui.slice(ui.indexOf('  function card('),ui.indexOf('  window.hcPreparationCarteOpportunite='));
const card=new Function('esc','display','money',cardSource+';return card;')(String,String,String);
test('aperçu partenaire montre la garde et exclut les coordonnées privées',()=>{const p=P.build(c,[{...retour,adresse_depart_rue:'SECRET-ADRESSE',restit_contact_tel:'SECRET-TEL'}])[1];const html=card(P.publicData(p));assert.match(html,/Garde du véhicule récupéré/);assert.match(html,/Chez le même convoyeur/);assert(!html.includes('SECRET'));});
