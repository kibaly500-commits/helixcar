// Brouillon (F5), boutons Effacer / OK des rubriques, retour arrière
const L = require('./lib.js');

function futur(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
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
  await page.evaluate(() => proBasculerRubrique('besoin'));
  await page.click('input[name="pro-categorie"][value="technicien"]');
  await page.waitForTimeout(60);
  await page.click('input[name="pro-specialite"][value="diagnostic"]');
  await page.waitForTimeout(60);
  await page.evaluate(() => { proMajNbVehicules(1); });   // 2 véhicules
  await page.waitForTimeout(60);
  // Un seul véhicule est ouvert à la fois (accordéon exclusif voulu) :
  // on remplit chaque carte pendant qu'elle est ouverte. Le <select> natif
  // est enveloppé par le widget select maison (data-hc-select), donc on
  // écrit la valeur puis on déclenche 'change', comme le fait le widget.
  const habille = await page.evaluate(() => {
    function remplir(i, type, marque) {
      proBasculerVehicule(i);
      var sel = document.getElementById('pro-veh-' + i + '-type');
      sel.value = type; sel.dispatchEvent(new Event('change', { bubbles: true }));
      var inp = document.getElementById('pro-veh-' + i + '-marque');
      inp.value = marque; inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    remplir(0, 'berline', 'BMW Série 3');
    remplir(1, 'suv', 'Audi Q5');
    return {
      widget0: !!document.querySelector('#pro-veh-acc-0 .hc-select-wrap'),
      widget1: !!document.querySelector('#pro-veh-acc-1 .hc-select-wrap'),
      ouverts: document.querySelectorAll('#pro-vehicules-liste .pro-veh-acc.ouvert').length
    };
  });
  L.check('B0a : les selects véhicule reçoivent le widget select maison (design homogène)',
    habille.widget0 && habille.widget1, JSON.stringify(habille));
  L.check('B0b : une seule carte véhicule ouverte à la fois',
    habille.ouverts === 1, 'ouverts=' + habille.ouverts);
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
  L.check('B2 : véhicules du professionnel présents dans le brouillon',
    contenuBrouillon && contenuBrouillon.professionnelVehicules &&
    Object.keys(contenuBrouillon.professionnelVehicules).length === 2,
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
      nbVeh: _proNbVehicules(),
      veh0: (_proMemoireVehicules[0] || {}),
      veh1: (_proMemoireVehicules[1] || {}),
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
    L.check('B5 : nombre de véhicules restauré', restaure.nbVeh === 2, 'nb=' + restaure.nbVeh);
    L.check('B6 : véhicule 1 restauré',
      restaure.veh0.marque_modele === 'BMW Série 3', JSON.stringify(restaure.veh0));
    L.check('B7 : véhicule 2 restauré',
      restaure.veh1.marque_modele === 'Audi Q5', JSON.stringify(restaure.veh1));
    L.check('B8 : adresse restaurée', restaure.adresse === '18 rue de Paris', restaure.adresse);
    L.check('B9 : contact sur place restauré',
      restaure.contact && restaure.contact.nom === 'Karim B.', JSON.stringify(restaure.contact));
    L.check('B10 : payload complet après restauration',
      restaure.payload && restaure.payload.vehicules.length === 2 && !!restaure.payload.date_debut,
      JSON.stringify(restaure.payload && restaure.payload.vehicules));
    L.check('B11 : état du bouton recalculé après restauration (sans clic ailleurs)',
      restaure.btnDisabled === false, 'disabled=' + restaure.btnDisabled);
  }

  L.check('Aucune erreur JS', page.jsErrors.length === 0, page.jsErrors.join(' | '));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
