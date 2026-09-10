// F01 — contrôles du vrai formulaire en navigateur isolé (aucun serveur réel).
// SQL 112 et comparaison des PDF de référence restent des preuves séparées.
const L = require('./lib.js');
const fs = require('fs');
const capturerQA=require('./preuves-qa.js');
const REF_MISSION = 'Diagnostic électronique complet de plusieurs véhicules présentant des défauts intermittents, contrôle des calculateurs, vérification des systèmes d’aide à la conduite';
const REF_TYPE = 'Gestion administrative temporaire de dossiers clients, contrôle des documents, mise à jour des statuts de préparation et coordination des entrées et sorties';

(async()=>{
  const browser=await L.launch();
  try {
    const page=await L.newPage(browser);
    await L.fillStep1(page,'particulier');
    const opt=page.locator('input[name="type-service"][value="nettoyage"]');
    L.check('A1 : nettoyage réellement désactivé pour un particulier',await opt.isDisabled());
    L.check('A2 : restriction affichée, option conservée',await page.locator('#type-service-nettoyage-opt').isVisible() && (await page.locator('#type-service-nettoyage-opt').textContent()).includes('Réservé aux entreprises'));
    await page.evaluate(()=>{document.getElementById('client-type').value='pro';toggleClientType();});
    L.check('A3 : nettoyage actif pour une entreprise',await opt.isEnabled());
    await opt.click();
    await page.evaluate(()=>{document.getElementById('client-type').value='particulier';toggleClientType();});
    L.check('A4 : pro → particulier retire le choix nettoyage',await opt.isDisabled() && !(await opt.isChecked()));
    await L.chooseService(page,'professionnel');
    L.check('B1 : questions non visibles sous le choix du service',!(await page.locator('#bloc-socle-professionnel').isVisible()));
    await L.ouvrirEtapeProfessionnel(page);
    L.check('B2 : Continuer ouvre l’étape dédiée',await L.step(page)===3 && await page.locator('#bloc-socle-professionnel').isVisible());
    L.check('B3 : les quatre rubriques existent une seule fois dans l’étape 3',await page.evaluate(()=>['besoin','lieu','periode','mission'].every(k=>{const e=document.querySelectorAll('#pro-acc-'+k);return e.length===1 && e[0].closest('.form-step').dataset.step==='3';})));
    L.check('B4 : étape véhicule non applicable, prochain écran récapitulatif',await page.evaluate(()=>!_estEtapeApplicable(4) && _prochaineEtape(3)===5));
    await page.evaluate(()=>{proBasculerRubrique('besoin');document.querySelector('[name="pro-categorie"][value="technicien"]').click();proBasculerRubrique('mission');});
    L.check('B5 : icône et titre d’étape métier, pas véhicule',await page.evaluate(()=>{const e=document.querySelector('#modal-client [data-step-item="3"]');return e && e.getAttribute('aria-label')==='Votre mission' && !!e.querySelector('svg');}));
    const champ=page.locator('#pro-description');
    for(const [cat,max,reference] of [['technicien',166,REF_MISSION],['renfort',156,REF_TYPE]]) {
      await page.evaluate(c=>{document.querySelector('[name="pro-categorie"][value="'+c+'"]').click();const a=document.getElementById('pro-acc-mission');if(!a.classList.contains('ouvert'))proBasculerRubrique('mission');},cat);
      L.check('C-'+cat+' : référence exacte à '+max,Array.from(reference).length===max);
      for(const n of [max-1,max,max+1]) {
        const r=await page.evaluate(n=>{const e=document.getElementById('pro-description');e.value='é'.repeat(n);proOnDescriptionInput();return {ok:_proValiderRubrique('mission',()=>{}),texte:e.value,compteur:document.getElementById('pro-description-compteur').textContent};},n);
        L.check('C-'+cat+' : '+n+' caractères '+(n<=max?'acceptés':'refusés sans troncature'),r.ok===(n<=max) && r.texte.length===n && r.compteur.includes(n+' / '+max));
      }
      await champ.fill(reference);
      await champ.press('End');
      await champ.press('.');
      L.check('C-'+cat+' : frappe supplémentaire empêchée à la limite',await champ.inputValue()===reference);
      const collage=await champ.evaluate((el,max)=>{el.value='TEST-QA-CLAUDE-HELIXCAR';el.setSelectionRange(el.value.length,el.value.length);const d=new DataTransfer();d.setData('text','z'.repeat(max));const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d});el.dispatchEvent(e);return {refuse:e.defaultPrevented,texte:el.value};},max);
      L.check('C-'+cat+' : collage excessif refusé entier, saisie conservée',collage.refuse && collage.texte==='TEST-QA-CLAUDE-HELIXCAR');
      await champ.fill('é'.repeat(max-1)+'🚗');
      L.check('C-'+cat+' : Unicode hors BMP compté comme en SQL',await page.evaluate(()=>_proLongueurDescription()===_proPlafondDescription() && _proValiderRubrique('mission',()=>{})));
      await champ.press('End');await champ.press('.');
      L.check('C-'+cat+' : aucune insertion après limite Unicode',Array.from(await champ.inputValue()).length===max);
    }
    await champ.fill('  TEST-QA-CLAUDE-HELIXCAR mission  ');
    L.check('C-espaces : compteur, payload et brouillon gardent le texte exact',await page.evaluate(()=>{
      const texte=document.getElementById('pro-description').value;
      return _proLongueurDescription()===Array.from(texte).length && _construireDetailsProfessionnel().description===texte && _construireBrouillonClient().champs['pro-description'].v===texte;
    }));
    await champ.fill('   ');
    L.check('C-vide : des espaces seuls ne valident pas la mission',await page.evaluate(()=>!_proValiderRubrique('mission',()=>{}) && !_proRubriqueComplete('mission')));
    await champ.evaluate(el=>{el.value='TEST-QA-CLAUDE-HELIXCAR '+ 'x'.repeat(180);proOnDescriptionInput();_sauvegarderBrouillonClient();});
    const texteAvant=await champ.inputValue();
    await page.reload({waitUntil:'load'});
    await page.evaluate(()=>openModal('client'));
    L.check('D1 : ancien brouillon long conservé après rechargement',await champ.inputValue()===texteAvant);
    L.check('D2 : brouillon long reste bloqué, compteur synchronisé',await page.evaluate(()=>!_proValiderRubrique('mission',()=>{}) && document.getElementById('pro-description-compteur').textContent.includes(' / 156')));
    await page.getByRole('button',{name:'Reprendre ma demande',exact:true}).click();
    for(const width of [1280,390,320]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>{_formStepState.client=3;_renderFormStep('client');if(!document.getElementById('pro-acc-mission').classList.contains('ouvert'))proBasculerRubrique('mission');});
      L.check('D-'+width+' : champ visible sans débordement',await champ.isVisible() && await champ.evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth+1));
      if(width===1280||width===390)await capturerQA(page,'f01-plafond-'+width,'#modal-client .modal');
    }
    // Un nouveau contexte Playwright isole cookies et stockage (navigation
    // privée émulée). Ce contrôle ne prétend pas tester Safari sur iPhone.
    const contexte=await browser.newContext({viewport:{width:390,height:844}});
    const prive=await contexte.newPage();
    await prive.goto(L.urlFichier('index.html'),{waitUntil:'load'});
    await prive.evaluate(()=>openModal('client'));
    L.check('D3 : contexte privé sans brouillon ni type pro hérité',await prive.locator('#pro-description').inputValue()==='' && await prive.locator('input[name="type-service"][value="nettoyage"]').isDisabled());
    await contexte.close();
    const dashboard=fs.readFileSync(L.fichier('dashboard.html'),'utf8');
    L.check('E1 : libellé de devis Préparation complète raccourci',/preparation_complete: 'Préparation complète'/.test(dashboard));
    L.check('E2 : ancien choix Flexible ne revient pas dans les horaires nettoyage',!/dispo_type === 'flexible'/.test(dashboard.slice(dashboard.indexOf('function _nettHoraireTexte'),dashboard.indexOf('function _nettHoraireTexte')+900)));
    const sql=fs.readFileSync(L.fichier('migrations/112_plafonds_mission_et_nettoyage_reserve.sql'),'utf8');
    L.check('E3 : contrôle statique du changement de catégorie en SQL',sql.includes('v_categorie is distinct from v_categorie_ancienne'));
    L.check('E4 : aucune exception JS dans le formulaire',page.jsErrors.length===0,page.jsErrors.join('; '));
  } finally {await browser.close();}
  process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
