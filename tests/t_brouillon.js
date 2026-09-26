// Brouillon (F5), boutons Effacer / OK des rubriques, retour arrière
const L = require('./lib.js');
const { jourCivil, dansNJours } = L;

// Date CIVILE, jamais UTC : toISOString() reculerait d'un jour en
// France (voir jourCivil dans tests/env.js).
const futur = dansNJours;
async function setVal(page, id, v) {
  await page.evaluate(([i, val]) => {
    const e = document.getElementById(i); e.value = val;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, v]);
  await page.waitForTimeout(25);
}

(async () => {
  const browser = await L.launch();

  // ── A. Effacer / OK d'une rubrique ──
  let page = await L.newPage(browser);
  await L.fillStep1(page, 'pro');
  await L.chooseService(page, 'professionnel');
  // LOT F01 — les rubriques vivent à l'étape 3 dédiée : on l'ouvre d'abord.
  await L.ouvrirEtapeProfessionnel(page);
  await page.evaluate(() => proBasculerRubrique('besoin'));
  await page.click('input[name="pro-categorie"][value="technicien"]');
  await page.waitForTimeout(50);
  await page.click('input[name="pro-specialite"][value="mecanique"]');
  await page.waitForTimeout(50);

  // OK sur une rubrique complète : referme la rubrique
  await page.evaluate(() => proOkRubrique('besoin'));
  await page.waitForTimeout(60);
  let r = await page.evaluate(() => ({
    ouvert: document.getElementById('pro-acc-besoin').classList.contains('ouvert'),
    cat: _proCategorie(), spec: _proSpecialite()
  }));
  L.check('A1 : OK sur rubrique complète -> rubrique refermée', r.ouvert === false);
  L.check('A2 : OK conserve les valeurs saisies', r.cat === 'technicien' && r.spec === 'mecanique');

  // OK sur une rubrique incomplète : reste ouverte et signale l'erreur
  await page.evaluate(() => { proBasculerRubrique('lieu'); proOkRubrique('lieu'); });
  await page.waitForTimeout(60);
  r = await page.evaluate(() => ({
    ouvert: document.getElementById('pro-acc-lieu').classList.contains('ouvert'),
    err: (document.getElementById('pro-adresse-rue-err') || {}).textContent || ''
  }));
  L.check('A3 : OK sur rubrique incomplète -> rubrique reste ouverte', r.ouvert === true);
  L.check('A4 : OK signale le champ réellement manquant', /obligatoire/i.test(r.err), r.err);

  // Effacer ne nettoie QUE sa rubrique
  await page.fill('#pro-adresse-rue', '18 rue de Paris');
  await page.fill('#pro-adresse-cp', '93160');
  await page.fill('#pro-adresse-ville', 'Noisy-le-Grand');
  await page.evaluate(() => proEffacerRubrique('lieu'));
  await page.waitForTimeout(60);
  r = await page.evaluate(() => ({
    rue: document.getElementById('pro-adresse-rue').value,
    cat: _proCategorie(), spec: _proSpecialite()
  }));
  L.check('A5 : Effacer vide bien sa rubrique', r.rue === '');
  L.check('A6 : Effacer ne touche PAS les autres rubriques',
    r.cat === 'technicien' && r.spec === 'mecanique', JSON.stringify(r));
  await page.close();

  // ── B. Brouillon : saisie, F5, restauration ──
  page = await L.newPage(browser);
  await L.fillStep1(page, 'pro');
  await L.chooseService(page, 'professionnel');
  // LOT F01 — les rubriques vivent à l'étape 3 dédiée : on l'ouvre d'abord.
  await L.ouvrirEtapeProfessionnel(page);
  await page.evaluate(() => proBasculerRubrique('besoin'));
  await page.click('input[name="pro-categorie"][value="technicien"]');
  await page.waitForTimeout(60);
  await page.click('input[name="pro-specialite"][value="diagnostic"]');
  await page.waitForTimeout(60);
  // LOT D4 — la rubrique « Informations sur les vehicules » a ete
  // SUPPRIMEE sur demande explicite : elle n'existait que pour le
  // technicien. Le brouillon ne doit donc plus rien en memoriser, et
  // surtout un ANCIEN brouillon ne doit pas pouvoir la ressusciter.
  const plusDeVehicules = await page.evaluate(() => ({
    accordeon: !!document.getElementById('pro-acc-vehicules'),
    cartes: document.querySelectorAll('.pro-veh-acc').length
  }));
  L.check('B0a : plus aucune carte véhicule dans le parcours professionnel',
    plusDeVehicules.accordeon === false && plusDeVehicules.cartes === 0,
    JSON.stringify(plusDeVehicules));
  await page.waitForTimeout(80);

  await page.evaluate(() => proBasculerRubrique('lieu'));
  await page.fill('#pro-adresse-rue', '18 rue de Paris');
  await page.fill('#pro-adresse-cp', '93160');
  await page.fill('#pro-adresse-ville', 'Noisy-le-Grand');
  await L.fillContactSurPlace(page, 'pro', 'autre', 'Karim B.', '+33600000000');
  await page.evaluate(() => proBasculerRubrique('periode'));
  await setVal(page, 'pro-date-debut', futur(10));
  await setVal(page, 'pro-date-fin', futur(11));
  await setVal(page, 'pro-horaire-cdeb', '09:00');
  await setVal(page, 'pro-horaire-cfin', '17:00');
  await page.evaluate(() => proBasculerRubrique('mission'));
  await page.fill('#pro-description', 'Recherche de panne');

  // Force l'écriture immédiate du brouillon
  const sauve = await page.evaluate(() => {
    if (typeof _sauvegarderBrouillonClient === 'function') { _sauvegarderBrouillonClient(); return 'direct'; }
    if (typeof _planifierSauvegardeBrouillonClient === 'function') { _planifierSauvegardeBrouillonClient(); return 'planifie'; }
    return 'absent';
  });
  await page.waitForTimeout(1500);
  const cle = await page.evaluate(() => {
    const k = Object.keys(localStorage).filter(x => /brouillon/i.test(x));
    return { cles: k, contenu: k.length ? localStorage.getItem(k[0]).slice(0, 60) : '' };
  });
  L.check('B1 : brouillon réellement écrit (' + sauve + ')', cle.cles.length > 0, JSON.stringify(cle.cles));

  const contenuBrouillon = await page.evaluate(() => {
    const k = Object.keys(localStorage).filter(x => /brouillon/i.test(x))[0];
    if (!k) return null;
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  });
  // RÈGLE INVERSÉE SUR DEMANDE EXPLICITE (lot D4) : le brouillon ne
  // mémorise plus AUCUN véhicule professionnel. Le contrôle n'est pas
  // supprimé, il exige maintenant l'inverse — et c'est plus strict.
  L.check('B2 : le brouillon ne mémorise plus aucun véhicule professionnel',
    contenuBrouillon
    && JSON.stringify(contenuBrouillon.professionnelVehicules || {}) === '{}',
    JSON.stringify(contenuBrouillon && contenuBrouillon.professionnelVehicules));

  // F5 réel
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  const restaure = await page.evaluate(() => {
    // Rejoue la restauration comme le fait la reprise de brouillon
    const k = Object.keys(localStorage).filter(x => /brouillon/i.test(x))[0];
    if (!k) return { erreur: 'aucun brouillon' };
    let b = null; try { b = JSON.parse(localStorage.getItem(k)); } catch (e) { return { erreur: 'illisible' }; }
    try { openModal('client'); } catch (e) {}
    if (typeof _restaurerBrouillonClientSiPresent === 'function') _restaurerBrouillonClientSiPresent();
    else return { erreur: 'fonction de restauration introuvable' };
    return {
      service: _typeServiceChoisi(),
      categorie: _proCategorie(),
      specialite: _proSpecialite(),
      vehiculesResiduels: document.querySelectorAll('[id^="pro-veh-"], #pro-acc-vehicules').length,
      adresse: _proAdresseRue(),
      contact: _hcContactSurPlace('pro'),
      payload: _construireDetailsProfessionnel(),
      btnDisabled: document.getElementById('client-step-next-btn').disabled
    };
  });

  if (restaure.erreur) {
    L.check('B3 : restauration du brouillon exécutable', false, restaure.erreur);
  } else {
    L.check('B3 : service restauré', restaure.service === 'professionnel', JSON.stringify(restaure.service));
    L.check('B4 : catégorie et métier restaurés',
      restaure.categorie === 'technicien' && restaure.specialite === 'diagnostic', JSON.stringify(restaure));
    // LOT D4 — une reprise de brouillon ne doit RIEN faire réapparaître.
    L.check('B5 : la reprise ne ressuscite aucune rubrique véhicule',
      restaure.vehiculesResiduels === 0, String(restaure.vehiculesResiduels));
    L.check('B6 : et le payload restauré n\'en porte aucun',
      restaure.payload.nombre_vehicules === null
      && (restaure.payload.vehicules || []).length === 0,
      JSON.stringify(restaure.payload.vehicules));
    L.check('B8 : adresse restaurée', restaure.adresse === '18 rue de Paris', restaure.adresse);
    L.check('B9 : contact sur place restauré',
      restaure.contact && restaure.contact.nom === 'Karim B.', JSON.stringify(restaure.contact));
    L.check('B10 : payload complet après restauration',
      restaure.payload && !!restaure.payload.date_debut && !!restaure.payload.date_fin
      && !!restaure.payload.heure_debut,
      JSON.stringify(restaure.payload && {
        d: restaure.payload.date_debut, f: restaure.payload.date_fin,
        h: restaure.payload.heure_debut }));
    L.check('B11 : état du bouton recalculé après restauration (sans clic ailleurs)',
      restaure.btnDisabled === false, 'disabled=' + restaure.btnDisabled);
  }

  L.check('Aucune erreur JS', page.jsErrors.length === 0, page.jsErrors.join(' | '));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
