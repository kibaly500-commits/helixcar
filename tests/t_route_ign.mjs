import assert from 'node:assert/strict';
import {routeIgn} from '../services/planning/route-ign.mjs';
const calls=[];
const fetcher=async url=>{calls.push(url);const u=new URL(url);return {ok:true,json:async()=>url.includes('/geocodage/')?{features:[{geometry:{coordinates:[2.3,48.8]},properties:{postcode:u.searchParams.get('q').match(/\d{5}/)[0],score:0.9,type:'housenumber'}}]}:{distance:934,duration:494}};};
const result=await routeIgn('4 place Louis Armand 75012 Paris','12 avenue Thiers 06000 Nice',{fetcher});
assert.equal(result.km,934);assert.equal(result.minutes,494);assert.equal(calls.length,3);
const route=new URL(calls[2]);assert.equal(route.searchParams.get('optimization'),'fastest');assert.equal(route.searchParams.has('constraints'),false);
await assert.rejects(()=>routeIgn('Paris','Nice',{fetcher}),/postal/);
await assert.rejects(()=>routeIgn('75012 Paris','06000 Nice',{fetcher:async()=>({ok:true,json:async()=>({features:[{geometry:{coordinates:[2,48]},properties:{postcode:'69001',score:0.99,type:'housenumber'}}]})})}),/précision/);
await assert.rejects(()=>routeIgn('75012 Paris','06000 Nice',{fetcher:async()=>({ok:false,status:429})}),/occupé/);
console.log('PASS IGN sans clé : distance, durée, trajet rapide, code postal, adresses inconnues et quota.');

const alternate=await routeIgn('Place des Buisses 59000 Lille','Place des Buisses 59000 Lille',{fetcher:async url=>({ok:true,json:async()=>url.includes('/geocodage/')?{features:[{geometry:{coordinates:[3.07,50.63]},properties:{postcode:'59777',score:0.69,type:'street',name:'Place des Buisses',city:'Lille'}}]}:{distance:1,duration:2}})});
assert.equal(alternate.km,1);
