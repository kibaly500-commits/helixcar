const assert=require('assert'),L=require('./lib');const{lancerNavigateur,RACINE}=require('./env');const http=require('http'),fs=require('fs'),path=require('path');const server=http.createServer((req,res)=>{const p=path.join(RACINE,new URL(req.url,'http://localhost').pathname);fs.readFile(p,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html'});res.end(e?'':data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const browser=await lancerNavigateur();try{
for(const [width,height] of [[390,844],[1280,600],[1280,900]]){
 const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'admin-test',email:'admin@example.test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async(name,args)=>{if(name==='creer_demande_admin'){window.__depot=args;return {data:{id:args.p_demande.id,numero_client:args.p_demande.numero_client,rattachee:true}};}if(name==='rechercher_compte_client_admin')return args.p_numero==='CLI-AAAAA'?{error:{message:'Numéro client introuvable.'}}:{data:{numero:'CLI-A7K9P',profil:{prenom:'Alice',nom:'Client',email:'client@example.test',telephone:'0600000000',type_client:'pro',societe:'Entreprise QA',siret:'90006868500012',source_acquisition:'google'}}};return {data:null};},from:()=>{const chain={select:()=>chain,order:()=>chain,limit:async()=>({data:[]}),eq:()=>chain,maybeSingle:async()=>({data:{numero:'CLI-A7K9P'}})};return chain;}})};});
 await page.goto(url+'/dashboard.html');await page.evaluate(()=>{document.getElementById('login-screen').style.display='none';document.getElementById('app').style.display='flex';currentRole='admin';openNewMission();});
 await page.locator('#admin-numero-client').fill('CLI-AAAAA');await page.locator('#admin-client-chercher').click();await page.waitForFunction(()=>document.getElementById('admin-client-message').textContent.includes('introuvable'));
 assert.equal(await page.locator('#admin-demande-cadre').isVisible(),false);
 await page.locator('#admin-numero-client').fill('cli-a7k9p');await page.locator('#admin-client-chercher').click();await page.waitForSelector('#admin-client-identite:not([hidden])');
 assert.match(await page.locator('#admin-client-identite').innerText(),/Alice Client/);
 const frame=page.frameLocator('#admin-demande-cadre');await frame.locator('#modal-client.open').waitFor();
 assert.equal(await frame.locator('#client-email').inputValue(),'client@example.test');
 assert.equal(await frame.locator('#client-password').inputValue(),'');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/helixcar-admin-form-'+width+'.png',fullPage:true});

 const form=page.frames().find(f=>f.url().includes('admin-client='));
 form.waitForTimeout=page.waitForTimeout.bind(page);
 await L.chooseService(form,'convoyage');
 await form.locator('input[name="trajet-type"]').first().check();
 await form.click('#client-step-next-btn');
 await form.evaluate(()=>{_ouvrirVehicule(0);const b=document.getElementById('veh-0-pc-date').closest('.veh-sous-accordeon');if(b)b.classList.add('ouvert');});
 await page.locator('.hc-admin-demande').evaluate(el=>el.scrollTop=el.scrollHeight);
 await form.locator('[data-field="veh-0-pc-date"]').evaluate(el=>el.scrollIntoView({block:'end'}));
 await form.evaluate(()=>window.scrollBy(0,200));
 await form.locator('[data-field="veh-0-pc-date"]').click({timeout:4000});await page.waitForTimeout(100);
 const visible=await form.evaluate(()=>{const r=document.querySelector('.hc-cal').getBoundingClientRect(),f=frameElement.getBoundingClientRect(),m=frameElement.closest('.modal').getBoundingClientRect();return {top:r.top+f.top,bottom:r.bottom+f.top,clipTop:m.top,clipBottom:m.bottom};});assert(visible.top>=visible.clipTop-1&&visible.bottom<=visible.clipBottom+1,'calendrier entier dans la fenêtre '+width+'x'+height);
 await page.screenshot({path:'/tmp/hc-date-visible-'+width+'-'+height+'.png'});
 await form.locator('#hc-cal-grille button[data-jour]:not([disabled])').last().click({timeout:4000});
 await form.locator('#hc-cal-ok').click();
 assert.match(await form.locator('#veh-0-pc-date').inputValue(),/^\d{4}-\d{2}-\d{2}$/);
 await form.locator('[data-field="veh-0-pc-heure"]').click();await form.locator('.hp-overlay.open').waitFor();
 await page.screenshot({path:'/tmp/hc-admin-calendrier-'+width+'-'+height+'.png',fullPage:true});
 await form.evaluate(()=>_hpFermerPicker());
 await form.locator('[data-field="veh-0-pc-date"]').focus();await page.keyboard.press('Enter');await form.locator('.hc-cal-overlay.open').waitFor();await form.locator('#hc-cal-ok').click();
 await page.evaluate(()=>closeModal('new-mission'));assert.equal(await page.locator('#admin-demande-cadre').getAttribute('src'),null);
 await page.evaluate(()=>{currentRole='client';openNewMission();});assert.equal(await page.locator('#modal-new-mission').evaluate(e=>e.classList.contains('open')),false);
 assert.deepEqual(errors,[]);await page.close();console.log('PASS calendrier admin accessible souris/clavier + horaire '+width+'x'+height);
}
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);process.exit(1)});
