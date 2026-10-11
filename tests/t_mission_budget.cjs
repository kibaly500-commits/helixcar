const assert=require('node:assert/strict');
const B=require('../assets/mission-budget.js');
let r=B.allocate(1000,[{key:'court',fees:0,guard:0,weight:50},{key:'long',fees:100,guard:50,weight:150}]);
assert.equal(r.reserve,300);assert.equal(r.budget,700);assert.deepEqual(r.missions.map(x=>x.total),[137.5,562.5]);
for(let n=1;n<101;n++){
 r=B.allocate(n+0.01,[{key:'a',fees:0,guard:0,weight:1},{key:'b',fees:0,guard:0,weight:2},{key:'c',fees:0,guard:0,weight:3}]);
 assert.equal(Math.round(r.missions.reduce((s,x)=>s+x.total,0)*100),Math.round(r.budget*100));
 assert.ok(r.reserve>=(n+0.01)*0.3-1e-9);
}
r=B.allocate(1000,[{key:'published',locked:true,total:300},{key:'new',fees:50,guard:20,weight:100}]);assert.equal(r.missions[0].total,400);
assert.throws(()=>B.allocate(100,[{key:'x',fees:60,guard:20,weight:10}]),/insuffisant/);
assert.throws(()=>B.allocate(100,[{key:'x',locked:true,total:80}]),/insuffisant/);
assert.throws(()=>B.allocate(NaN,[]));
assert.equal(B.local({mission:{adresse_depart:'75012 Paris',adresse_arrivee:'93160 Noisy',restitution:true,adresse_restitution:'59000 Lille'}}),false);
assert.equal(B.local({mission:{adresse_depart:'75012 Paris',adresse_arrivee:'93160 Noisy'}}),true);
assert.equal(B.guardDays({kind:'direct',organisation:{beforeDays:5,returnDays:5},mission:{restitution:true}}),10);
assert.equal(B.guardDays({kind:'avant_stockage',organisation:{beforeDays:6},mission:{}}),0);
assert.equal(B.guardDays({kind:'apres_stockage',organisation:{beforeDays:6,returnDays:6},retour_helixcar:{},mission:{restitution:true}}),1);
assert.equal(B.guardDays({kind:'direct',organisation:{retraitClient:true,beforeDays:6},mission:{}}),0);
console.log('PASS budget : 30/70, centimes, pondération, frais inclus, publié verrouillé, dépassement, IDF, gardes sans dépôt.');
assert.equal(B.roadFees(934,false),205.48);
assert.equal(B.roadFees(500,false),110);
assert.equal(B.roadFees(200,false),44);
assert.equal(B.roadFees(80,true),0);
assert.throws(()=>B.roadFees(0,false));assert.throws(()=>B.roadFees(NaN,false));
console.log('PASS forfait 0,22 €/km et exclusion IDF.');
const outside={key:'out',vehicule_id:'v',distance:900,distance_aller:500,mission:{adresse_depart:'75012 Paris',adresse_arrivee:'59000 Lille',adresse_restitution:'78000 Versailles',restitution:true}};
let pricing=B.travelPricing(outside);assert.equal(pricing.outboundFees,110);assert.equal(pricing.returnFees,55);assert.equal(pricing.fees,165);assert.equal(pricing.extra,0);
const inside={...outside,distance:100,distance_aller:60,mission:{adresse_depart:'75012 Paris',adresse_arrivee:'78000 Versailles',adresse_restitution:'93160 Noisy',restitution:true}};
pricing=B.travelPricing(inside);assert.equal(pricing.fees,0);assert.equal(pricing.extra,20);
const mixed={...outside,mission:{...outside.mission,adresse_depart:'59000 Lille',adresse_arrivee:'75012 Paris',adresse_restitution:'78000 Versailles'}};
pricing=B.travelPricing(mixed);assert.equal(pricing.fees,110);assert.equal(pricing.extra,20);
const bridge={...outside,retour_helixcar:{transfert:true}};
const secondary={key:'return',vehicule_id:'v',restitution_secondaire:true,distance:25,mission:{adresse_depart:'93160 Noisy',adresse_arrivee:'78000 Versailles'}};
assert.equal(B.travelPricing(bridge).returnFees,0);assert.equal(B.travelPricing(secondary,[bridge,secondary]).returnFees,55);
r=B.allocate(1000,[{key:'a',fees:0,guard:0,extra:20,weight:1},{key:'b',fees:0,guard:0,weight:1}]);assert.equal(r.missions[0].total-r.missions[1].total,20);assert.equal(r.missions.reduce((s,x)=>s+x.total,0),700);
console.log('PASS restitution : +20 IDF, 50 % aller hors IDF, mixte, découpage et conservation 30/70.');

for(const [days,euros] of [[0,0],[1,0],[2,0],[3,0],[3.99,0],[4,25],[7,25],[8,50],[11,50],[12,75]])assert.equal(B.guardAllowance(days),euros);
assert.throws(()=>B.guardAllowance(-1));
assert.throws(()=>B.guardAllowance(NaN));
for(const [before,after,euros] of [[2,2,0],[4,4,50],[5,5,50],[8,0,50]]){
 const p={kind:'direct',organisation:{beforeDays:before,returnDays:after},mission:{restitution:true}};
 assert.equal(B.guardPricing(p).guard,euros);
}
assert.equal(B.guardPricing({kind:'avant_stockage',organisation:{beforeDays:12},mission:{}}).guard,0);
assert.equal(B.guardPricing({kind:'apres_stockage',organisation:{returnDays:8},retour_helixcar:{},mission:{restitution:true}}).guard,0);
console.log('PASS paliers de garde : bornes, périodes séparées et exclusion dépôt HelixCar');
