const assert=require('assert'),L=require('./lib');
(async()=>{const browser=await L.launch();try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async()=>({data:null})})};});
 await page.goto(L.urlFichier('dashboard.html'));
 await page.evaluate(()=>{
  document.getElementById('login-screen').style.display='none';document.getElementById('app').classList.add('visible');_hcNavigationRole='admin';
  const client={id:'c1',type_service:'convoyage',prenom:'Client',nom:'Test'};
  const v={id:'v1',position:1,type_vehicule:'berline',marque_modele:'Tesla Model 3',immatriculation:'AA-123-BB',vin:'VIN1',motorisation:'Électrique',adresse_depart_rue:'12 rue Départ',code_postal_depart:'75001',ville_depart:'Paris',adresse_arrivee_rue:'15 rue Arrivée',ville_arrivee:'Caen',date_prise_en_charge:'2026-11-08',heure_prise_en_charge:'09:00',date_livraison:'2026-11-08',heure_livraison:'14:00',restitution_concernee:true,restit_destination:'stockage',restit_recuperation_client:true,restit_adresse_rue:'Point de stockage HelixCar',restit_ville:'Noisy-le-Grand',restit_marque_modele:'Renault Clio',restit_immatriculation:'CC-456-DD',restit_vin:'VIN2',restit_motorisation:'Essence',restit_date:'2026-11-09',restit_heure_type:'creneau',restit_creneau_debut:'10:00',restit_creneau_fin:'12:00',restit_contact_nom:'SECRET-RECUPERATEUR',restit_contact_tel:'0600000000'};
  window.__source={client,vehicules:[v],point_remise:HCPlanningCalcul.POINT,reference:'DEV-TEST',devis_id:'dv1',empreinte:'hash',brouillons:[]};
  window.__states=[];window.__saves=0;
  sbAuth.from=()=>{const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{prix:222}})};return q;};
  sbAuth.rpc=async(name,args)=>{
   if(name==='source_preparation_missions')return {data:__source};
   if(name==='enregistrer_preparation_missions'){__saves++;__source.brouillons=args.p_plans.map(p=>({id:'prep1',client_id:'c1',cle:p.key,empreinte:'hash',plan:p,annonce:p.public,clients:{numero_client:'HC-TEST'}}));return {data:__source};}
   if(name==='action_restitution_helixcar'){
    let s=__states[0]||{preparation_id:'prep1',revision:0};const p=__source.brouillons[0].plan;
    if(args.p_action==='confirmer_reception')s.reception_confirmee=p.retour_reception;
    if(args.p_action==='confirmer_remise')s.remise_confirmee=p.retour_remise;
    if(args.p_action==='recevoir')s.reception_effectuee_le=new Date().toISOString();
    if(args.p_action==='remettre')s.remise_effectuee_le=new Date().toISOString();
    s.revision++;__states=[s];return {data:s};
   }
   throw Error('RPC inattendue '+name);
  };
  sbFetchToutePage=async path=>path.startsWith('preparations_missions?')?__source.brouillons:path.startsWith('planning_restitutions?')?__states:[];
  window.confirm=()=>true;
 });
 await page.evaluate(()=>ouvrirPreparationDemande('c1'));
 assert.match(await page.locator('#hc-prep-body').innerText(),/Réception — convoyeur → HelixCar/);
 assert.match(await page.locator('#hc-prep-body').innerText(),/Remise — HelixCar → client/);
 await page.locator('[data-field="retour_reception"]').fill('2026-11-08T13:00');
 await page.locator('[data-field="retour_remise"]').fill('2026-11-09T11:00');
 await page.locator('[data-prep-save]').click();assert.match(await page.locator('#hc-prep-message').innerText(),/suivre la livraison/);assert.equal(await page.evaluate(()=>__saves),0);
 await page.locator('[data-field="retour_reception"]').fill('2026-11-08T18:30');
 await page.locator('[data-field="remuneration"]').fill('120');await page.locator('[data-field="distance"]').fill('500');
 await page.locator('[data-prep-save]').click();assert.match(await page.locator('#hc-prep-message').innerText(),/enregistré/);
 await page.evaluate(()=>ouvrirPreparationDemande('c1'));assert.equal(await page.locator('[data-field="retour_reception"]').inputValue(),'2026-11-08T18:30');
 await page.locator('#hc-prep-body').screenshot({path:'/tmp/hc-retour-preparation-'+width+'.png'});
 await page.locator('[data-prep-view="preview"]').first().click();
 const publicText=await page.locator('#hc-prep-body').innerText();assert(publicText.includes('18:30')&&!publicText.includes('11:00')&&!publicText.includes('SECRET-RECUPERATEUR'));assert(!await page.locator('[data-prep-publish]').isDisabled());
 await page.locator('#hc-prep-close').click();await page.evaluate(()=>showPage('admin-planning'));
 await page.locator('[data-planning-id="prep1:retour_reception"]').waitFor();
 assert.equal(await page.locator('[data-planning-id]').count(),2);
 const receipt=page.locator('[data-planning-id="prep1:retour_reception"]'),hand=page.locator('[data-planning-id="prep1:retour_remise"]');
 assert.match(await receipt.innerText(),/Renault Clio · CC-456-DD/);assert.match(await hand.innerText(),/SECRET-RECUPERATEUR/);
 assert(await hand.locator('[data-planning-action="remettre"]').isDisabled());
 await receipt.locator('[data-planning-action="confirmer_reception"]').click();
 await hand.locator('[data-planning-action="confirmer_remise"]').click();
 await page.screenshot({path:'/tmp/hc-retour-planning-'+width+'.png',fullPage:true});
 await receipt.locator('[data-planning-action="recevoir"]').click();
 assert.equal(await receipt.count(),0);assert.match(await hand.innerText(),/Chez HelixCar — en attente de récupération client/);
 await page.locator('#hc-planning-refresh').click();assert.match(await hand.innerText(),/en attente de récupération client/);
 await hand.locator('[data-planning-action="remettre"]').click();assert.equal(await hand.count(),0);
 await page.locator('#hc-planning-state').selectOption('archives');assert.equal(await page.locator('[data-planning-id]').count(),2);assert.match(await hand.innerText(),/Véhicule remis au client/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS '+width+' : préparation, erreur chronologique, persistance, confidentialité partenaire, deux rendez-vous, réception, remise, archives');
 await page.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
