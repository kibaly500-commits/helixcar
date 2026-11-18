import {recevoirPortrait} from '../supabase/functions/candidature-video/portrait.mjs';import assert from 'node:assert/strict';
let writes=0;const sb={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{photo_profil_chemin:null}})})}),update:()=>({eq:()=>({eq:()=>({select:()=>({maybeSingle:async()=>({data:{id:'id'}})})})})})}),storage:{from:()=>({upload:async()=>{writes++;return {}}})}};
const valid=async()=>({candidature:{id:'123',statut:'video_attendue'},jetonConsomme:false});
const body={mime:'image/jpeg',base64:Buffer.from([255,216,255,224,1]).toString('base64')};
assert.equal((await recevoirPortrait(sb,null,body,{},async()=>({erreur:['NO','Non autorisé',403]}))).status,403);assert.equal(writes,0);
assert.equal((await recevoirPortrait(sb,null,body,{},async()=>({...(await valid()),jetonConsomme:true}))).status,403);
assert.equal((await recevoirPortrait(sb,null,{...body,base64:'cGRm'}, {},valid)).status,400);assert.equal(writes,0);
assert.equal((await recevoirPortrait(sb,null,body,{},valid)).status,200);assert.equal(writes,1);
console.log('PASS jeton absent/consommé, contenu invalide, dépôt autorisé');
