import {traiterPaiementRecette} from '../supabase/functions/paiement-recette/index.ts';

let pass=0,fail=0;const check=(n,c,d='')=>{console.log((c?'PASS':'FAIL')+' - '+n+(c?'':' ['+d+']'));c?pass++:fail++;};
const PREVIEW='https://helixcar-i89b.vercel.app';
const ID='d0d0d0d0-0000-4000-8000-000000000001';

function double({qa=true,statut='accepte',paiement='en_attente',version=1,versionAcceptee=1}={}){
  const devis={id:ID,reference:'DEV-QA',client_id:'c1',prix:450,statut,paiement_statut:paiement,version,version_acceptee:versionAcceptee};
  const client={id:'c1',auth_user_id:'u1',numero_client:'HC-QA',prenom:qa?'TEST-QA-CLAUDE-HELIXCAR':'Jean',nom:'Client',email:'qa@example.invalid'};
  const journal=[],archives=[];let rpc=0;
  function table(nom){let rows=nom==='devis'?[devis]:nom==='clients'?[client]:nom==='devis_preparations'?archives:journal;let payload=null;
    const filters=[];const api={select(){return api;},eq(k,v){filters.push(x=>x[k]===v);return api;},insert(v){payload=v;return Promise.resolve((journal.push(v),{data:v,error:null}));},async maybeSingle(){return {data:rows.find(x=>filters.every(f=>f(x)))||null,error:null};}};return api;}
  const sb={auth:{async getUser(jwt){return jwt==='ok'?{data:{user:{id:'u1'}},error:null}:{data:null,error:{message:'bad'}};}},from:table,
    async rpc(name,args){rpc++;if(name!=='traiter_paiement_confirme')return {data:null,error:{message:'bad rpc'}};devis.paiement_statut='paye';return {data:{ok:true,code:'PAYE',mission:{ok:true,code:'MISSION_CREEE'}},error:null};}};
  return {sb,devis,client,journal,archives,get rpc(){return rpc;}};
}
function req(scenario='success',{origin=PREVIEW,jwt='ok',method='POST',token,devis_id=ID}={}){return new Request('https://x.invalid',{method,headers:{origin,authorization:'Bearer '+jwt,'content-type':'application/json'},body:method==='POST'?JSON.stringify({devis_id:token?undefined:devis_id,token,scenario}):undefined});}
async function call(d,scenario,opts){const r=await traiterPaiementRecette(d.sb,req(scenario,opts));let j=null;try{j=await r.json();}catch{}return {r,j};}

{
 const d=double();const {r}=await call(d,'success',{origin:'https://helixcar.vercel.app'});check('production refusée',r.status===403);
 const pre=await traiterPaiementRecette(d.sb,new Request('https://x.invalid',{method:'OPTIONS',headers:{origin:PREVIEW}}));check('preflight Preview autorisé',pre.status===204&&pre.headers.get('access-control-allow-origin')===PREVIEW);
}
{
 const d=double();const {r}=await call(d,'success',{jwt:'bad'});check('session invalide refusée',r.status===401);
}
{
 const d=double({qa:false});const {r,j}=await call(d,'success');check('dossier réel refusé',r.status===403&&j.code==='QA_ONLY'&&d.rpc===0);
}
{
 const d=double({statut:'envoye',versionAcceptee:null});const {r,j}=await call(d,'success');check('devis non accepté refusé',r.status===409&&j.code==='DEVIS_NON_ACCEPTE'&&d.rpc===0);
}
for(const scenario of ['refused','abandoned','requires_action']){
 const d=double();const {r,j}=await call(d,scenario);check(scenario+' conserve paiement en attente',r.status===200&&j.ok&&j.paiement_statut==='en_attente'&&d.devis.paiement_statut==='en_attente'&&d.rpc===0&&d.journal.length===1,JSON.stringify(j));
}
{
 const d=double();const {r,j}=await call(d,'success');check('succès passe par la RPC serveur et marque payé',r.status===200&&j.code==='PAYE'&&d.rpc===1&&d.devis.paiement_statut==='paye');
}
{
 const d=double({paiement:'paye'});const {r,j}=await call(d,'success');check('rejeu déjà payé sans second traitement',r.status===200&&j.code==='DEJA_PAYE'&&d.rpc===0);
}

