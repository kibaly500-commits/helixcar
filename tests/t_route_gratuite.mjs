import assert from 'node:assert/strict';
import {routeFree,handleFreeRoute} from '../services/planning/route-gratuite.mjs';
const addressA='1 rue Exemple, 75001 Paris',addressB='2 rue Exemple, 59000 Lille';
const key='free-test-key';
const seen=[];
const mock=async(url,options={})=>{
 seen.push({url,options});
 if(url.includes('/geocode/')||url.includes('/pelias/v1/search'))return {ok:true,json:async()=>({features:[{geometry:{coordinates:url.includes('Paris')?[2.35,48.85]:[3.06,50.63]}}]})};
 if(url.includes('/directions/'))return {ok:true,json:async()=>({routes:[{summary:{distance:225000,duration:9300}}]})};
 throw Error('Requête inattendue : '+url);
};
let r=await routeFree(addressA,addressB,{fetcher:mock,key});
assert.equal(r.km,225);assert.equal(r.minutes,155);
assert.equal(r.tollsEuros,null);assert.equal(r.traffic,'non_inclus');
assert.equal(r.fastestMotorwayConfirmed,false);
assert.ok(seen.some(x=>x.url.includes('/pelias/v1/search')));
assert.ok(seen.some(x=>x.url.includes('/openrouteservice/v2/directions/driving-car/json')));
assert.equal((await handleFreeRoute({},{})).status,401);
let network=[];
const fetcher=async(url,opts)=>{
 network.push(url);
 if(url.endsWith('/rpc/est_admin'))return {ok:true,json:async()=>false};
 throw Error('Ne devrait pas continuer');
};
const auth={authorization:'Bearer abc.def.ghi',apikey:'anon-test'};
assert.equal((await handleFreeRoute({},auth,{fetcher,env:{ORS_FREE_API_KEY:key}})).status,403);
assert.deepEqual(network,[network[0]]);
const authorized=async(url,opts)=>{
 if(url.endsWith('/rpc/est_admin'))return {ok:true,json:async()=>true};
 if(url.endsWith('/rpc/source_preparation_missions'))return {ok:true,json:async()=>({
  empreinte:'v1',client:{id:'00000000-0000-4000-8000-000000000001',type_service:'convoyage'},
  vehicules:[{id:'v1',position:1,marque_modele:'Clio',adresse_depart_rue:'1 rue Exemple',code_postal_depart:'75001',ville_depart:'Paris',adresse_arrivee_rue:'2 rue Exemple',code_postal_arrivee:'59000',ville_arrivee:'Lille',date_prise_en_charge:'2026-11-10',date_livraison:'2026-11-10',heure_prise_en_charge:'09:00',heure_livraison:'15:00'}]})};
 return mock(url,opts);
};
r=await handleFreeRoute({clientId:'00000000-0000-4000-8000-000000000001',key:'v1:direct'},auth,{fetcher:authorized,env:{ORS_FREE_API_KEY:key}});
assert.equal(r.status,200);assert.equal(r.body.routes[0].km,225);assert.equal(r.body.routes[0].tollsEuros,null);
r=await handleFreeRoute({clientId:'00000000-0000-4000-8000-000000000001',key:'v1:direct'},auth,{fetcher:authorized,env:{}});
assert.equal(r.status,503);assert.equal(r.body.code,'ORS_NON_CONFIGURE');
console.log('PASS itinéraire gratuit : URL 2026, kilométrage, absence de péages inventés, authentification, administration et configuration.');

// La présence d'une clé payante ne doit jamais activer un repli facturable.
r=await handleFreeRoute({clientId:'00000000-0000-4000-8000-000000000001',key:'v1:direct'},auth,{fetcher:authorized,env:{HERE_ROUTING_API_KEY:'must-not-be-used'}});
assert.equal(r.status,503);assert.equal(r.body.code,'ORS_NON_CONFIGURE');
console.log('PASS mode gratuit : aucun repli HERE même si sa clé est configurée.');
