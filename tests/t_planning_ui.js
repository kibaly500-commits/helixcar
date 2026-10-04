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
  window.__blocked={};window.__states=[];window.__calls=[];window.__source={client:c,vehicules:[v],reference:'DEV-QA',empreinte:'hash',point_remise:HCPlanningCalcul.POINT,brouillons:__rows};
  window.__traffic={provider:'Google Maps',kind:'avant_stockage',km:40,minutes:60,margin:45,calculatedAt:new Date().toISOString(),suggestion:'2026-11-08T10:45',warnings:[]};
  window.__clients=[];
  sbFetchToutePage=async path=>path.startsWith('clients?')?__clients:path.startsWith('preparations')?[...__rows,{...__rows[0],id:'direct',plan:{...__rows[0].plan,kind:'direct'}},{...__rows[0],id:'cancelled',missions:{statut:'annulee'}}]:__states;
  sbAuth.rpc=async(name,args)=>{
   __calls.push({name,args});if(name==='source_preparation_missions'){
    if(__blocked[args.p_client_id])return {error:{message:__blocked[args.p_client_id]}};
    const client=__clients.find(c=>c.id===args.p_client_id);
    return {data:client?{client,vehicules:client.vehicules,point_remise:HCPlanningCalcul.POINT}:__source};
   }
   if(name==='enregistrer_preparation_missions'){__source.brouillons=args.p_plans.map((plan,i)=>({id:'p'+i,cle:plan.key,empreinte:'hash',plan}));return {data:__source};}
   if(name==='action_planning_helixcar'){
    const row=__rows.find(x=>x.id===args.p_preparation_id);let state=__states.find(x=>x.preparation_id===row.id);if(!state){state={preparation_id:row.id,revision:0};__states.push(state);}
    if(args.p_action==='confirmer'){state.horaire_confirme=row.plan.kind==='avant_stockage'?row.plan.mission.date_livraison:row.plan.mission.date_prise_en_charge;state.empreinte_confirmee='hash';}else state.cles_effectuees_le=new Date().toISOString();state.revision++;return {data:state};
   }
  };
  window.fetch=async()=>{throw Error('Aucun appel externe attendu en planning manuel');};
  window.confirm=()=>true;showPage('admin-planning');
 });
 await page.waitForSelector('[data-planning-id="p0"]');
 assert.equal(await page.locator('[data-planning-id]').count(),2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const first=page.locator('[data-planning-id="p0"]');assert.match(await first.innerText(),/3 rue Exemple, 75001 Paris/);
 assert.equal(await first.locator('[data-planning-action="cles"]').isDisabled(),true);
 await first.locator('[data-planning-action="confirmer"]').click();assert.match(await first.innerText(),/Horaire confirmé/);
 assert.equal(await page.locator('[data-planning-action="trafic"]').count(),0);
 assert.match(await first.innerText(),/Votre intervention : réceptionner/);
 assert.match(await first.innerText(),/Prise en charge chez le client/);assert.match(await first.innerText(),/09:00/);assert.match(await first.innerText(),/45 minutes de battement/);
 const outgoing=page.locator('[data-planning-id="p1"]');assert.match(await outgoing.innerText(),/Livraison attendue chez le client/);assert.match(await outgoing.innerText(),/14:00/);assert.match(await outgoing.innerText(),/8 rue Livraison, 78000 Versailles/);assert.match(await outgoing.innerText(),/− 45 minutes/);
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
 assert.equal(await page.locator('[data-prep-traffic], [data-prep-apply], [data-field="planning_margin"]').count(),0);
 assert.match(await page.locator('#hc-prep-body').innerText(),/45 minutes de battement/);
 await page.locator('[data-field="heure_remise"]').fill('11:15');
 await page.locator('[data-field="heure_retrait"]').fill('12:30');
 await page.locator('[data-prep-save]').click();
 assert.equal(await page.evaluate(()=>__source.brouillons[0].plan.mission.date_livraison),'2026-11-08T11:15');
 assert.equal(await page.evaluate(()=>__source.brouillons[1].plan.mission.date_prise_en_charge),'2026-11-10T12:30');
 assert.equal(await page.evaluate(()=>__source.brouillons[0].plan.mission.date_prise_en_charge),'2026-11-08T09:00');
 await page.locator('#hc-prep-close').click();
 await page.evaluate(()=>{const c={id:'self',type_service:'stockage',prenom:'Marie',nom:'Client',numero_client:'HC-SELF',nb_vehicules:2,stockage_acheminement:'depot_client',stockage_sortie:'recuperation_client',stockage_date_debut:'2026-11-08',stockage_date_fin:'2026-11-10',stockage_heure_entree:'08:30',stockage_heure_sortie:'19:00',devis:[{statut:'accepte',paiement_statut:'paye'}],vehicules:[{id:'v1',marque_modele:'Clio client',immatriculation:'CLIENT-1',livraison_apres_stockage:false,heure_recuperation_client:'16:00'},{id:'v2',marque_modele:'Golf client',immatriculation:'CLIENT-2',vin:'VIN-CLIENT-2',ville_arrivee:'Paris',date_livraison:'2026-11-10',heure_livraison:'20:00',livraison_apres_stockage:true}]};__clients=[c,{...c,id:'unpaid',devis:[]},{...c,id:'cancelled',statut:'annulee'},{...c,id:'direct',type_service:'convoyage'}];});
 await page.locator('#hc-planning-refresh').click();
 const self=page.locator('[data-planning-id^="client:"]');assert.equal(await self.count(),3);
 assert.equal(await self.locator('[data-planning-action="dossier"]').count(),0);
 await self.first().locator('summary').click();assert.match(await self.first().innerText(),/Téléphone non renseigné/);
 assert.doesNotMatch(await page.locator('#page-admin-planning').innerText(),/Générer le devis|Créer le devis|Voir la demande/);
 assert.match(await self.first().innerText(),/Marie Client/);assert.match(await self.first().innerText(),/08:30/);
 await page.locator('#hc-planning-kind').selectOption('apres_stockage');
 assert.equal(await self.count(),1);assert.match(await self.innerText(),/16:00/);assert.doesNotMatch(await self.innerText(),/19:00/);
 assert.equal(await self.locator('[data-planning-action="confirmer"], [data-planning-action="cles"]').count(),0);
 await page.locator('#hc-planning-day').fill('2026-11-08');assert.equal(await self.count(),0);
 await page.locator('#hc-planning-kind').selectOption('');assert.equal(await self.count(),2);
 await page.evaluate(()=>{__clients[0].stockage_heure_entree=null;});await page.locator('#hc-planning-refresh').click();assert.match(await self.first().innerText(),/Heure à préciser/);
 await page.evaluate(()=>{__clients[0].nb_vehicules=1;__clients[0].vehicules=[__clients[0].vehicules[0]];__clients[0].vehicules[0].heure_recuperation_client='17:00';__clients[0].stockage_heure_sortie='18:15';});
 await page.locator('#hc-planning-day').fill('');await page.locator('#hc-planning-kind').selectOption('apres_stockage');await page.locator('#hc-planning-refresh').click();assert.equal(await self.count(),1);assert.match(await self.innerText(),/18:15/);assert.doesNotMatch(await self.innerText(),/17:00/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#hc-planning-kind').selectOption('');
 for(const message of ['Dossier incomplet : informations attendues','Dossier incomplet : informations transmises à vérifier','Le devis doit être accepté et le paiement confirmé']){
  await page.evaluate(message=>{__blocked={'self':message,'client-1':message};},message);
  await page.locator('#hc-planning-refresh').click();await page.waitForFunction(()=>document.getElementById('hc-planning-list').innerText.includes('Seuls les dossiers'));
  assert.equal(await page.locator('[data-planning-id]').count(),0);
 }
 await page.evaluate(()=>{__blocked={};});await page.locator('#hc-planning-refresh').click();await page.waitForSelector('[data-planning-id="p0"]');assert.equal(await self.count(),2);
 // Un ancien brouillon de stockage court ne doit plus créer un passage fictif.
 await page.evaluate(()=>{__source.vehicules[0].heure_livraison='09:00';});
 await page.locator('#hc-planning-refresh').click();
 assert.equal(await page.locator('[data-planning-id="p0"], [data-planning-id="p1"]').count(),0);
 assert.equal(await self.count(),2);
 await page.evaluate(()=>ouvrirPreparationDemande('client-1'));
 assert.equal(await page.locator('[data-field="heure_remise"], [data-field="heure_retrait"]').count(),0);
 assert.match(await page.locator('#hc-prep-body').innerText(),/Par le même convoyeur/);
 await page.locator('#hc-prep-close').click();
 // Les missions déjà publiées conservent leur organisation existante.
 await page.evaluate(()=>{__source.brouillons[0].mission_id='mission-publiee';__rows[0].mission_id='mission-publiee';});
 await page.locator('#hc-planning-refresh').click();
 assert.equal(await page.locator('[data-planning-id="p0"], [data-planning-id="p1"]').count(),2);
 await page.evaluate(()=>{__blocked={'self':'Network error'};});await page.locator('#hc-planning-refresh').click();await page.waitForFunction(()=>document.getElementById('hc-planning-list').innerText.includes('vérification des dossiers'));
 assert.equal(await page.locator('[data-planning-id]').count(),0);
 await page.locator('#hc-planning-kind').selectOption('apres_stockage');assert.equal(await page.locator('[data-planning-id]').count(),0);
 await page.evaluate(()=>window.dispatchEvent(new Event('hc-session-fermee')));assert.equal(await page.locator('[data-planning-id]').count(),0);
 assert.deepEqual(errors,[]);await page.close();console.log('PASS planning UI '+width+' : filtres, adresses privées, confirmation, conflits, clés, horaires manuels sauvegardés et déconnexion');
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