for(const scenario of ['success','refused','abandoned','requires_action']){
 const d=double({qa:false});
 d.client.id='951410e8-7104-4256-b46d-59487e73890a';d.client.numero_client='HC-2026-2184';d.devis.client_id=d.client.id;
 const {r,j}=await call(d,scenario);
 check('dossier explicitement autorisé : '+scenario,r.status===200&&j.ok);
}
{
 const d=double({qa:false});d.client.numero_client='HC-2026-2184';
 const {r}=await call(d,'success');
 check('même référence sur un autre dossier refusée',r.status===403&&d.rpc===0);
}
for(const scenario of ['success','refused','abandoned','requires_action']){
 const d=double({qa:false});d.client.id='a134dc9a-3b58-488f-9257-d4f68d7295a6';d.client.numero_client='HC-2026-6218';d.devis.client_id=d.client.id;
 const {r,j}=await call(d,scenario);check('HC-2026-6218 autorisé : '+scenario,r.status===200&&j.ok);
}
{
 const d=double({qa:false});d.client.numero_client='HC-2026-6218';const {r}=await call(d,'success');check('HC-2026-6218 autre identifiant refusé',r.status===403&&d.rpc===0);
}
{
 const d=double({qa:false});d.client.id='a134dc9a-3b58-488f-9257-d4f68d7295a6';d.client.numero_client='HC-2026-6218';d.devis.client_id=d.client.id;d.client.auth_user_id='autre';const {r}=await call(d,'success');check('HC-2026-6218 autre propriétaire refusé',r.status===404&&d.rpc===0);
}
const TOKEN='qa-secret-link-not-a-real-token';
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(TOKEN))).toString('hex');
function linkFixture(options={}){
 const d=double(options);d.client.prenom='TEST-QA-DALBUG';
 d.archives.push({token_hash:hash,devis_id:ID,version:1,envoyee_le:'2026-01-01T00:00:00Z',date_expiration:new Date(Date.now()+3600000).toISOString()});
 return d;
}
for(const scenario of ['success','refused','abandoned','requires_action']){
 const d=linkFixture();const {r,j}=await call(d,scenario,{token:TOKEN,jwt:''});
 check('lien envoyé sans session : '+scenario,r.status===200&&j.ok&&(scenario!=='success'||d.rpc===1));
}
for(const [name,change,code] of [
 ['lien expiré',d=>d.archives[0].date_expiration='2020-01-01',404],
 ['lien non envoyé',d=>d.archives[0].envoyee_le=null,404],
 ['ancienne version',d=>d.archives[0].version=0,409],
 ['devis annulé',d=>d.devis.annule_le='2026-01-01',404],
 ['dossier réel par lien',d=>d.client.prenom='Jean',403]
]){
 const d=linkFixture();change(d);const {r}=await call(d,'success',{token:TOKEN,jwt:''});
 check(name+' refusé sans écriture',r.status===code&&d.rpc===0&&d.journal.length===0);
}
{
 const d=linkFixture();const {r}=await call(d,'success',{token:TOKEN+'incorrect',jwt:'ok'});
 check('lien invalide sans repli sur session',r.status===404&&d.rpc===0);
}
{
 const d=linkFixture();const r=await traiterPaiementRecette(d.sb,new Request('https://x.invalid',{method:'POST',headers:{origin:PREVIEW,'content-type':'application/json'},body:JSON.stringify({token:TOKEN,devis_id:'another-quote',scenario:'success'})}));
 check('le lien ne peut pas payer un autre devis',r.status===404&&d.rpc===0);
}
{
 const d=linkFixture();d.archives.length=0;Object.assign(d.devis,{acceptation_token_hash:hash,version_envoyee:1,date_expiration_token:new Date(Date.now()+3600000).toISOString()});
 const {r}=await call(d,'refused',{token:TOKEN,jwt:''});check('ancien lien envoyé et valide accepté',r.status===200);
}
for (const [id,numero] of [['7de067e0-b9a8-4c2e-a5c1-b35a2c7850b8','HC-2026-3575'],['cb7a6716-554f-46e1-abac-9bafe3dff2d5','HC-2026-1227']]) {
 const fixture=()=>{const d=double({qa:false});Object.assign(d.client,{id,numero_client:numero});d.devis.client_id=id;return d;};
 for(const scenario of ['success','refused','abandoned','requires_action']){const d=fixture();const {r,j}=await call(d,scenario);check(numero+' autorisé '+scenario,r.status===200&&j.ok);}
 {const d=fixture();d.client.id='autre';d.devis.client_id='autre';const {r}=await call(d,'success');check(numero+' autre dossier refusé',r.status===403&&d.rpc===0);}
 {const d=fixture();d.client.auth_user_id='autre';const {r}=await call(d,'success');check(numero+' autre propriétaire refusé',r.status===404&&d.rpc===0);}
 {const d=fixture();d.devis.statut='envoye';const {r}=await call(d,'success');check(numero+' non accepté refusé',r.status===409&&d.rpc===0);}
}
console.log('\n=== '+pass+' PASS / '+fail+' FAIL ===');process.exit(fail?1:0);
