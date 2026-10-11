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
