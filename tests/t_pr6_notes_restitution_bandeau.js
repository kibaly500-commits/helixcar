const L = require('./lib.js');

(async () => {
  const browser = await L.launch();
  try {
    for (const width of [1280, 390]) {
    const page = await L.newPage(browser);
    await page.setViewportSize({ width, height: 1000 });
    await L.fillStep1(page, 'particulier');
    await L.chooseService(page, 'convoyage');
    const result = await page.evaluate(() => {
      document.getElementById('client-notes').value = 'belelle <img src=x onerror=alert(1)>';
      rendreFichesVehicules();
      construireRecap();
      const recap = document.getElementById('recap-demande');
      const question = document.getElementById('veh-restit-question-0');
      const visible = question && question.style.display !== 'none';
      document.querySelector('input[name="veh-0-restit-active"][value="oui"]').checked = true;
      basculerRestitVehicule(0);
      const active = _vehiculeARestitutionSpecifique(0);
      _hcEffacerSousVeh(0, 'livraison');
      return {
        notes: recap.textContent.includes('belelle <img'),
        escaped: !recap.querySelector('img'),
        visible, active,
        afterClear: question.style.display !== 'none'
      };
    });
    for (const [key, value] of Object.entries(result)) L.check(key, value);
    await page.evaluate(() => {
      _sauvegarderBrouillonClient();
      _afficherNoticeBrouillonRestaure();
      document.getElementById('client-type').dispatchEvent(new Event('change', { bubbles: true }));
    });
    L.check('Initialisation automatique conserve le bandeau', await page.locator('#notice-brouillon-restaure').count() === 1);
    await page.locator('#notice-brouillon-restaure button').first().click();
    L.check('Reprendre masque le bandeau', await page.locator('#notice-brouillon-restaure').count() === 0);
    await page.evaluate(() => _hcAfficherBrouillonIntegre());
    L.check('Retour réaffiche immédiatement le bandeau', await page.locator('#notice-brouillon-restaure').count() === 1);
    await page.locator('input[name="type-service"][value="convoyage"]').click();
    L.check('Continuer sans choisir vaut reprise', await page.locator('#notice-brouillon-restaure').count() === 0);
    L.check('Reprise implicite conserve les notes', await page.locator('#client-notes').inputValue() === 'belelle <img src=x onerror=alert(1)>');
    await page.evaluate(() => {
      document.getElementById('client-notes').value = '';
      construireRecap();
    });
    L.check('Pas de rubrique de notes vide', !(await page.locator('#recap-demande').textContent()).includes('Informations complémentaires'));
    const scenarios = await page.evaluate(() => {
      const radio = (name, value) => { document.querySelector('input[name="' + name + '"][value="' + value + '"]').checked = true; };
      document.getElementById('nb-vehicules').value = '3';
      rendreFichesVehicules();
      const toutes = [0, 1, 2].every(i => document.getElementById('veh-restit-question-' + i).style.display === 'block');
      radio('veh-1-restit-active', 'oui');
      basculerRestitVehicule(1);
      document.getElementById('veh-1-restit-marque').value = 'Renault restitution';
      construireRecap();
      const recapRestit = document.getElementById('recap-demande').textContent.includes('Renault restitution');
      const donneesRestit = _lireFichesVehicules()[1].restit_marque_modele === 'Renault restitution';
      radio('type-service', 'stockage');
      radio('stock-acheminement', 'depot_client');
      radio('stock-sortie', 'helixcar');
      _memoireVehicules = {};
      rendreFichesVehicules();
      radio('veh-0-liv-active', 'non');
      basculerLivraisonVehicule(0);
      const sansLiv = document.getElementById('veh-restit-question-0').style.display === 'none';
      radio('veh-0-liv-active', 'oui');
      basculerLivraisonVehicule(0);
      const avecLiv = document.getElementById('veh-restit-question-0').style.display === 'block';
      document.getElementById('client-notes').value = 'Consigne stockage';
      construireRecap();
      const notesStock = document.getElementById('recap-demande').textContent.includes('Consigne stockage');
      return { toutes, recapRestit, donneesRestit, sansLiv, avecLiv, notesStock };
    });
    for (const [key, value] of Object.entries(scenarios)) L.check(key, value);
    await page.close();
    }
  } finally {
    await browser.close();
  }
  process.exitCode = L.results() ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
