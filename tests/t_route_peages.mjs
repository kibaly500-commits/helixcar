import assert from 'node:assert/strict';
import {routeTolls} from '../services/planning/route-peages.mjs';
const run=sections=>routeTolls('75012 Paris','59000 Lille',{key:'test',fetcher:async url=>({ok:true,json:async()=>url.includes('/geocode?')?{items:[{position:{lat:48,lng:2}}]}:{routes:[{sections}]}})});
const section={summary:{length:220000,duration:8000},tolls:[{fares:[{price:{type:'value',currency:'EUR',value:9},paymentMethods:['transponder']},{price:{type:'value',currency:'EUR',value:20},paymentMethods:['cash']},{price:{type:'value',currency:'EUR',value:20},paymentMethods:['bankCard']}]}]};
let r=await run([section]);assert.equal(r.km,220);assert.equal(r.tollsEuros,20); // alternative fares must not be summed
r=await run([section,section]);assert.equal(r.tollsEuros,40);
r=await run([{...section,notices:[{code:'tollsDataUnavailable'}]}]);assert.equal(r.tollsEuros,null);
r=await run([{summary:section.summary,tolls:[{fares:[]}]}]);assert.equal(r.tollsEuros,null);
r=await run([{summary:section.summary}]);assert.equal(r.tollsEuros,0);
await assert.rejects(()=>run([{tolls:[]}]),/incomplet/);
console.log('PASS HERE : kilomètres, péages non cumulés par moyen de paiement, multi-trajets et données incomplètes.');
