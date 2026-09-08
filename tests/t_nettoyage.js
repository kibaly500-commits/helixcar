// Parcours Nettoyage complet : étape 2 -> étape 4 -> récapitulatif
const L = require('./lib.js');

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);

  await L.fillStep1(page, 'pro');
  await L.chooseService(page, 'nettoyage');
  await L.fillNettoyageStep2(page, 11,
    { berline_break: 1, suv_4x4: 2, utilitaire_fourgon: 4, citadine: 4 },
    'preparation_complete');

  let s = await L.btnState(page);
  L.check('Étape 2 : bouton actif avec 11/11 + prestation', s.disabled === false);

  await page.click('#client-step-next-btn');
  await page.waitForTimeout(150);
  let st = await L.step(page);
  L.check('Passage étape 2 -> étape 4 (étape 3 sautée)', st === 4, 'étape=' + st);

  // Étape 4 : organisation
  const orgaVisible = await page.evaluate(() => {
    const b = document.getElementById('bloc-nettoyage-orga');
    return b && b.style.display !== 'none';
  });
  L.check('Étape 4 : bloc Organisation visible', orgaVisible);

  // Lieu
  await page.click('input[name="nett-lieu"][value="locaux_client"]');
  await page.waitForTimeout(60);
  const adrVisible = await page.evaluate(() => {
    const b = document.getElementById('nett-adresse-bloc');
    return b && b.style.display !== 'none';
  });
  L.check('Lieu choisi -> bloc adresse affiché (_nettAdresseApplicable)', adrVisible);

  await page.fill('#nett-adresse-rue', '24 avenue Victor-Hugo');
  await page.fill('#nett-adresse-cp', '93260');
  await page.fill('#nett-adresse-ville', 'Les Lilas');

  // Date (champ readonly piloté par le calendrier maison) : on écrit la valeur
  await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    // Le formateur de la production : aucune conversion UTC.
    document.getElementById('nett-date').value = _hcFormaterYMD(d);
  });

  // Disponibilité : heure précise
  await page.click('input[name="nett-dispo"][value="precise"]');
  await page.waitForTimeout(50);
  const heureVisible = await page.evaluate(() => {
    const b = document.getElementById('nett-heure-precise-bloc');
    return b && b.style.display !== 'none';
  });
  L.check('Disponibilité "précise" -> bloc heure affiché (_nettTypeDispo)', heureVisible);
  await page.evaluate(() => { document.getElementById('nett-heure').value = '09:00'; });

  // Contact sur place (obligatoire depuis le lot courant)
  await L.fillContactSurPlace(page, 'nett', 'autre', 'Karim B.', '+33600000000');

  // Délai
  await page.click('input[name="nett-delai"][value="standard"]');
  await page.waitForTimeout(40);

  // Lecture des 8 fonctions autrefois manquantes
  const lecteurs = await page.evaluate(() => ({
    lieu: _nettLieu(),
    adresseApplicable: _nettAdresseApplicable(),
    date: _nettDate(),
    dispo: _nettTypeDispo(),
    heure: _nettHeure(),
    cdeb: _nettCreneauDebut(),
    cfin: _nettCreneauFin(),
    delai: _nettDelai()
  }));
  L.check('_nettLieu() lit le lieu', lecteurs.lieu === 'locaux_client', JSON.stringify(lecteurs));
  L.check('_nettDate() lit la date', /^\d{4}-\d{2}-\d{2}$/.test(lecteurs.date));
  L.check('_nettTypeDispo() lit la disponibilité', lecteurs.dispo === 'precise');
  L.check('_nettHeure() lit l\'heure', lecteurs.heure === '09:00');
  L.check('_nettDelai() lit le délai', lecteurs.delai === 'standard');
  L.check('_nettCreneauDebut/Fin() vides hors créneau', lecteurs.cdeb === '' && lecteurs.cfin === '');

  // Validation de l'étape 4 sans exception
  const v4 = await page.evaluate(() => {
    try { return { ok: _validateNettoyageEtape4().ok, crash: false }; }
    catch (e) { return { crash: true, msg: e.message }; }
  });
  L.check('_validateNettoyageEtape4() s\'exécute sans ReferenceError', v4.crash === false, JSON.stringify(v4));
  L.check('_validateNettoyageEtape4() valide le formulaire complet', v4.ok === true, JSON.stringify(v4));

  // Continuer -> récapitulatif
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(250);
  st = await L.step(page);
  L.check('Passage étape 4 -> récapitulatif (étape 5)', st === 5, 'étape=' + st);

  const recap = await page.evaluate(() => {
    const z = document.getElementById('recap-demande');
    return z ? z.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  L.check('Récapitulatif nettoyage réellement construit', recap.length > 80, 'len=' + recap.length);
  L.check('Récap contient la prestation choisie', /Préparation complète/i.test(recap), recap.slice(0, 200));
  L.check('Récap contient le nombre de véhicules', /11/.test(recap));
  L.check('Récap contient le lieu', /locaux de votre entreprise/i.test(recap), recap.slice(0, 300));

  // Payload métier complet
  const det = await page.evaluate(() => {
    try { return { d: _construireDetailsNettoyage(), crash: false }; }
    catch (e) { return { crash: true, msg: e.message }; }
  });
  L.check('_construireDetailsNettoyage() sans exception', det.crash === false, JSON.stringify(det));
  if (!det.crash) {
    const d = det.d;
    L.check('Payload : type_nettoyage renseigné', d.type_nettoyage === 'preparation_complete');
    L.check('Payload : lieu renseigné', d.lieu === 'locaux_client');
    L.check('Payload : date renseignée', !!d.date_souhaitee);
    L.check('Payload : heure_precise renseignée', d.heure_precise === '09:00');
    L.check('Payload : delai renseigné', d.delai === 'standard');
    L.check('Payload : adresse renseignée', d.adresse_cp === '93260' && d.adresse_ville === 'Les Lilas');
    L.check('Payload : répartition = 11 véhicules',
      (d.repartition_categories || []).reduce((a, r) => a + r.quantite, 0) === 11);
    L.check('Payload : structure préservée (schema_version 2)', d.schema_version === 2);
  }

  L.check('Aucune erreur JS sur tout le parcours', page.jsErrors.length === 0, page.jsErrors.join(' | '));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
