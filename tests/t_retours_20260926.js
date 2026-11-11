// Régressions : période terminée, palette, garde précoce et lecture après restauration Auth.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const index = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');
const dashboard = fs.readFileSync(require('path').join(__dirname, '../dashboard.html'), 'utf8');
const loader = dashboard.slice(dashboard.indexOf('var _hcDemandesLecture = null;'), dashboard.indexOf('// LOT Q02'));
let pass = 0;
function check(name, condition) { assert.ok(condition, name); console.log('PASS - '+name); pass++; }
async function scenario(replies, session=true) {
  let calls=0;
  const sbAuth = {
    auth:{getSession:async()=>({data:{session:session?{user:{id:'test'}}:null}})},
    from:()=>({select:()=>({order:async()=>{ const r=replies[Math.min(calls++,replies.length-1)]; if(r instanceof Error) throw r; return r; }})})
  };
  const c=vm.createContext({sbAuth,_sbAuthPret:()=>true,setTimeout:cb=>setTimeout(cb,0)});
  vm.runInContext(loader,c);
  return {c,calls:()=>calls};
}
(async()=>{
  const ok={data:[{id:'test-nettoyage',type_service:'nettoyage'}],error:null};
  let s=await scenario([{status:503,error:{message:'Service unavailable'}},ok]);
  const r=await Promise.all([s.c.chargerDemandesClient(),s.c.chargerDemandesClient()]);
  check('Deux lectures simultanées partagent une seule reprise après panne',s.calls()===2 && r.every(a=>a[0].id==='test-nettoyage'));
  await s.c.chargerDemandesClient();check('Les lectures ultérieures relisent le serveur',s.calls()===3);
  s=await scenario([{status:401,error:{message:'Unauthorized'}},ok]);
  check('401 : reprise bornée après vérification de session', (await s.c.chargerDemandesClient()).length===1 && s.calls()===2);
  s=await scenario([{status:403,error:{message:'Forbidden'}}]);
  await assert.rejects(s.c.chargerDemandesClient());check('Un refus de droits reste une erreur',s.calls()===1);
  s=await scenario([ok],false);await assert.rejects(s.c.chargerDemandesClient());check('Aucune lecture anonyme pendant la restauration',s.calls()===0);
  s=await scenario([new Error('Failed to fetch')]);await assert.rejects(s.c.chargerDemandesClient());check('Une panne persistante reste visible après une seule reprise',s.calls()===2);
  const guard=index.match(/<script id="hc-confirmation-precoce">([\s\S]*?)<\/script>/)[1];
  for(const type of ['signup','email_change','magiclink','recovery','']) {
    let hidden=false;const c=vm.createContext({URLSearchParams,location:{hash:type?'#type='+type:''},window:{},document:{documentElement:{classList:{add:()=>{hidden=true;}}}}});
    vm.runInContext(guard,c);check('Garde visuelle '+(type||'vitrine normale'),hidden===['signup','email_change','magiclink'].includes(type));
  }
  check('La garde précède les ressources de la vitrine',index.indexOf('hc-confirmation-precoce')<index.indexOf('<link'));
  console.log(`\n=== ${pass} PASS / 0 FAIL ===`);
})().catch(e=>{console.error(e);process.exitCode=1;});
