// Parcours « Trouver un professionnel automobile »
const L = require('./lib.js');
const { jourCivil, dansNJours } = L;

// Date CIVILE, jamais UTC : toISOString() reculerait d'un jour en
// France (voir jourCivil dans tests/env.js).
const futur = dansNJours;

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

// LOT D4 — le helper de saisie des vehicules a ete retire avec la
// rubrique elle-meme.

(async () => {
  const browser = await L.launch();
  let page = await L.newPage(browser);

  // ── A. Structure et design ──
  await L.fillStep1(page, 'pro');
  await L.chooseService(page, 'professionnel');

  let etat = await page.evaluate(() => {
    const b = document.getElementById('bloc-socle-professionnel');
    const accs = ['besoin', 'lieu', 'periode', 'mission']
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
  // Le bouton n'est plus jamais grisé (§6) : c'est le CLIC qui bloque et
  // signale les manques. On vérifie donc la garantie utile — on ne
  // franchit pas l'étape — et non plus l'état visuel du bouton.
  L.check('A4 : le bouton Continuer reste actif et cliquable', etat.btnDisabled === false);
  const blocage = await page.evaluate(() => {
    const avant = _formStepState.client;
    clientStepNext();
    return { avant, apres: _formStepState.client,
             erreurs: document.querySelectorAll('#modal-client .field-error-msg.visible').length };
  });
  L.check('A4b : mais cliquer ne franchit PAS l\'étape tant que rien n\'est saisi',
    blocage.apres === blocage.avant && blocage.erreurs > 0, JSON.stringify(blocage));

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
  let ouv = await page.evaluate(() => ['besoin', 'lieu', 'periode', 'mission']
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
    veh: !!document.getElementById('pro-acc-vehicules'),
    rubriques: PRO_RUBRIQUES.slice()
  }));
  L.check('B1 : Technicien affiche la spécialité', etat.spec === 'block');
  L.check('B2 : Technicien masque la mission renfort', etat.miss === 'none');
  // ══ RÈGLE INVERSÉE SUR DEMANDE EXPLICITE (lot D4) ══
  // La rubrique « Informations sur les véhicules » n'existait QUE pour
  // le technicien. Le propriétaire demande son retrait complet : un
  // besoin de technicien porte sur des PERSONNES et sur une période,
  // jamais sur un parc. Le contrôle n'est pas supprimé, il est retourné
  // — et il devient plus strict : la rubrique ne doit plus exister DU
  // TOUT, pour aucune catégorie.
  L.check('B3 : la rubrique véhicules n\'existe plus, même pour le technicien',
    etat.veh === false, JSON.stringify(etat.veh));
  L.check('B3 bis : les quatre rubriques conservées sont exactement celles demandées',
    JSON.stringify(etat.rubriques) === JSON.stringify(['besoin', 'lieu', 'periode', 'mission']),
    JSON.stringify(etat.rubriques));

  await page.click('input[name="pro-specialite"][value="diagnostic"]');
  await page.waitForTimeout(50);
  etat = await page.evaluate(() => ({
    nbPros: (document.getElementById('pro-nb-pros-group') || {}).style.display,
    prec: (document.getElementById('pro-metier-precision-group') || {}).style.display
  }));
  L.check('B4 : métier choisi -> nombre de professionnels demandé', etat.nbPros === 'block');
  L.check('B5 : pas de précision demandée hors « autre »', etat.prec === 'none');

  // ── C. Compteurs ──
  // LOT D4 — le compteur de véhicules et ses cartes ont disparu. Le
  // compteur de PROFESSIONNELS, lui, est conservé : il porte sur des
  // personnes, pas sur des véhicules.
  const plusAucunVehicule = await page.evaluate(() => ({
    compteur: !!document.getElementById('pro-nb-vehicules'),
    liste: !!document.getElementById('pro-vehicules-liste'),
    titre: !!document.getElementById('pro-vehicules-titre'),
    cartes: document.querySelectorAll('.pro-veh-acc').length,
    fonctions: ['proMajNbVehicules', 'proRendreVehicules', '_proNbVehicules',
                '_proVehiculesApplicables', '_proVehiculesRetenus']
      .filter(f => typeof window[f] === 'function')
  }));
  L.check('C1 : plus de compteur, plus de liste, plus de titre, plus de carte',
    plusAucunVehicule.compteur === false && plusAucunVehicule.liste === false
    && plusAucunVehicule.titre === false && plusAucunVehicule.cartes === 0,
    JSON.stringify(plusAucunVehicule));
  L.check('C2 : et plus aucune fonction ne les pilote',
    plusAucunVehicule.fonctions.length === 0, JSON.stringify(plusAucunVehicule.fonctions));

  const nbPros = await page.evaluate(() => { proMajNbPros(1); proMajNbPros(1); return _proNbPros(); });
  L.check('C6 : compteur professionnels moins/plus fonctionne', nbPros === 3, 'nbPros=' + nbPros);

  // ── D. Saisie complète Technicien ──
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
  // LOT D4 — et le récapitulatif ne montre plus aucun véhicule.
  L.check('E4 : le récapitulatif ne contient aucun véhicule',
    !/Informations? sur les? véhicules?|Nombre de véhicules|Véhicule 1/.test(recap),
    recap.slice(0, 400));
  L.check('E5 : récap contient le contact sur place', /Contact sur place/.test(recap) && /TEST-QA Dupont/.test(recap));
  L.check('E6 : récap contient la période', /Durée/.test(recap) && /2 jours/.test(recap), recap.slice(0, 600));
  L.check('E7 : récap sans informations complémentaires vides',
    !/Informations complémentaires/.test(recap), recap.slice(0, 600));

  // ── F. Payload ──
  let d = await page.evaluate(() => _construireDetailsProfessionnel());
  L.check('F1 : payload catégorie technicien', d.categorie === 'technicien');
  L.check('F2 : payload spécialité diagnostic', d.specialite === 'diagnostic');
  L.check('F3 : payload mission renfort absente', d.mission === null);
  // LOT D4 — plus AUCUNE quantité ni fiche de véhicule dans le payload,
  // et surtout aucun véhicule inventé : jamais 1 par défaut.
  L.check('F4 : le payload ne porte plus aucun véhicule',
    d.nombre_vehicules === null && Array.isArray(d.vehicules) && d.vehicules.length === 0,
    JSON.stringify({ n: d.nombre_vehicules, v: d.vehicules }));
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
    vehVisible: !!document.getElementById('pro-acc-vehicules'),
    missVisible: (document.getElementById('pro-mission-group') || {}).style.display,
    payload: _construireDetailsProfessionnel()
  }));
  L.check('G1 : changement de catégorie décoche l\'ancien métier', apres.specCochee === false);
  L.check('G2 : aucune rubrique véhicules ne réapparaît pour le renfort',
    apres.vehVisible === false);
  L.check('G3 : question mission affichée pour le renfort', apres.missVisible === 'block');
  L.check('G4 : PAYLOAD purgé de l\'ancienne spécialité', apres.payload.specialite === null);
  L.check('G5 : PAYLOAD sans aucun véhicule',
    apres.payload.nombre_vehicules === null && apres.payload.vehicules.length === 0,
    JSON.stringify(apres.payload.vehicules));

  // Récap ne doit plus contenir l'ancienne valeur
  const recapApres = await page.evaluate(() => { construireRecapProfessionnel(); return (document.getElementById('recap-demande') || {}).textContent; });
  L.check('G7 : RÉCAP sans aucun véhicule',
    !/BMW Série 3|Audi Q5|Véhicule 1|véhicule\(s\)/.test(recapApres));

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
