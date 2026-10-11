const {lancerNavigateur}=require('./env.js');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),acorn=require('acorn');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'dashboard.html'),'utf8');
let loader, demandesLoader;
for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
 const ast=acorn.parse(m[1],{ecmaVersion:'latest'});
 const f=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='loadMissionsClient');
 if(f)loader=m[1].slice(f.start,f.end);
 const d=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='loadDemandesClient');if(d)demandesLoader=m[1].slice(d.start,d.end);
}
(async()=>{
 const browser=await lancerNavigateur();
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="app"><div class="topbar"></div><section class="page active" id="page-client-missions"><input id="edition"><details id="details-mission" open><summary>Détails</summary><p>Suivi</p></details><span id="client-missions-sub"></span><table><tbody id="client-missions-table"><tr><td>Avant</td></tr></tbody></table></section></div>');
  await page.addScriptTag({content:`
   var currentRole='client',SUPABASE_URL='https://example.invalid';
   var reads=0,delay=0,rows=[],listeners=[],removed=0;
   window.fetch=async()=>new Response('{}',{status:200});
   var sbAuth={auth:{onAuthStateChange(cb){window.authCallback=cb;},getSession:async()=>({data:{session:{user:{id:'user-a'},access_token:'fake'}}})},realtime:{setAuth:async()=>{}},channel(topic,config){if(!config.config.private)throw Error('Public channel');return {on(type,event,cb){listeners.push({topic,cb});return this;},subscribe(){return this;}};},removeChannel(){removed++;}};
   async function chargerMissionsSuiviClient(){reads++;await new Promise(r=>setTimeout(r,delay));return rows;}
   function escapeHtml(x){return String(x);}
   function _missionPrestationClient(){return 'Convoyage';}function _missionLieuClient(){return 'Paris';}function _missionDateClient(){return '';}
   function _partenaireMissionClient(){return '';}function _phaseMissionClient(m){return m.statut;}
   ${loader}
  `});
  await page.addScriptTag({path:path.join(root,'assets/synchronisation-espaces.js')});
  await page.waitForFunction(()=>reads===1);
  await page.waitForFunction(()=>document.querySelector('tbody').textContent.includes('Aucune mission'));
  await page.evaluate(()=>{rows=[{id:'m1',reference:'NOUVEAU',statut:'acceptee'}];for(let i=0;i<20;i++)listeners[0].cb();});
  await page.waitForFunction(()=>document.querySelector('tbody').textContent.includes('NOUVEAU'));
  assert.equal(await page.evaluate(()=>reads),2,'rafale regroupée en une lecture');
  assert.equal(await page.locator('#details-mission').getAttribute('open'),'','accordéon conservé');
  await page.evaluate(()=>{delay=400;rows=[{id:'m1',reference:'DISTANT',statut:'terminee'}];HCSync.request(0);});
  await page.waitForFunction(()=>reads===3);
  assert.match(await page.locator('tbody').textContent(),/NOUVEAU/,'pas de clignotement Chargement');
  await page.locator('#edition').fill('ma saisie');
  await page.waitForTimeout(500);
  assert.match(await page.locator('tbody').textContent(),/NOUVEAU/,'réponse tardive ignorée pendant la saisie');
  assert.equal(await page.locator('#edition').inputValue(),'ma saisie');
  await page.locator('#edition').blur();
  await page.evaluate(()=>listeners[0].cb());await page.waitForTimeout(800);
  assert.equal(await page.evaluate(()=>reads),3,'brouillon protégé même après perte du focus');
  await page.evaluate(()=>fetch(SUPABASE_URL+'/rest/v1/clients',{method:'PATCH',body:'{}'}));
  await page.waitForFunction(()=>document.querySelector('tbody').textContent.includes('DISTANT'));
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  const hiddenReads=await page.evaluate(()=>reads);
  await page.evaluate(()=>HCSync.request(0));await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>reads),hiddenReads,'aucune lecture en arrière-plan');
  assert.ok(await page.evaluate(()=>removed>0),'abonnements fermés en arrière-plan');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(n=>reads>n,hiddenReads);
  await page.waitForTimeout(100);
  await page.addScriptTag({content:`var _demandesClientGeneration=0;async function chargerDemandesClient(){return [{id:'d1',type_service:'stockage'}];}async function chargerDevisClient(){return [];}async function chargerInformationsDemande(){return [];}function _presentationDemandeClient(){return {groupe:'preparation',message:'Prête'};}function _aStockage(){return false;}function _etatDevisClient(){return null;}function _badgesSuiviDemandeClient(){return [];}function _libelleServiceClient(){return 'Stockage';}function actionHtml(){return '';}
${demandesLoader}`});
  await page.evaluate(()=>{document.querySelector('.page').id='page-client-dashboard';document.querySelector('.page').innerHTML='<div id="client-demandes-liste"></div>';window.dispatchEvent(new Event('hc:page'));HCSync.request(0);});
  await page.waitForSelector('.hc-demande-details');
  await page.locator('.hc-demande-details summary').click();
  await page.locator('.hc-demandes-accordeon > summary').click();
  await page.waitForTimeout(100);
  await page.evaluate(()=>HCSync.request(0));await page.waitForTimeout(250);
  assert.equal(await page.locator('.hc-demande-details').getAttribute('open'),'','détails restaurés après remplacement du contenu');
  assert.equal(await page.locator('.hc-demandes-accordeon').getAttribute('open'),null,'rubrique fermée conservée');
  await page.evaluate(()=>authCallback('SIGNED_OUT',null));await page.waitForTimeout(100);
  const endedReads=await page.evaluate(()=>reads);
  await page.evaluate(()=>HCSync.request(0));await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>reads),endedReads,'arrêt à la déconnexion');
  assert.deepEqual(errors,[]);
  console.log('PASS - signal privé, regroupement, saisie pendant requête, brouillon, sauvegarde, accordéon, arrière-plan, reprise et déconnexion.');
  console.log('=== 1 PASS / 0 FAIL ===');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
