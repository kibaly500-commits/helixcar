const assert=require('node:assert/strict'),C=require('../assets/planning-calcul');
const plan=(time,day='2026-11-11')=>({kind:'avant_stockage',date_fin:day,heure_remise:'19:00',rows:[{label:'Prise en charge',value:day+' · '+time},{label:'Livraison',value:day}],mission:{},calcul_interne:{minutes:144}});
for(const [start,arrival,day] of [['14:46','17:55','2026-11-11'],['14:50','17:59','2026-11-11'],['14:51','18:00','2026-11-12'],['15:30','18:39','2026-11-12']]){
 const p=plan(start);C.appliquerReception(p);assert.equal(p.reception_calc.arrival,'2026-11-11T'+arrival);assert.equal(p.date_fin,day);
 if(day==='2026-11-12'){assert.equal(p.heure_remise,'');assert.equal(p.mission.date_livraison,null);p.heure_remise='09:30';C.appliquerReception(p);assert.equal(p.mission.date_livraison,'2026-11-12T09:30');assert.ok(!p.rows.some(r=>r.label==='Garde avant réception'));C.appliquerReception(p);assert.equal(p.date_fin,day);}
}
let p=plan('15:30','2026-12-31');C.appliquerReception(p);assert.equal(p.date_fin,'2027-01-01');
p=plan('15:30');p.saved={mission_id:'published'};C.appliquerReception(p);assert.equal(p.date_fin,'2026-11-11');
p=plan('15:30');p.kind='apres_stockage';C.appliquerReception(p);assert.equal(p.date_fin,'2026-11-11');
p=plan('15:30');p.calcul_interne.minutes=null;assert.equal(C.receptionNoisy(p,null),null);
p=plan('14:50');p.rows[0].value='2026-11-11 · 14:00 - 14:51';C.appliquerReception(p);assert.equal(p.date_fin,'2026-11-12');
p=plan('23:30');C.appliquerReception(p);assert.equal(p.date_fin,'2026-11-12');assert.equal(p.reception_calc.report,false);
console.log('PASS réception : 17h55, 17h59, 18h00, 18h39, créneau, fin d’année, nuit, idempotence, heure manuelle, publié et départ préservés.');
