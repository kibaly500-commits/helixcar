const assert=require('node:assert/strict'),path=require('path');
const {lancerNavigateur}=require('./env');
(async()=>{const browser=await lancerNavigateur();try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="hc-retards-planning"></div><div id="missions"><span data-retard-mission="m1"></span><span data-retard-mission="m2"></span></div>');
 await page.evaluate(()=>{
 window.currentRole='convoyeur';window.__calls=[];window.__fail=false;window.__rdv={mission_id:'m1',preparation_id:'p1',etape:'avant_stockage',horaire_prevu:'2099-01-01T13:00:00',alerte:null};
 window.escapeHtml=v=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.openModal=id=>document.getElementById('modal-'+id).classList.add('open');window.closeModal=id=>document.getElementById('modal-'+id).classList.remove('open');
 window.sbAuth={rpc:async(name,args)=>{__calls.push({name,args});if(__fail)return {error:{message:'Indisponible'}};if(name==='lister_rendezvous_retard_convoyeur')return {data:[__rdv]};if(name==='signaler_retard_convoyage')__rdv.alerte={arrivee_estimee:args.p_arrivee_estimee};return {data:{ok:true}};}};
 window.loadMissionsConvoyeur=()=>HCRetards.mount(document.getElementById('missions'));
 window.sbFetchToutePage=async()=>[{id:'a1',revision:2,horaire_prevu:'2099-01-01T13:00',arrivee_estimee:'2099-01-01T14:00',motif:'<img src=x onerror=alert(1)>',missions:{reference_courte:'M1'},convoyeurs:{prenom:'Test',nom:'QA'}}];window.afficherCompteurMenu=(id,n)=>{window.__badge=n;};
 });
 await page.addScriptTag({path:path.resolve('assets/retards-convoyage.js')});
 await page.evaluate(()=>loadMissionsConvoyeur());assert.equal(await page.locator('[data-retard-mission="m2"] button').count(),0);
 await page.getByText('Signaler un retard',{exact:true}).click();
 await page.locator('[name=arrivee]').fill('2099-01-01T14:00');await page.locator('[name=motif]').fill('Bouchon');await page.getByText('Alerter HelixCar',{exact:true}).click();
 await page.getByText('Actualiser mon retard',{exact:true}).waitFor();
 assert.match(await page.locator('[data-retard-message]').textContent(),/reçu/);
 const calls=await page.evaluate(()=>__calls);assert.equal(calls.filter(c=>c.name==='signaler_retard_convoyage').length,1);assert.equal(calls.find(c=>c.name==='signaler_retard_convoyage').args.p_horaire_prevu,'2099-01-01T13:00:00');
 await page.evaluate(async()=>{currentRole='admin';await HCRetards.loadAdmin()});assert.equal(await page.locator('#hc-retards-planning img').count(),0);assert.equal(await page.evaluate(()=>__badge),1);
 await page.getByText('Marquer comme pris en compte',{exact:true}).click();assert.ok(await page.evaluate(()=>__calls.some(c=>c.name==='traiter_retard_convoyage'&&c.args.p_revision===2)));
 await page.evaluate(()=>dispatchEvent(new Event('hc-session-fermee')));assert.equal(await page.locator('#hc-retards-planning').textContent(),'');assert.deepEqual(errors,[]);
 console.log('PASS interface : bouton ciblé, envoi, confirmation, alerte admin, motif échappé, prise en compte, déconnexion.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
