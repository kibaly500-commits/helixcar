const L = require('./lib.js');
const { dansNJours } = require('./env.js');
(async () => {
  const browser = await L.launch();
  try {
    const page = await L.newPage(browser);
    let accepter = true, messages = [];
    page.on('dialog', async d => { messages.push(d.message()); await (accepter ? d.accept() : d.dismiss()); });
    // Cette recette porte sur les fiches, sans dépendre du parcours
    // d'inscription (couvert séparément par les tests d'intégration).
    await page.evaluate(()=>{
      openModal('client');
      document.querySelector('input[name="type-service"][value="convoyage"]').click();
    });
    await page.setViewportSize({width:1200,height:760});
    await page.evaluate(dates => {
      window.qaScenarioCopies = (n, remplis) => {
        // Nouvelle demande de recette, sans brouillon d'un cas précédent.
        _memoireVehicules = {};
        document.getElementById('bloc-vehicules-multiples').innerHTML = '';
        document.getElementById('nb-vehicules').value = String(n);
        rendreFichesVehicules();
        for (const i of remplis) {
          const set = (s,v) => { const e=document.getElementById('veh-'+i+'-'+s); if(e)e.value=v; };
          set('type',document.getElementById('veh-'+i+'-type').options[1].value);
          set('marque','Modèle '+(i+1)); set('immat','AA-12'+i+'-BB');
          for (const p of ['pc','liv']) {
            set(p+'-rue','Adresse '+i); set(p+'-cp','75001'); set(p+'-ville','Paris');
            set(p+'-date',p==='pc'?dates[0]:dates[1]); set(p+'-heure','14:00');
          }
          document.querySelector('[name="veh-'+i+'-mode"][value="standard"]').checked=true;
          document.querySelector('[name="veh-'+i+'-restit-active"][value="non"]').checked=true;
        }
        _majProgressionVehicules();
      };
      window.qaOuvrirCopies = qte => { _hcOuvrirDupliquer(0); _hcAjusterDupliquerQte(qte-1); };
      window.qaDonneesCopies = () => JSON.stringify(_lireFichesVehicules());
      window.qaMarquesCopies = () => _lireFichesVehicules().map(v=>v.marque_modele);
    }, [dansNJours(3),dansNJours(5)]);
    // Cas utilisateur : deux fiches renseignées sur quatre. Un simple
    // Oui/Non sur les fiches restantes ne constitue pas une saisie.
    for (const choixSeul of [false,true]) {
      await page.evaluate(choixSeul=>{
        qaScenarioCopies(4,[0,1]);
        if(choixSeul) for(const i of [2,3]) {
          const choix=document.querySelector('[name="veh-'+i+'-restit-active"][value="non"]');
          choix.click();
        }
        rendreFichesVehicules();
        qaOuvrirCopies(1);
      },choixSeul);
      L.check('4 fiches : une copie vers 3 sans message, choix seul='+choixSeul,
        await page.evaluate(()=>JSON.stringify(_hcCiblesDuplication())==='[2]')&&await page.locator('#hc-dupliquer-avertissement').isHidden());
      await page.click('#hc-dupliquer-plus');
      L.check('4 fiches : deux copies vers 3 et 4 sans message, choix seul='+choixSeul,
        await page.evaluate(()=>JSON.stringify(_hcCiblesDuplication())==='[2,3]')&&await page.locator('#hc-dupliquer-avertissement').isHidden());
      await page.click('#hc-dupliquer-plus');
      L.check('4 fiches : trois copies avertissent seulement pour 2, choix seul='+choixSeul,
        await page.evaluate(()=>JSON.stringify(_hcCiblesDuplication())==='[2,3,1]')&&
        (await page.locator('#hc-dupliquer-avertissement').textContent()).includes('du véhicule 2.'));
      await page.click('#hc-dupliquer-moins');
      L.check('Redescendre à deux masque le message, choix seul='+choixSeul,await page.locator('#hc-dupliquer-avertissement').isHidden());
      messages=[];await page.click('#hc-dupliquer-go');
      L.check('Deux copies effectives préservent la fiche 2, sans confirmation, choix seul='+choixSeul,
        messages.length===0&&JSON.stringify(await page.evaluate(()=>qaMarquesCopies()))===JSON.stringify(['Modèle 1','Modèle 2','Modèle 1','Modèle 1']));
    }
    await page.evaluate(()=>{qaScenarioCopies(5,[0,1,2]);qaOuvrirCopies(2);});
    L.check('Deux copies visent les fiches vides 4 et 5',
      await page.evaluate(()=>JSON.stringify(_hcCiblesDuplication())==='[3,4]'));
    L.check('Aucun avertissement pour les seules fiches vides',
      await page.locator('#hc-dupliquer-avertissement').isHidden());
    messages=[];await page.click('#hc-dupliquer-go');
    L.check('Copie effective vers 4 et 5, sans toucher 2 et 3',
      JSON.stringify(await page.evaluate(()=>qaMarquesCopies()))===JSON.stringify(['Modèle 1','Modèle 2','Modèle 3','Modèle 1','Modèle 1']));
    L.check('Aucune confirmation inutile pour les fiches vides',messages.length===0);

    await page.evaluate(()=>{qaScenarioCopies(5,[0,1,2]);qaOuvrirCopies(3);});
    const avertissement=await page.locator('#hc-dupliquer-avertissement').textContent();
    L.check('Trois copies : avertissement uniquement pour le véhicule 2',
      avertissement.includes('du véhicule 2.')&&!/véhicules|4|5/.test(avertissement),avertissement);
    const avant=await page.evaluate(()=>qaDonneesCopies());
    accepter=false;messages=[];await page.click('#hc-dupliquer-go');
    L.check('Annuler le remplacement ne modifie aucune fiche, même vide',
      avant===await page.evaluate(()=>qaDonneesCopies()));
    L.check('Confirmation nomme la fiche remplacée et garde la fenêtre ouverte si refusée',
      messages.length===1&&messages[0].includes('du véhicule 2.')&&await page.locator('#hc-dupliquer-go').isVisible());
    accepter=true;await page.click('#hc-dupliquer-go');
    L.check('Confirmer copie vers 4, 5 puis 2 et conserve le véhicule 3',
      JSON.stringify(await page.evaluate(()=>qaMarquesCopies()))===JSON.stringify(['Modèle 1','Modèle 1','Modèle 3','Modèle 1','Modèle 1']));

    await page.evaluate(()=>{qaScenarioCopies(5,[0,1,2,3,4]);qaOuvrirCopies(4);});
    L.check('Toutes les fiches remplies : numéros exacts et source exclue',
      (await page.locator('#hc-dupliquer-avertissement').textContent()).includes('des véhicules 2, 3, 4 et 5.'));
    await page.click('#hc-dupliquer-moins');await page.click('#hc-dupliquer-moins');await page.click('#hc-dupliquer-moins');
    L.check('Le message suit la diminution de quantité et revient au singulier',
      (await page.locator('#hc-dupliquer-avertissement').textContent()).includes('du véhicule 2.'));
    await page.click('#hc-dupliquer-annuler');
    await page.evaluate(()=>{
      qaScenarioCopies(3,[0]);
      document.getElementById('veh-1-type').value=document.getElementById('veh-1-type').options[1].value;
      qaOuvrirCopies(2);
    });
    L.check('Une fiche partiellement remplie est protégée, même avec le seul type',
      await page.evaluate(()=>JSON.stringify(_hcCiblesDuplication())==='[2,1]')&&
      (await page.locator('#hc-dupliquer-avertissement').textContent()).includes('du véhicule 2.'));
    await page.click('#hc-dupliquer-annuler');
    await page.evaluate(()=>{qaScenarioCopies(2,[0,1]);qaOuvrirCopies(1);});
    L.check('Deux véhicules : fenêtre simplifiée avec avertissement',
      await page.locator('#hc-dupliquer-compteur').isHidden()&&await page.locator('#hc-dupliquer-avertissement').isVisible());
    await page.click('#hc-dupliquer-annuler');
    await page.evaluate(()=>{qaScenarioCopies(1,[0]);_hcOuvrirDupliquer(0);});
    L.check('Un seul véhicule : aucune destination et aucune fenêtre',await page.locator('#hc-dupliquer-go').isHidden());

    // Vérification géométrique réelle, sans remplacer scrollIntoView.
    for (const integre of [false,true]) {
      await page.evaluate(integre=>{
        document.body.classList.toggle('hc-integre',integre);
        document.body.classList.toggle('hc-mode-demande',integre);
        qaScenarioCopies(5,[0,1,2,3,4]);_formStepState.client=4;_renderFormStep('client');_ouvrirVehicule(4);
        document.querySelectorAll('#veh-contenu-4 .veh-sous-accordeon').forEach(b=>b.classList.add('ouvert'));
      },integre);
      await page.locator('#veh-contenu-4 .veh-btn-valider').click();
      await page.waitForTimeout(150);
      async function listeVisible() {
        return page.evaluate(()=>{
          const r=document.getElementById('bloc-vehicules-multiples').getBoundingClientRect();
          const barre=document.getElementById('veh-barre-0').getBoundingClientRect();
          return r.top>=0&&r.top<200&&barre.top>=0&&barre.top<innerHeight;
        });
      }
      L.check('Validation du dernier véhicule remonte à la liste, intégré='+integre,await listeVisible());
      await page.evaluate(()=>{
        _ouvrirVehicule(4);document.getElementById('veh-4-sous-livraison').classList.add('ouvert');
      });
      await page.locator('#veh-4-sous-livraison .veh-sous-valider').click();
      await page.waitForTimeout(150);
      L.check('OK sur une information d’un véhicule complet remonte à la liste, intégré='+integre,await listeVisible());
      await page.evaluate(()=>{
        qaScenarioCopies(5,[4]);_formStepState.client=4;_renderFormStep('client');_ouvrirVehicule(4);
        document.querySelectorAll('#veh-contenu-4 .veh-sous-accordeon').forEach(b=>b.classList.add('ouvert'));
      });
      await page.locator('#veh-contenu-4 .veh-btn-valider').click();
      await page.waitForTimeout(150);
      L.check('Retour à la liste même si d’autres véhicules restent incomplets, intégré='+integre,await listeVisible());
      await page.evaluate(()=>{
        _ouvrirVehicule(4);document.getElementById('veh-4-type').value='';
        document.getElementById('veh-4-sous-identite').classList.add('ouvert');
      });
      await page.locator('#veh-4-sous-identite .veh-sous-valider').click();
      L.check('Une erreur de saisie garde le focus sur le champ à corriger, intégré='+integre,
        await page.evaluate(()=>document.activeElement.id==='veh-4-type'&&document.activeElement.getAttribute('aria-invalid')==='true'));
    }
    L.check('Aucune exception JavaScript',page.jsErrors.length===0,page.jsErrors.join(' | '));
  } finally {await browser.close();}
  process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
