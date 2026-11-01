const assert=require('assert'),L=require('./lib');const{lancerNavigateur,urlFichier}=require('./env');
(async()=>{const browser=await lancerNavigateur();try{
for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'admin-test',email:'admin@example.test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async(name,args)=>{if(name==='creer_demande_admin'){window.__depot=args;return {data:{id:args.p_demande.id,numero_client:args.p_demande.numero_client,rattachee:true}};}if(name==='rechercher_compte_client_admin')return args.p_numero==='CLI-AAAAA'?{error:{message:'Numéro client introuvable.'}}:{data:{numero:'CLI-A7K9P',profil:{prenom:'Alice',nom:'Client',email:'client@example.test',telephone:'0600000000',type_client:'pro',societe:'Entreprise QA',siret:'90006868500012',source_acquisition:'google'}}};return {data:null};},from:()=>{const chain={select:()=>chain,order:()=>chain,limit:async()=>({data:[]}),eq:()=>chain,maybeSingle:async()=>({data:{numero:'CLI-A7K9P'}})};return chain;}})};});
 await page.goto(urlFichier('dashboard.html'));await page.evaluate(()=>{document.getElementById('login-screen').style.display='none';document.getElementById('app').style.display='flex';currentRole='admin';openNewMission();});
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
 await L.chooseService(form,'nettoyage');await L.fillNettoyageStep2(form,1,{citadine:1},'preparation_complete');
 await form.click('#client-step-next-btn');await L.fillNettoyageStep4(form,{contactType:'moi'});await form.click('#client-step-next-btn');
 await form.evaluate(()=>submitClientForm());
 const depot=await form.evaluate(()=>window.__depot);
 assert(depot,'soumission du formulaire admin complète');assert.equal(depot.p_numero,'CLI-A7K9P');assert.equal(depot.p_demande.email,'client@example.test');assert.equal(depot.p_demande.type_service,'nettoyage');
 await page.evaluate(()=>closeModal('new-mission'));assert.equal(await page.locator('#admin-demande-cadre').getAttribute('src'),null);
 await page.evaluate(()=>{currentRole='client';openNewMission();});assert.equal(await page.locator('#modal-new-mission').evaluate(e=>e.classList.contains('open')),false);
 assert.deepEqual(errors,[]);await page.close();console.log('PASS admin + formulaire partagé '+width);
}
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
