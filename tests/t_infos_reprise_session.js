const fs=require('fs');
const assert=require('node:assert/strict');
const {lancerNavigateur,urlFichier}=require('./env');
const fixture=name=>fs.readFileSync(__dirname+'/'+name,'utf8').split('const INIT = `')[1].split('`;')[0];
(async()=>{const browser=await lancerNavigateur();try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(fixture('t_infos.js').replace('onAuthStateChange: function () {','onAuthStateChange: function (cb) { (window.__authListeners ||= []).push(cb);'));
  await page.goto(urlFichier('dashboard.html'));
  await page.evaluate(async()=>{await finaliserSessionClient(__session.user.email,null,__session.user.id);showPage('client-infos');await loadInfosClient();});
  await page.waitForSelector('#client-infos-liste [data-demande="dem-conv"]');
  assert.equal(await page.locator('.hc-infos-overview').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:require('path').join(require('os').tmpdir(),'helixcar-infos-'+width+'.png')});
  await page.evaluate(async()=>{__reseauCoupe=true;await loadInfosClient();});
  assert.equal(await page.locator('#client-infos-liste [data-demande="dem-conv"]').count(),1);
  assert.match(await page.locator('[data-infos-message]').innerText(),/dernières informations/);
  assert.equal(await page.locator('#client-infos-vide').count(),0);
  await page.evaluate(()=>{__reseauCoupe=false;});
  await page.getByRole('button',{name:'Reprendre le chargement',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-infos-message]'));
  await page.evaluate(async()=>{const orig=sbAuth.from;let n=0;sbAuth.from=function(table){if(table==='v_mes_demandes' && n++===0)throw Error('Failed to fetch');return orig.call(this,table);};await loadInfosClient();sbAuth.from=orig;});
  assert.equal(await page.locator('[data-infos-message]').count(),0);
  // Partial RPC failure must not remove the other dossier or claim completeness.
  await page.evaluate(async()=>{window.__rpc=sbAuth.rpc;sbAuth.rpc=async(n,p)=>n==='informations_demande'&&p.p_client_id==='dem-conv'?{error:{message:'Failed to fetch'}}:__rpc(n,p);await loadInfosClient();});
  assert.match(await page.locator('#client-infos-liste [data-demande="dem-conv"]').innerText(),/reste à actualiser/);
  assert.match(await page.locator('#client-infos-liste [data-demande="dem-nett"]').innerText(),/à compléter/);
  await page.evaluate(async()=>{sbAuth.rpc=__rpc;__session=null;__authListeners.forEach(cb=>cb('SIGNED_OUT',null));});
  assert.equal(await page.locator('#app').evaluate(e=>e.classList.contains('visible')),false);
  assert.equal(await page.locator('#client-infos-liste [data-demande]').count(),0);
  assert.match(await page.locator('#attente-texte').innerText(),/session a été fermée/);
  // No completed/empty state on first-load outage.
  await page.reload();
  await page.evaluate(async()=>{__reseauCoupe=true;await loadInfosClient();});
  assert.equal(await page.locator('#client-infos-vide').count(),0);
  assert.match(await page.locator('[data-infos-message]').innerText(),/connexion a été interrompue/);
  assert.equal(await page.locator('#client-infos-liste').getAttribute('aria-busy'),'false');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS informations: présentation, coupure, reprise, lecture partielle et session '+width);
  await page.close();
 }
 const page=await browser.newPage();
 await page.addInitScript(fixture('t_a01_connexion.js'));
 await page.goto(urlFichier('dashboard.html'));
 for(let pass=0;pass<2;pass++){
  if(pass)await page.reload();
  await page.evaluate(()=>{__roles=['client'];__emettre('INITIAL_SESSION',__session);});
  await page.waitForFunction(()=>document.getElementById('app').classList.contains('visible'));
  assert.equal(await page.evaluate(()=>__journal.filter(x=>x.op==='signOut').length),0);
  assert.equal(await page.evaluate(()=>__retours.length),0);
 }
 await page.evaluate(async()=>{
  const pending=finaliserSessionClient(__session.user.email,null,__session.user.id);
  __session=null;__emettre('SIGNED_OUT',null);await pending;
 });
 assert.equal(await page.locator('#app').evaluate(e=>e.classList.contains('visible')),false);
 console.log('PASS session valide conservée après F5 et ouverture obsolète annulée');
 await page.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
