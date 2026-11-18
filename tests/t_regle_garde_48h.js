// Contrôle de non-régression : la règle validée est désormais CINQ JOURS,
// et non l'ancien seuil de 48 h. Ne pas rétablir la règle obsolète.
const assert=require('node:assert/strict');
const P=require('../assets/preparation-missions.js');
const client={type_service:'stockage',stockage_acheminement:'helixcar',stockage_sortie:'helixcar',stockage_date_debut:'2026-11-01',stockage_date_fin:'2026-11-07'};
const v={id:'v1',position:1,marque_modele:'Clio TEST',vin:'VIN-TEST',motorisation:'Essence',ville_depart:'Torcy',ville_arrivee:'Versailles',
 date_prise_en_charge:'2026-11-01',heure_prise_en_charge:'08:45',date_livraison:'2026-11-05',heure_livraison:'08:45',livraison_apres_stockage:true};
const build=(change={},c=client)=>P.build(c,[{...v,...change}],'Point HelixCar');
for(const [date,expected] of [['2026-11-05',1],['2026-11-06',1],['2026-11-07',2]]){
 const p=build({date_livraison:date});assert.equal(p.length,expected,date);
 assert.equal(p[0].kind,expected===1?'direct':'avant_stockage');
 if(expected===2)assert.equal(p[1].kind,'apres_stockage');
}
// La précision horaire ne doit plus créer artificiellement une seconde mission après 48 h.
assert.equal(build({date_livraison:'2026-11-03',heure_livraison:'08:46'}).length,1);
assert.equal(build({date_livraison:'2026-11-02',heure_livraison:'15:30'}).length,1);
for(const [inMode,outMode,count] of [['client','client',0],['client','helixcar',1],['helixcar','client',1]])
 assert.equal(build({livraison_apres_stockage:null}, {...client,stockage_acheminement:inMode,stockage_sortie:outMode}).length,count);
assert.equal(build({livraison_apres_stockage:false})[0].kind,'avant_stockage');
// Prise en charge/livraison inversées : blocage explicite, pas d'annonce valide.
assert.ok(build({date_livraison:'2026-10-31'}).some(p=>p.missing.includes('Livraison antérieure à la prise en charge')));
assert.equal(P.elapsedHours({...v,date_prise_en_charge:'2026-10-24',heure_prise_en_charge:'09:00',date_livraison:'2026-10-26',heure_livraison:'09:00'}),49);
assert.equal(P.elapsedHours({...v,date_prise_en_charge:'2026-03-28',heure_prise_en_charge:'09:00',date_livraison:'2026-03-30',heure_livraison:'09:00'}),47);
assert.equal(P.elapsedHours({...v,heure_prise_en_charge:'99:99'}),null);
assert.equal(P.elapsedHours({...v,date_prise_en_charge:'2026-10-25',heure_prise_en_charge:'02:30'}),null);
assert.equal(P.elapsedHours({...v,date_prise_en_charge:'2026-03-29',heure_prise_en_charge:'02:30'}),null);
const original=build({date_livraison:'2026-11-07'}).map((plan,i)=>({plan,cle:plan.key,mission_id:i===0?'published':null}));
assert.deepEqual(P.preservePublished(build(),original).map(p=>p.kind),['avant_stockage','apres_stockage']);
assert.equal(P.preservePublished(build(),original.map(s=>({...s,mission_id:null}))).length,1);
const multi=P.build(client,[v,{...v,id:'v2',date_livraison:'2026-11-07'}]);
assert.equal(multi.length,3);
console.log('PASS règle de garde cinq jours : bornes, pas de découpage à 48 h, DST, missions publiées, plusieurs véhicules.');
