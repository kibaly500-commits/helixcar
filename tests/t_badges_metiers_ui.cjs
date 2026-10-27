const L=require('./lib');
(async()=>{
 const browser=await L.launch();
 for(const mobile of [false,true]){
 const page=await L.newPage(browser);if(mobile)await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{
  window.__badges=[{professionnel_id:'p1',metier:'nettoyage',decision:'oui',convoyeurs:{prenom:'Test',nom:'Pro'}}];
  window.__profil={id:'p1',prenom:'Test',nom:'Pro',civilite:'madame',metiers:['nettoyage'],statut:'actif'};
  window.__calls=[];window.__error=false;window.__confirm=true;window.confirm=()=>window.__confirm;
  window.supabase={createClient(){return{
   auth:{onAuthStateChange(){},getSession:async()=>({data:{session:null}})},
   from(table){const q={select(){return q},eq(){return q},order(){return q},single:async()=>({data:window.__profil}),then(resolve){return Promise.resolve(window.__error?{error:{message:'Indisponible'}}:{data:table==='professionnel_badges'?window.__badges:[]}).then(resolve)}};return q},
   rpc:async(name,args)=>{window.__calls.push({name,args});if(window.__error)return {error:{message:'Indisponible'}};
   if(name==='demander_badges_professionnel'){args.p_metiers.forEach(m=>window.__badges.push({professionnel_id:'p1',metier:m,decision:'en_attente',convoyeurs:{prenom:'Test',nom:'Pro'}}));window.__profil.metiers.push(...args.p_metiers)}
   if(name==='decider_badge_professionnel')window.__badges.find(x=>x.metier===args.p_metier).decision=args.p_decision;
   return {data:null,error:null};}
  }}};
 });
 await page.goto(L.urlFichier('dashboard.html'),{waitUntil:'load'});
 await page.evaluate(async()=>{window._currentConvoyeur=window.__profil;currentRole='convoyeur';initApp({role:'convoyeur',name:'Test Pro',initials:'TP'});remplirProfilConvoyeur(window.__profil);_appliquerCiviliteEspacePartenaire(window.__profil);showPage('convoyeur-profil');await chargerMesBadges()});
 L.check('Nettoyage affiché '+mobile,(await page.locator('#profil-metiers').innerText()).includes('Nettoyage automobile'));
 L.check('Titre professionnel '+mobile,(await page.locator('#profil-partenaire-titre').innerText())==='Mon profil professionnelle');
 await page.check('input[name="badge-metier"][value="diagnostic"]');await page.check('input[name="badge-metier"][value="jockey"]');await page.click('#demander-badges');
 await page.waitForFunction(()=>document.getElementById('profil-badges-message').textContent.includes('enregistrées'));
 L.check('Deux badges demandés ensemble '+mobile,(await page.evaluate(()=>window.__calls.find(x=>x.name==='demander_badges_professionnel').args.p_metiers.length))===2);
 L.check('Demandes affichées en attente '+mobile,(await page.locator('#profil-badges').innerText()).match(/En attente/g)?.length===2);
 await page.evaluate(async()=>{currentRole='admin';initApp({role:'admin',name:'Admin',initials:'A'});showPage('admin-metiers');await chargerValidationMetiers()});
 if(mobile){await page.evaluate(()=>openMobileMenu());const lien=page.locator('#mobile-menu-items button').filter({hasText:'Validation des métiers'});L.check('Rubrique accessible mobile',await lien.isVisible());await lien.click();}else L.check('Rubrique accessible PC',await page.locator('#nav-admin-metiers').isVisible());
 const first=page.locator('#admin-metiers-liste button[data-hc-action="deciderMetierProfessionnel"]').filter({hasText:'Valider'}).first();
 await page.evaluate(()=>window.__confirm=false);await first.click();
 L.check('Annulation sans écriture '+mobile,(await page.evaluate(()=>window.__calls.filter(x=>x.name==='decider_badge_professionnel').length))===0);
 await page.evaluate(()=>window.__confirm=true);await first.click();await page.waitForFunction(()=>window.__calls.some(x=>x.name==='decider_badge_professionnel'));
 L.check('Décision ciblée '+mobile,(await page.evaluate(()=>window.__calls.find(x=>x.name==='decider_badge_professionnel').args.p_decision))==='oui');
 await page.evaluate(async()=>{window.__error=true;await chargerValidationMetiers()});
 L.check('Erreur explicite sans faux succès '+mobile,(await page.locator('#admin-metiers-liste').innerText()).includes('Impossible'));
 L.check('Aucun débordement horizontal '+mobile,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.close();
 }
 await browser.close();process.exit(L.results()?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
