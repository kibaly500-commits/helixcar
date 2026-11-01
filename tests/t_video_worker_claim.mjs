import assert from 'node:assert/strict';
import {actionWorkerClaim,hasherJeton} from '../supabase/functions/candidature-video/index.ts';
let pass=0,fail=0;async function cas(n,f){try{await f();console.log('PASS - '+n);pass++;}catch(e){console.log('FAIL - '+n+': '+e.message);fail++;}}
const id='11111111-1111-4111-8111-111111111111',token='A'.repeat(43);
await cas('Edge worker : jeton absent refusé avant tout accès',async()=>{
 let appels=0;const sb={rpc(){appels++;},storage:{from(){appels++;}}};
 const r=await actionWorkerClaim(sb,new Request('https://edge.invalid',{method:'POST'}),{candidature_id:id});
 assert.equal(r.status,403);assert.equal(appels,0);
});
await cas('Edge worker : le jeton est transmis à SQL uniquement sous forme SHA-256',async()=>{
 let params;const sb={rpc(_n,p){params=p;return{data:{ok:true,chemin:`candidatures/${id}/verifie/video.mov`,mime:'video/quicktime',duree_max:120},error:null};},storage:{from(){return{createSignedUrl(){return{data:{signedUrl:'https://projet.supabase.co/storage/v1/object/sign/candidatures-videos/x?token=test'},error:null};}}}}};
 const req=new Request('https://edge.invalid',{method:'POST',headers:{Authorization:'HelixCar-Video '+token}});
 const r=await actionWorkerClaim(sb,req,{candidature_id:id});const j=await r.json();
 assert.equal(r.status,200);assert.equal(j.ok,true);assert.equal(params.p_jeton_hash,await hasherJeton(token));assert.ok(!JSON.stringify(params).includes(token));
});
await cas('Edge worker : un jeton déjà consommé ne reçoit aucune URL',async()=>{
 let signatures=0;const sb={rpc(){return{data:{ok:false,code:'JETON_INVALIDE'},error:null};},storage:{from(){return{createSignedUrl(){signatures++;}}}}};
 const req=new Request('https://edge.invalid',{method:'POST',headers:{Authorization:'HelixCar-Video '+token}});
 const r=await actionWorkerClaim(sb,req,{candidature_id:id});assert.equal(r.status,403);assert.equal(signatures,0);
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);process.exitCode=fail?1:0;
