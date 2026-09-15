import {traiterPaiementRecette} from '../supabase/functions/paiement-recette/index.ts';

let pass=0,fail=0;const check=(n,c,d='')=>{console.log((c?'PASS':'FAIL')+' - '+n+(c?'':' ['+d+']'));c?pass++:fail++;};
const PREVIEW='https://helixcar-i89b.vercel.app';
const ID='d0d0d0d0-0000-4000-8000-000000000001';

function double({qa=true,statut='accepte',paiement='en_attente',version=1,versionAcceptee=1}={}){
  const devis={id:ID,reference:'DEV-QA',client_id:'c1',prix:450,statut,paiement_statut:paiement,version,version_acceptee:versionAcceptee};
  const client={id:'c1',auth_user_id:'u1',numero_client:'HC-QA',prenom:qa?'TEST-QA-CLAUDE-HELIXCAR':'Jean',nom:'Client',email:'qa@example.invalid'};
  const journal=[];let rpc=0;
  function table(nom){let rows=nom==='devis'?[devis]:nom==='clients'?[client]:journal;let payload=null;
    const filters=[];const api={select(){return api;},eq(k,v){filters.push(x=>x[k]===v);return api;},insert(v){payload=v;return Promise.resolve((journal.push(v),{data:v,error:null}));},async maybeSingle(){return {data:rows.find(x=>filters.every(f=>f(x)))||null,error:null};}};return api;}
  const sb={auth:{async getUser(jwt){return jwt==='ok'?{data:{user:{id:'u1'}},error:null}:{data:null,error:{message:'bad'}};}},from:table,
    async rpc(name,args){rpc++;if(name!=='traiter_paiement_confirme')return {data:null,error:{message:'bad rpc'}};devis.paiement_statut='paye';return {data:{ok:true,code:'PAYE',mission:{ok:true,code:'MISSION_CREEE'}},error:null};}};
  return {sb,devis,client,journal,get rpc(){return rpc;}};
}
function req(scenario='success',{origin=PREVIEW,jwt='ok',method='POST'}={}){return new Request('https://x.invalid',{method,headers:{origin,authorization:'Bearer '+jwt,'content-type':'application/json'},body:method==='POST'?JSON.stringify({devis_id:ID,scenario}):undefined});}
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
console.log('\n=== '+pass+' PASS / '+fail+' FAIL ===');process.exit(fail?1:0);
