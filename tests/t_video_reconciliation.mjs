import assert from 'node:assert/strict';
import {reconcilierVideos} from '../supabase/functions/candidature-video/reconciliation.ts';
import {actionReconcilier} from '../supabase/functions/candidature-video/index.ts';
let pass=0,fail=0;async function cas(n,f){try{await f();console.log('PASS - '+n);pass++;}catch(e){console.log('FAIL - '+n+': '+e.message);fail++;}}
const id='11111111-1111-4111-8111-111111111111',prefixe='candidatures/'+id+'/',date='2026-09-01T12:00:00Z',maintenant=Date.parse('2026-09-10T12:00:00Z');
function base(options={}){
 const c={id,video_chemin:prefixe+'verifie/finale.mov',video_envoyee_le:date,video_envoi_chemin:null,...options.c};const supprimes=[];
 const sb={supprimes,auth:{getUser:async()=>({data:{user:{id:'TEST-QA-CLAUDE-HELIXCAR-admin'}}})},from(table){
  let filtres=[];const q={select(){return q},lt(){return q},gt(){return q},order(){return q},limit(){return q},eq(k,v){filtres.push([k,v]);return q},maybeSingle:async()=>({data:table==='admins'?(options.admin?{id:'admin'}:null):c}),then(resolve){return Promise.resolve({data:table==='video_verifications'?[{chemin_final:prefixe+'verifie/historique.mov'}]:[c]}).then(resolve)}};return q;
 },storage:{from(){return{list:async(d)=>({data:(d.endsWith('verifie')?['finale.mov','historique.mov','refuse.mov']:['source.mov','recent.mov']).filter(n=>!supprimes.includes(d+'/'+n)).map(name=>({id:name,name,updated_at:name==='recent.mov'?'2026-09-10T11:00:00Z':date}))}),remove:async(paths)=>{supprimes.push(...paths);return{error:options.echecSuppression?{}:null}}}}}};return sb;
}
await cas('Simulation : aucune suppression, deux orphelins identifiés',async()=>{const sb=base();const r=await reconcilierVideos(sb,false,maintenant);assert.equal(r.a_supprimer,2);assert.equal(r.conserves,3);assert.equal(sb.supprimes.length,0);});
await cas('Nettoyage : préserve vidéo finale, historique vérifié et objet récent',async()=>{const sb=base();const r=await reconcilierVideos(sb,true,maintenant);assert.equal(r.supprimes,2);assert.deepEqual(sb.supprimes,[prefixe+'source.mov',prefixe+'verifie/refuse.mov']);const bis=await reconcilierVideos(sb,true,maintenant);assert.equal(bis.supprimes,0);});
await cas('Reprise active : aucun fichier supprimé',async()=>{const sb=base({c:{video_envoi_chemin:prefixe+'en-cours.mov'}});assert.equal((await reconcilierVideos(sb,true,maintenant)).examines,0);});
await cas('Finalisation récente : délai de 25 heures respecté',async()=>{const sb=base({c:{video_envoyee_le:'2026-09-10T10:00:00Z'}});assert.equal((await reconcilierVideos(sb,true,maintenant)).examines,0);});
await cas('Suppression échouée : aucun faux succès',async()=>{const r=await reconcilierVideos(base({echecSuppression:true}),true,maintenant);assert.equal(r.erreurs,2);assert.equal(r.supprimes,0);});
await cas('Chemin incohérent : refus conservateur',async()=>{const sb=base({c:{video_chemin:'autre-dossier/finale.mov'}});const r=await reconcilierVideos(sb,true,maintenant);assert.equal(r.erreurs,1);assert.equal(sb.supprimes.length,0);});
await cas('Utilisateur non administrateur : nettoyage interdit',async()=>{const sb=base();const r=await actionReconcilier(sb,new Request('https://test.invalid',{headers:{Authorization:'Bearer TEST-QA-CLAUDE-HELIXCAR'}}),{appliquer:true},{});assert.equal(r.status,403);assert.equal(sb.supprimes.length,0);});
await cas('Administrateur : audit sans suppression par défaut',async()=>{const sb=base({admin:true});const r=await actionReconcilier(sb,new Request('https://test.invalid',{headers:{Authorization:'Bearer TEST-QA-CLAUDE-HELIXCAR'}}),{},{});assert.equal(r.status,200);assert.equal((await r.json()).simulation,true);assert.equal(sb.supprimes.length,0);});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);process.exitCode=fail?1:0;
