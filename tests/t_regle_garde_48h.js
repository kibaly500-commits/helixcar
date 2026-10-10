const assert=require('node:assert/strict');
const P=require('../assets/preparation-missions.js');
const c={type_service:'stockage',stockage_acheminement:'helixcar',stockage_sortie:'helixcar',stockage_date_debut:'2026-10-06',stockage_date_fin:'2026-10-08'};
const v={id:'v1',marque_modele:'Clio TEST',vin:'VIN-TEST',motorisation:'Essence',ville_depart:'Torcy',ville_arrivee:'Versailles',date_prise_en_charge:'2026-10-06',heure_prise_en_charge:'08:45',date_livraison:'2026-10-08',heure_livraison:'08:45',restitution_concernee:true,restit_vin:'RETURN',restit_marque_modele:'Clio retour'};
const build=(change={},client=c)=>P.build(client,[{...v,...change}],'Point HelixCar');
for(const [hours,minute,expected] of [['08','44',1],['08','45',1],['08','46',2]]) {
 const plans=build({heure_livraison:hours+':'+minute});assert.equal(plans.length,expected);
 if(expected===1){assert.equal(plans[0].kind,'direct');assert.equal(plans[0].mission.ville_depart,'Torcy');assert.equal(plans[0].mission.ville_arrivee,'Versailles');assert.equal(plans[0].mission.motorisation,'Essence');assert.equal(plans[0].mission.restitution,true);}
 else {assert.equal(plans[0].kind,'avant_stockage');assert.equal(plans[1].kind,'apres_stockage');assert.equal(plans[0].mission.restitution,false);assert.equal(plans[1].mission.restitution,true);}
}
assert.equal(build({date_livraison:'2026-10-07',heure_livraison:'15:30'},{...c,stockage_date_fin:'2026-10-07'}).length,1);
for(const [inMode,outMode,count] of [['client','client',0],['client','helixcar',1],['helixcar','client',1]])assert.equal(build({}, {...c,stockage_acheminement:inMode,stockage_sortie:outMode}).length,count);
assert.equal(build({livraison_apres_stockage:false})[0].kind,'avant_stockage');
assert.equal(build({pc_heure_type:'creneau',pc_creneau_debut:'08:30',pc_creneau_fin:'09:30',liv_heure_type:'creneau',liv_creneau_debut:'08:00',liv_creneau_fin:'08:31'}).length,2);
assert.ok(build({heure_prise_en_charge:''}).every(p=>p.missing.some(s=>s.includes('48 heures'))));
assert.ok(build({date_livraison:'2026-10-05'}).every(p=>p.missing.includes('Livraison antérieure à la prise en charge')));
assert.equal(P.elapsedHours({...v,date_prise_en_charge:'2026-10-24',heure_prise_en_charge:'09:00',date_livraison:'2026-10-26',heure_livraison:'09:00'}),49);
assert.equal(P.elapsedHours({...v,date_prise_en_charge:'2026-03-28',heure_prise_en_charge:'09:00',date_livraison:'2026-03-30',heure_livraison:'09:00'}),47);
const old=build({heure_livraison:'08:46'}).map((plan,i)=>({plan,cle:plan.key,mission_id:i===0?'published':null}));
assert.deepEqual(P.preservePublished(build(),old).map(p=>p.kind),['avant_stockage','apres_stockage']);
assert.equal(P.preservePublished(build(),old.map(s=>({...s,mission_id:null}))).length,1);
assert.equal(P.preservePublished(build(),old.concat(build().map(plan=>({plan,cle:plan.key,mission_id:null})))).length,2);
assert.equal(P.elapsedHours({...v,heure_prise_en_charge:'99:99'}),null);
assert.equal(P.elapsedHours({...v,date_prise_en_charge:'2026-10-25',heure_prise_en_charge:'02:30'}),null);
assert.equal(P.elapsedHours({...v,date_prise_en_charge:'2026-03-29',heure_prise_en_charge:'02:30'}),null);
const mixed=P.build(c,[v,{...v,id:'v2',heure_livraison:'08:46'}]);assert.equal(mixed.length,3);
console.log('PASS Règle 48 h : seuils, créneaux, fuseau Paris, stockage mixte, restitution et missions publiées');

const multi=P.build({...c,stockage_date_debut:'2026-11-04',stockage_date_fin:'2026-11-18'},[
 {...v,id:'early',date_prise_en_charge:'2026-11-04',date_livraison:'2026-11-10'},
 {...v,id:'late',date_prise_en_charge:'2026-11-04',date_livraison:'2027-02-05'}]);
assert.deepEqual(multi.filter(p=>p.kind==='apres_stockage').map(p=>[p.date_debut,p.date_fin]),[['2026-11-10','2026-11-10'],['2027-02-05','2027-02-05']]);
assert.ok(multi.every(p=>!p.missing.includes('Livraison antérieure à la prise en charge')));
assert.equal(build({date_livraison:'2026-10-07',heure_livraison:'15:30'}).length,1);
console.log('PASS sorties individuelles avant/après fin prévue et garde courte sans découpage artificiel');
