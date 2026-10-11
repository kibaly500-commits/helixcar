const assert=require('node:assert/strict'),B=require('../assets/mission-budget.js');
for(const [price,expected] of [[69,70],[69.88,70],[74,75],[75,75],[76,75],[77.5,80]]){
 const items=[{key:'a',weight:price,fees:0,guard:0}];
 assert.equal(B.roundAllocation(B.allocate(1000,items),items).missions[0].total,expected);
}
for(const [km,expected] of [[33.2,33],[223.9,224],[350,350],[.2,1]])assert.equal(B.wholeKm(km),expected);
for(let n=0;n<100;n++){
 const items=[{key:'a',weight:100,fees:20.12,guard:25},{key:'b',weight:200,fees:30.33,guard:0}];
 const r=B.roundAllocation(B.allocate(300+n/100,items),items);
 assert.ok(r.spent<=r.budget);assert.ok(r.remaining>=90);
 for(const m of r.missions){assert.equal(m.total%5,0);assert.ok(m.work>=0);assert.equal(Math.round((m.work+m.fees+m.guard)*100),Math.round(m.total*100));}
}
const locked=[{key:'fixed',locked:true,total:69.88},{key:'a',weight:74,fees:0,guard:0}];
const r=B.roundAllocation(B.allocate(1000,locked),locked);assert.equal(r.spent,144.88);
const impossible=[{key:'a',weight:0,fees:69,guard:0}];assert.throws(()=>B.roundAllocation(B.allocate(99,impossible),impossible),/insuffisant/);
console.log('PASS arrondis : multiples de 5, kilomètres entiers, plafond global, coûts couverts, publiés conservés.');
