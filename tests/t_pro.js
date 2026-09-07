// Parcours « Trouver un professionnel automobile »
const L = require('./lib.js');

function futur(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function setVal(page, id, v) {
  await page.evaluate(([i, val]) => {
    const e = document.getElementById(i);
    e.value = val;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, v]);
  await page.waitForTimeout(30);
}

async function ouvrirRubrique(page, cle) {
  await page.evaluate(c => proBasculerRubrique(c), cle);
  await page.waitForTimeout(40);
}

async function remplirVehicule(page, i, type, marque) {
  await page.evaluate(idx => proBasculerVehicule(idx), i);
  await page.waitForTimeout(30);
  await page.selectOption('#pro-veh-' + i + '-type', type);
  await page.fill('#pro-veh-' + i + '-marque', marque);
  await page.waitForTimeout(40);
}

(async () => {
  const browser = await L.launch();
  let page = await L.newPage(browser);

  // ── A. Structure et design ──
  await L.fillStep1(page, 'pro');
  await L.chooseService(page, 'professionnel');

  let etat = await page.evaluate(() => {
    const b = document.getElementById('bloc-socle-professionnel');
    const accs = ['besoin', 'vehicules', 'lieu', 'periode', 'mission']
      .map(k => document.getElementById('pro-acc-' + k));
    return {
      visible: b && b.style.display !== 'none',
      ouverts: accs.filter(a => a && a.classList.contains('ouvert')).length,
      socleMsg: (document.getElementById('client-socle-msg') || {}).style.display,
      btnDisabled: document.getElementById('client-step-next-btn').disabled
    };
  });
  L.check('A1 : bloc professionnel affiché après sélection du service', etat.visible);
  L.check('A2 : AUCUN accordéon ouvert automatiquement', etat.ouverts === 0, 'ouverts=' + etat.ouverts);
  L.check('A3 : aucun message socle « en préparation »', etat.socleMsg === 'none');
  L.check('A4 : Continuer bloqué tant que rien n\'est saisi', etat.btnDisabled === true);

  // Aucun message intermédiaire interdit
  const texte = await page.evaluate(() => (document.getElementById('bloc-socle-professionnel') || {}).textContent || '');
  L.check('A5 : aucun message d\'avancement interdit',
    !/demande est complète|Choisissez un type de besoin|information manque|vient de s'ouvrir/i.test(texte));
  L.check('A6 : aucune mention « Facultatif »', !/Facultatif/i.test(texte));
  L.check('A7 : ni immatriculation ni VIN ni restitution demandés',
    !/immatriculation|VIN|restitution/i.test(texte), texte.slice(0, 200));

  // Un clic n'ouvre QUE la rubrique choisie
  await ouvrirRubrique(page, 'besoin');
  await ouvrirRubrique(page, 'lieu');
  let ouv = await page.evaluate(() => ['besoin', 'vehicules', 'lieu', 'periode', 'mission']
    .filter(k => { const a = document.getElementById('pro-acc-' + k); return a && a.classList.contains('ouvert'); }));
  L.check('A8 : un clic n\'ouvre que la rubrique choisie',
    ouv.length === 1 && ouv[0] === 'lieu', JSON.stringify(ouv));

  // ── B. Catégorie Technicien ──
  await ouvrirRubrique(page, 'besoin');
  await page.click('input[name="pro-categorie"][value="technicien"]');
  await page.waitForTimeout(60);
  etat = await page.evaluate(() => ({
    spec: (document.getElementById('pro-specialite-group') || {}).style.display,
    miss: (document.getElementById('pro-mission-group') || {}).style.display,
    veh: (document.getElementById('pro-acc-vehicules') || {}).style.display
  }));
  L.check('B1 : Technicien affiche la spécialité', etat.spec === 'block');
  L.check('B2 : Technicien masque la mission renfort', etat.miss === 'none');
  L.check('B3 : Technicien affiche la rubrique véhicules', etat.veh === 'block');

  await page.click('input[name="pro-specialite"][value="diagnostic"]');
  await page.waitForTimeout(50);
  etat = await page.evaluate(() => ({
    nbPros: (document.getElementById('pro-nb-pros-group') || {}).style.display,
    prec: (document.getElementById('pro-metier-precision-group') || {}).style.display
  }));
  L.check('B4 : métier choisi -> nombre de professionnels demandé', etat.nbPros === 'block');
  L.check('B5 : pas de précision demandée hors « autre »', etat.prec === 'none');

  // ── C. Compteurs ──
  await ouvrirRubrique(page, 'vehicules');
  let nb = await page.evaluate(() => _proNbVehicules());
  L.check('C1 : 1 véhicule par défaut', nb === 1);
  let titre = await page.evaluate(() => document.getElementById('pro-vehicules-titre').textContent);
  L.check('C2 : libellé singulier à 1 véhicule', /Information sur le véhicule/.test(titre), titre);

  for (let i = 0; i < 5; i++) { await page.click('#pro-acc-vehicules .btn-compteur:last-of-type'); await page.waitForTimeout(30); }
  nb = await page.evaluate(() => _proNbVehicules());
  L.check('C3 : maximum 3 véhicules, impossible d\'en créer 4', nb === 3, 'nb=' + nb);
  titre = await page.evaluate(() => document.getElementById('pro-vehicules-titre').textContent);
  L.check('C4 : libellé pluriel au-delà de 1', /Informations sur les véhicules/.test(titre), titre);
  let cartes = await page.evaluate(() => document.querySelectorAll('#pro-vehicules-liste .pro-veh-acc').length);
  L.check('C5 : 3 cartes Véhicule 1/2/3 rendues', cartes === 3, 'cartes=' + cartes);

  const nbPros = await page.evaluate(() => { proMajNbPros(1); proMajNbPros(1); return _proNbPros(); });
  L.check('C6 : compteur professionnels moins/plus fonctionne', nbPros === 3, 'nbPros=' + nbPros);

  // ── D. Saisie complète Technicien ──
  await remplirVehicule(page, 0, 'berline', 'BMW Série 3');
  await remplirVehicule(page, 1, 'suv', 'Audi Q5');
  await page.evaluate(() => { proMajNbVehicules(-1); });   // retour à 2
  await page.waitForTimeout(50);

  await ouvrirRubrique(page, 'lieu');
  await page.fill('#pro-adresse-rue', '18 rue de Paris');
  await page.fill('#pro-adresse-cp', '93160');
  await page.fill('#pro-adresse-ville', 'Noisy-le-Grand');
  await L.fillContactSurPlace(page, 'pro', 'moi');

  await ouvrirRubrique(page, 'periode');
  await setVal(page, 'pro-date-debut', futur(14));
  await setVal(page, 'pro-date-fin', futur(15));
  await setVal(page, 'pro-horaire-cdeb', '09:00');
  await setVal(page, 'pro-horaire-cfin', '17:00');

  await ouvrirRubrique(page, 'mission');
  await page.fill('#pro-description', 'Recherche de panne et diagnostic électronique');
  await page.evaluate(() => _proMajBoutonContinuer());
  await page.waitForTimeout(60);

  let s = await L.btnState(page);
  L.check('D1 : Continuer actif une fois tout renseigné', s.disabled === false);

  // ── E. Récapitulatif direct (sans étape 4) ──
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(250);
  let st = await L.step(page);
  L.check('E1 : Continuer mène directement au récapitulatif (2 -> 5)', st === 5, 'étape=' + st);

  let recap = await page.evaluate(() => (document.getElementById('recap-demande') || {}).textContent.replace(/\s+/g, ' '));
  L.check('E2 : récap contient le besoin', /Technicien automobile/.test(recap), recap.slice(0, 300));
  L.check('E3 : récap contient la spécialité', /Diagnostic/.test(recap));
  L.check('E4 : récap contient les 2 véhicules', /BMW Série 3/.test(recap) && /Audi Q5/.test(recap));
  L.check('E5 : récap contient le contact sur place', /Contact sur place/.test(recap) && /TEST-QA Dupont/.test(recap));
  L.check('E6 : récap contient la période', /Durée/.test(recap) && /2 jours/.test(recap), recap.slice(0, 600));
  L.check('E7 : récap sans informations complémentaires vides',
    !/Informations complémentaires/.test(recap), recap.slice(0, 600));

  // ── F. Payload ──
  let d = await page.evaluate(() => _construireDetailsProfessionnel());
  L.check('F1 : payload catégorie technicien', d.categorie === 'technicien');
  L.check('F2 : payload spécialité diagnostic', d.specialite === 'diagnostic');
  L.check('F3 : payload mission renfort absente', d.mission === null);
  L.check('F4 : payload 2 véhicules', d.nombre_vehicules === 2 && d.vehicules.length === 2, JSON.stringify(d.vehicules));
  L.check('F5 : payload contact sur place résolu', d.contact_sur_place && d.contact_sur_place.type === 'moi');
  L.check('F6 : payload durée calculée, jamais demandée', d.duree_jours === 2, 'duree=' + d.duree_jours);
  L.check('F7 : payload informations complémentaires nulles si vides', d.informations_complementaires === null);

  // ── G. Changement de catégorie : remise à zéro RÉELLE ──
  await page.evaluate(() => { _formStepState.client = 2; _renderFormStep('client'); });
  await page.waitForTimeout(80);
  await ouvrirRubrique(page, 'besoin');
  await page.click('input[name="pro-categorie"][value="renfort"]');
  await page.waitForTimeout(80);

  let apres = await page.evaluate(() => ({
    specCochee: !!document.querySelector('input[name="pro-specialite"]:checked'),
    vehVisible: (document.getElementById('pro-acc-vehicules') || {}).style.display,
    missVisible: (document.getElementById('pro-mission-group') || {}).style.display,
    payload: _construireDetailsProfessionnel(),
    memoire: Object.keys(_proMemoireVehicules).length
  }));
  L.check('G1 : changement de catégorie décoche l\'ancien métier', apres.specCochee === false);
  L.check('G2 : rubrique véhicules disparaît pour le renfort', apres.vehVisible === 'none');
  L.check('G3 : question mission affichée pour le renfort', apres.missVisible === 'block');
  L.check('G4 : PAYLOAD purgé de l\'ancienne spécialité', apres.payload.specialite === null);
  L.check('G5 : PAYLOAD purgé des anciens véhicules',
    apres.payload.nombre_vehicules === null && apres.payload.vehicules.length === 0,
    JSON.stringify(apres.payload.vehicules));
  L.check('G6 : mémoire véhicules réellement vidée', apres.memoire === 0, 'mem=' + apres.memoire);

  // Récap ne doit plus contenir l'ancienne valeur
  const recapApres = await page.evaluate(() => { construireRecapProfessionnel(); return (document.getElementById('recap-demande') || {}).textContent; });
  L.check('G7 : RÉCAP purgé des anciens véhicules', !/BMW Série 3|Audi Q5/.test(recapApres));

  // ── H. Option « Je souhaite être conseillé » ──
  await page.click('input[name="pro-mission"][value="conseil"]');
  await page.waitForTimeout(60);
  let conseil = await page.evaluate(() => ({
    nbProsVisible: (document.getElementById('pro-nb-pros-group') || {}).style.display,
    payload: _construireDetailsProfessionnel(),
    rubriqueOk: _proRubriqueComplete('besoin')
  }));
  L.check('H1 : conseillé -> aucun nombre de professionnels imposé', conseil.nbProsVisible === 'none');
  L.check('H2 : conseillé -> nombre de professionnels absent du payload',
    conseil.payload.nombre_professionnels === null);
  L.check('H3 : conseillé -> aucune mission précise imposée', conseil.payload.mission === null);
  L.check('H4 : conseillé -> drapeau conseil enregistré', conseil.payload.conseil === true);
  L.check('H5 : conseillé -> rubrique besoin considérée complète', conseil.rubriqueOk === true);

  // ── I. Précision obligatoire sur « autre » ──
  await page.click('input[name="pro-mission"][value="autre"]');
  await page.waitForTimeout(60);
  let autre = await page.evaluate(() => ({
    precVisible: (document.getElementById('pro-metier-precision-group') || {}).style.display,
    complete: _proRubriqueComplete('besoin')
  }));
  L.check('I1 : « autre » affiche la précision', autre.precVisible === 'block');
  L.check('I2 : « autre » sans précision -> rubrique incomplète', autre.complete === false);
  await page.fill('#pro-metier-precision', 'Préparation esthétique');
  await page.evaluate(() => _proMajBoutonContinuer());
  autre = await page.evaluate(() => ({ complete: _proRubriqueComplete('besoin'), payload: _construireDetailsProfessionnel() }));
  L.check('I3 : précision saisie -> rubrique complète', autre.complete === true);
  L.check('I4 : précision présente dans le payload', autre.payload.precision === 'Préparation esthétique');

  // changement de métier -> la précision disparaît réellement
  await page.click('input[name="pro-mission"][value="jockey"]');
  await page.waitForTimeout(60);
  const apresMetier = await page.evaluate(() => ({
    champ: (document.getElementById('pro-metier-precision') || {}).value,
    payload: _construireDetailsProfessionnel()
  }));
  L.check('I5 : changement de métier vide la précision', apresMetier.champ === '');
  L.check('I6 : précision purgée du payload', apresMetier.payload.precision === null);

  L.check('Aucune erreur JS sur tout le parcours', page.jsErrors.length === 0, page.jsErrors.join(' | '));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
