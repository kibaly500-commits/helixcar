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
 L.check('Nettoyage affiché '+mobile,(await page.locator('#profil-metiers').innerText()).includes('Nettoyeur professionnel'));
 L.check('Badge nettoyeur vert sous le nom '+mobile, await page.locator('#sb-metiers [data-decision="oui"]').innerText() === 'Nettoyeur professionnel');
 L.check('Badge générique masqué '+mobile, !(await page.locator('#sb-role').isVisible()));
 L.check('Titre professionnel '+mobile,(await page.locator('#profil-partenaire-titre').innerText())==='Mon profil professionnelle');
 const layout=await page.locator('#profil-badges-choix label').evaluateAll(labels=>labels.map(label=>{const box=label.querySelector('input').getBoundingClientRect(),text=label.querySelector('span').getBoundingClientRect();return {width:box.width,gap:text.left-box.right,dy:Math.abs((text.top+text.bottom-box.top-box.bottom)/2)}}));
 L.check('Cases compactes à côté des intitulés '+mobile,layout.every(x=>x.width===18&&x.gap>=10&&x.gap<=14&&x.dy<2));
 L.check('Choix sans débordement '+mobile,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.check('input[name="badge-metier"][value="diagnostic"]');await page.check('input[name="badge-metier"][value="jockey"]');await page.click('#demander-badges');
 await page.waitForFunction(()=>document.getElementById('profil-badges-message').textContent.includes('enregistrées'));
 L.check('Deux badges demandés ensemble '+mobile,(await page.evaluate(()=>window.__calls.find(x=>x.name==='demander_badges_professionnel').args.p_metiers.length))===2);
 L.check('Demandes affichées en attente '+mobile,(await page.locator('#profil-badges').innerText()).match(/En attente/g)?.length===2);
 L.check('Badges demandés grisés sous le nom '+mobile,(await page.locator('#sb-metiers [data-decision="en_attente"] small').allTextContents()).join('|') === 'En attente|En attente');
 await page.evaluate(async()=>{currentRole='admin';initApp({role:'admin',name:'Admin',initials:'A'});showPage('admin-metiers');await chargerValidationMetiers()});
 L.check('Badges métiers masqués pour admin '+mobile,!(await page.locator('#sb-metiers').isVisible()));
 if(mobile){await page.evaluate(()=>openMobileMenu());const lien=page.locator('#mobile-menu-items button').filter({hasText:'Validation des métiers'});L.check('Rubrique accessible mobile',await lien.isVisible());await lien.click();}else L.check('Rubrique accessible PC',await page.locator('#nav-admin-metiers').isVisible());
 L.check('Une ligne par professionnel '+mobile,await page.locator('.validation-metiers-ligne').count()===1);
 await page.evaluate(async()=>{window.__row=document.querySelector('.validation-metiers-ligne');await chargerValidationMetiers(true)});
 L.check('Actualisation sans remplacement inutile '+mobile,await page.evaluate(()=>window.__row===document.querySelector('.validation-metiers-ligne')));
 const first=page.locator('#admin-metiers-liste button[title="Valider"]:not(:disabled)').first();
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
