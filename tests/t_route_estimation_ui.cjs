const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/preparation-missions-ui.js','utf8');
const helper=source.slice(source.indexOf('  async function requestRoute('),source.indexOf('  function routeNote('));
const listener=source.slice(source.indexOf("  modal.addEventListener('click',async"),source.indexOf('  const detail=document.createElement'));
async function run(response){
 let click,request,localMessage='',saved=0;
 const p={key:'v1:direct',vehicule_id:'v1',category:'convoyage',organisation:{},remuneration:500};
 const button={id:'',dataset:{estimateFree:'0'},disabled:false,textContent:'Estimer les kilomètres gratuitement',hasAttribute:k=>k==='data-estimate-free'};
 const context={state:{source:{client:{id:'test-client'},empreinte:'current'},plans:[p]},busy:false,generation:1,editVersion:0,
  modal:{addEventListener:(name,fn)=>{click=fn;}},sbAuth:{auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})}},SUPABASE_KEY:'test-key',AbortSignal,
  fetch:async(url,options)=>{request={url,options};assert.equal(button.disabled,true);assert.equal(button.textContent,'Calcul en cours…');if(response instanceof Error)throw response;return response;},
  readEdits(){},render(){},note(){},routeNote:(i,message)=>{localMessage=message;},backup(){saved++;},queueSave(){},HCMissionBudget:{wholeKm:Math.round}};
 vm.runInNewContext(helper+listener,context);
 await click({target:{closest:()=>button}});
 assert.equal(button.disabled,false);assert.equal(context.busy,false);assert.equal(button.textContent,'Estimer les kilomètres gratuitement');
 assert.equal(p.remuneration,500);assert(request.options.signal);assert.equal(request.url,'/api/route-gratuite');
 return {p,localMessage,saved};
}
(async()=>{
 let r=await run({ok:true,json:async()=>({fingerprint:'current',routes:[{km:22.6,minutes:30}]})});
 assert.equal(r.p.distance,23);assert.equal(r.p.distance_aller,23);assert.equal(r.saved,1);assert.match(r.localMessage,/23 km/);
 r=await run({ok:false,json:async()=>({error:'Adresse non reconnue'})});assert.match(r.localMessage,/Adresse non reconnue/);assert.equal(r.saved,0);
 r=await run({ok:false,json:async()=>{throw Error('HTML response');}});assert.match(r.localMessage,/ne répond pas correctement/);
 r=await run(Object.assign(new Error('timeout'),{name:'TimeoutError'}));assert.match(r.localMessage,/Délai du calcul dépassé/);
 console.log('PASS clic estimation : chargement, distance aller, sauvegarde, erreur IGN visible, réponse HTML, délai et bouton réactivé.');
})().catch(e=>{console.error(e);process.exitCode=1;});
