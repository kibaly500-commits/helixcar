const assert=require('node:assert/strict'),{lancerNavigateur,urlFichier}=require('./env');
(async()=>{const browser=await lancerNavigateur();try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'admin-test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async()=>({data:null})})};});
 await page.goto(urlFichier('dashboard.html'));
 await page.evaluate(()=>{
  document.getElementById('login-screen').style.display='none';document.getElementById('app').classList.add('visible');_hcNavigationRole='admin';
  const c={id:'client-1',type_service:'stockage',stockage_acheminement:'helixcar',stockage_sortie:'helixcar',stockage_date_debut:'2026-11-08',stockage_date_fin:'2026-11-10'};
  const v={id:'veh1',position:1,marque_modele:'Renault Clio',immatriculation:'AA-123-BB',vin:'VIN',adresse_depart_rue:'3 rue Exemple',code_postal_depart:'75001',ville_depart:'Paris',adresse_arrivee_rue:'8 rue Livraison',code_postal_arrivee:'78000',ville_arrivee:'Versailles',date_prise_en_charge:'2026-11-08',date_livraison:'2026-11-10',heure_prise_en_charge:'09:00',heure_livraison:'14:00'};
  const plans=HCPreparation.build(c,[v],HCPlanningCalcul.POINT);plans[0].mission.date_livraison='2026-11-08T10:45';plans[0].heure_remise='10:45';plans[1].mission.date_prise_en_charge='2026-11-10T12:15';plans[1].heure_retrait='12:15';
  window.__rows=plans.map((plan,i)=>({id:'p'+i,client_id:c.id,cle:plan.key,empreinte:'hash',plan,clients:{numero_client:'HC-QA'},missions:{convoyeurs:{prenom:'Partenaire',nom:'Test'}}}));
  window.__states=[];window.__calls=[];window.__source={client:c,vehicules:[v],reference:'DEV-QA',empreinte:'hash',point_remise:HCPlanningCalcul.POINT,brouillons:__rows};
  window.__traffic={provider:'Google Maps',kind:'avant_stockage',km:40,minutes:60,margin:45,calculatedAt:new Date().toISOString(),suggestion:'2026-11-08T10:45',warnings:[]};
  sbFetchToutePage=async path=>path.startsWith('preparations')?__rows:__states;
  sbAuth.rpc=async(name,args)=>{
   __calls.push({name,args});if(name==='source_preparation_missions')return {data:__source};
   if(name==='enregistrer_preparation_missions'){__source.brouillons=args.p_plans.map((plan,i)=>({id:'p'+i,cle:plan.key,empreinte:'hash',plan}));return {data:__source};}
   if(name==='action_planning_helixcar'){
    const row=__rows.find(x=>x.id===args.p_preparation_id);let state=__states.find(x=>x.preparation_id===row.id);if(!state){state={preparation_id:row.id,revision:0};__states.push(state);}
    if(args.p_action==='confirmer'){state.horaire_confirme=row.plan.kind==='avant_stockage'?row.plan.mission.date_livraison:row.plan.mission.date_prise_en_charge;state.empreinte_confirmee='hash';}else state.cles_effectuees_le=new Date().toISOString();state.revision++;return {data:state};
   }
  };
  window.fetch=async()=>({ok:!window.__trafficFailed,json:async()=>window.__trafficFailed?{error:'Le calcul avec trafic n’est pas encore connecté.'}:{estimate:__traffic,fingerprint:'hash'}});
  window.confirm=()=>true;showPage('admin-planning');
 });
 await page.waitForSelector('[data-planning-id="p0"]');
 assert.equal(await page.locator('[data-planning-id]').count(),2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const first=page.locator('[data-planning-id="p0"]');assert.match(await first.innerText(),/3 rue Exemple, 75001 Paris/);
 assert.equal(await first.locator('[data-planning-action="cles"]').isDisabled(),true);
 await first.locator('[data-planning-action="confirmer"]').click();assert.match(await first.innerText(),/Horaire confirmé/);
 await first.locator('[data-planning-action="trafic"]').click();await page.waitForFunction(()=>document.querySelector('.hc-planning-feedback').textContent.includes('inchangé'));
 assert.equal(await page.evaluate(()=>__states[0].horaire_confirme),'2026-11-08T10:45');
 await page.evaluate(()=>{__rows.push({...__rows[0],id:'p2'});__states.push({preparation_id:'p2',horaire_confirme:'2026-11-08T10:50',empreinte_confirmee:'hash'});});
 await page.locator('#hc-planning-refresh').click();assert.match(await first.innerText(),/chevauche/);
 await page.screenshot({path:'/tmp/helixcar-planning-'+width+'.png',fullPage:true});
 await first.locator('[data-planning-action="cles"]').click();assert.match(await first.innerText(),/Clés reçues le/);
 await page.locator('#hc-planning-refresh').click();assert.match(await first.innerText(),/Clés reçues le/);
 await page.locator('#hc-planning-kind').selectOption('apres_stockage');assert.equal(await page.locator('[data-planning-id]').count(),1);
 await page.locator('#hc-planning-kind').selectOption('');
 await first.locator('[data-planning-action="ouvrir"]').click();
 assert.equal(await page.locator('[data-field="heure_prise_en_charge"]').count(),0);
 assert.equal(await page.locator('[data-field="heure_remise"]').count(),1);assert.equal(await page.locator('[data-field="heure_retrait"]').count(),1);
 await page.locator('[data-prep-traffic="0"]').click();await page.waitForSelector('[data-prep-apply="0"]');
 assert.equal(await page.locator('[data-field="distance"]').first().inputValue(),'40');
 await page.locator('[data-field="planning_margin"]').first().fill('60');await page.locator('[data-prep-apply="0"]').click();assert.match(await page.locator('#hc-prep-message').innerText(),/battement a changé/);
 await page.locator('[data-field="planning_margin"]').first().fill('45');await page.locator('[data-prep-apply="0"]').click();assert.match(await page.locator('#hc-prep-message').innerText(),/Horaire repris/);
 await page.locator('[data-prep-save]').click();assert.equal(await page.evaluate(()=>__source.brouillons[0].plan.mission.date_livraison),'2026-11-08T10:45');
 await page.evaluate(()=>{window.__trafficFailed=true;});await page.locator('[data-prep-traffic="0"]').click();assert.match(await page.locator('#hc-prep-message').innerText(),/pas encore connecté/);
 await page.evaluate(()=>window.dispatchEvent(new Event('hc-session-fermee')));assert.equal(await page.locator('[data-planning-id]').count(),0);
 assert.deepEqual(errors,[]);await page.close();console.log('PASS planning UI '+width+' : filtres, adresses privées, confirmation, trafic sans déplacement du RDV, conflits, clés, sauvegarde, marge et déconnexion');
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
