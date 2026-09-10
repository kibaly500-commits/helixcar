// « TROUVER UN PROFESSIONNEL » — MÉTIERS, ALIGNEMENT, VALIDATIONS
const L = require('./lib.js');
const { RACINE, fichier, urlFichier } = L;

async function ouvrirRubrique(page, cle) {
  await page.evaluate(c => proBasculerRubrique(c), cle);
  await page.waitForTimeout(60);
}
// LOT D4 — le helper de saisie des vehicules a ete retire avec la
// rubrique elle-meme.

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);

  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'professionnel');
  await L.ouvrirEtapeProfessionnel(page);
  L.check('A0 : les blocs testés sont réellement visibles à l’étape dédiée',
    await page.locator('#bloc-socle-professionnel').isVisible());
  await ouvrirRubrique(page, 'besoin');

  // ── A. MÉTIERS ──
  const metiers = await page.evaluate(() => ({
    missions: Array.from(document.querySelectorAll('input[name="pro-mission"]'))
      .map(i => ({ valeur: i.value, texte: i.closest('label').textContent.trim() })),
    libelles: PRO_LIB_MISSION,
    exemple: (document.getElementById('pro-metier-precision') || {}).placeholder,
    descRenfort: (document.querySelector('input[name="pro-categorie"][value="renfort"]')
      .closest('label').querySelector('.hc-opt-desc') || {}).textContent || ''
  }));
  const valeurs = metiers.missions.map(m => m.valeur);
  L.check('A1 : « Accueil en concession » remplace l\'ancien libellé',
    metiers.libelles.accueil_preparation === 'Accueil en concession'
    && metiers.missions.some(m => m.texte === 'Accueil en concession'), JSON.stringify(metiers.missions));
  L.check('A2 : plus aucune mention de « Accueil et préparation des véhicules »',
    !JSON.stringify(metiers).includes('Accueil et préparation'));
  L.check('A3 : « Soutien administratif » est proposé',
    valeurs.includes('soutien_administratif')
    && metiers.libelles.soutien_administratif === 'Soutien administratif', JSON.stringify(valeurs));
  L.check('A4 : Jockey, Une autre mission et Je souhaite être conseillé sont conservés',
    valeurs.includes('jockey') && valeurs.includes('autre') && valeurs.includes('conseil'), JSON.stringify(valeurs));
  L.check('A5 : l\'exemple de spécialité est « Technicien vitrage automobile »',
    metiers.exemple === 'Ex : Technicien vitrage automobile', metiers.exemple);
  L.check('A6 : la description du renfort cite les nouveaux métiers',
    /accueil en concession/i.test(metiers.descRenfort) && /soutien administratif/i.test(metiers.descRenfort),
    metiers.descRenfort);

  // ── B. ALIGNEMENT DES CARTES MÉTIER ──
  for (const [nom, largeur] of [['ordinateur', 1280], ['mobile', 390]]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.waitForTimeout(150);
    const pos = await page.evaluate(() => {
      const cartes = Array.from(document.querySelectorAll('input[name="pro-categorie"]'))
        .map(i => i.closest('.radio-opt'));
      return cartes.map(c => {
        const b = c.getBoundingClientRect();
        const radio = c.querySelector('input[type="radio"]').getBoundingClientRect();
        const bloc = c.querySelector('span');
        const desc = c.querySelector('.hc-opt-desc');
        return {
          radioX: Math.round(radio.left - b.left), radioY: Math.round(radio.top - b.top),
          titreX: Math.round(bloc.getBoundingClientRect().left - b.left),
          titreY: Math.round(bloc.getBoundingClientRect().top - b.top),
          descX: desc ? Math.round(desc.getBoundingClientRect().left - b.left) : null,
          hauteurDesc: desc ? Math.round(desc.getBoundingClientRect().height) : 0
        };
      });
    });
    const [a, bb] = pos;
    L.check('B-' + nom + ' : les mesures ne portent pas sur des blocs masqués',
      a.hauteurDesc > 0 && bb.hauteurDesc > 0, JSON.stringify(pos));
    L.check('B-' + nom + ' : les boutons radio démarrent au même endroit',
      a.radioX === bb.radioX && a.radioY === bb.radioY, JSON.stringify(pos));
    console.log('   [diag B-' + nom + ']', JSON.stringify(pos));
    L.check('B-' + nom + ' : les titres démarrent au même endroit',
      a.titreX === bb.titreX && a.titreY === bb.titreY, JSON.stringify(pos));
    L.check('B-' + nom + ' : les descriptions démarrent au même endroit',
      a.descX === bb.descX, JSON.stringify(pos));
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.waitForTimeout(120);

  const specialites = await page.evaluate(() => {
    document.querySelector('input[name="pro-categorie"][value="technicien"]').click();
    proOnCategorieChange();
    const cartes = Array.from(document.querySelectorAll('input[name="pro-specialite"]'))
      .map(i => i.closest('.radio-opt'));
    return cartes.map(c => {
      const b = c.getBoundingClientRect();
      const r = c.querySelector('input[type="radio"]').getBoundingClientRect();
      return Math.round(r.left - b.left);
    });
  });
  await page.waitForTimeout(120);
  L.check('B1 : Mécanique, Carrosserie, Diagnostic… sont alignés entre eux',
    specialites.length > 1 && specialites.every(x => x === specialites[0]), JSON.stringify(specialites));

  // ── C. NUMÉROS DE VALIDATION ──
  const avantOk = await page.evaluate(() => {
    const acc = document.getElementById('pro-acc-besoin');
    if (!acc.classList.contains('ouvert')) proBasculerRubrique('besoin');
    return { ouverte: acc.classList.contains('ouvert'), verte: acc.classList.contains('termine') };
  });
  L.check('C1 : ouvrir une section ne suffit JAMAIS à la marquer terminée',
    avantOk.ouverte === true && avantOk.verte === false, JSON.stringify(avantOk));

  const okIncomplet = await page.evaluate(() => {
    proOkRubrique('besoin');
    const acc = document.getElementById('pro-acc-besoin');
    return acc.classList.contains('termine');
  });
  L.check('C2 : OK sur une section incomplète ne la fait pas verdir', okIncomplet === false);

  await page.evaluate(() => {
    document.querySelector('input[name="pro-specialite"][value="mecanique"]').click();
    proOnMetierChange();
  });
  await page.waitForTimeout(80);
  const okComplet = await page.evaluate(() => {
    proOkRubrique('besoin');
    const acc = document.getElementById('pro-acc-besoin');
    return { verte: acc.classList.contains('termine'), fermee: !acc.classList.contains('ouvert') };
  });
  L.check('C3 : OK sur une section complète la fait verdir et la referme',
    okComplet.verte === true && okComplet.fermee === true, JSON.stringify(okComplet));

  const redevientRouge = await page.evaluate(() => {
    document.querySelectorAll('input[name="pro-specialite"]').forEach(i => { i.checked = false; });
    proOnMetierChange();
    _proMajBoutonContinuer();
    return document.getElementById('pro-acc-besoin').classList.contains('termine');
  });
  L.check('C4 : rendre la section incomplète la repasse au rouge', redevientRouge === false);

  // ── D. LA RUBRIQUE VÉHICULES A DISPARU (lot D4) ──
  //
  // RÈGLE INVERSÉE SUR DEMANDE EXPLICITE. Cette section vérifiait que
  // chaque carte véhicule portait ses propres boutons Effacer / OK et
  // que l'une n'affectait jamais l'autre. Le propriétaire demande le
  // retrait complet de la rubrique pour la catégorie « Technicien
  // automobile » — la seule qui la possédait. Les contrôles ne sont pas
  // supprimés : ils exigent maintenant l'absence, ce qui est plus
  // strict que l'ancienne indépendance.
  await page.evaluate(() => {
    document.querySelector('input[name="pro-specialite"][value="mecanique"]').click();
    proOnMetierChange();
  });
  await page.waitForTimeout(120);

  const plusDeVehicules = await page.evaluate(() => ({
    accordeon: !!document.getElementById('pro-acc-vehicules'),
    liste: !!document.getElementById('pro-vehicules-liste'),
    compteur: !!document.getElementById('pro-nb-vehicules'),
    cartes: document.querySelectorAll('.pro-veh-acc').length,
    champs: document.querySelectorAll('[id^="pro-veh-"]').length,
    fonctions: ['proMajNbVehicules', 'proRendreVehicules', 'proOkVehicule',
                'proEffacerVehicule', 'proBasculerVehicule', '_proMemoriserVehicule',
                '_proMajEtatVehicules', '_proVehiculesApplicables']
      .filter(f => typeof window[f] === 'function'),
    rubriques: PRO_RUBRIQUES.slice()
  }));
  L.check('D1 : plus aucune carte, aucun champ, aucun compteur de véhicule',
    plusDeVehicules.accordeon === false && plusDeVehicules.liste === false
    && plusDeVehicules.compteur === false && plusDeVehicules.cartes === 0
    && plusDeVehicules.champs === 0, JSON.stringify(plusDeVehicules));
  L.check('D2 : plus aucune fonction ne les pilote',
    plusDeVehicules.fonctions.length === 0, JSON.stringify(plusDeVehicules.fonctions));
  L.check('D3 : les quatre rubriques conservées, dans l\'ordre demandé',
    JSON.stringify(plusDeVehicules.rubriques)
      === JSON.stringify(['besoin', 'lieu', 'periode', 'mission']),
    JSON.stringify(plusDeVehicules.rubriques));

  // Le nombre de PROFESSIONNELS, lui, est conservé : il porte sur des
  // personnes, pas sur un parc.
  const pros = await page.evaluate(() => {
    proMajNbPros(1);
    return { valeur: _proNbPros(), champ: !!document.getElementById('pro-nb-pros') };
  });
  L.check('D4 : le compteur de professionnels est conservé et fonctionne',
    pros.champ === true && pros.valeur >= 2, JSON.stringify(pros));

  L.check('D7 : aucune erreur JS', page.jsErrors.length === 0, page.jsErrors.join(' | '));

  // ── F. ACTIONS SOUS MISSION ──
  await ouvrirRubrique(page, 'mission');
  const libelleMission = await page.evaluate(() =>
    (document.getElementById('pro-description-label') || {}).textContent.trim());
  L.check('F1 : le libellé est « Décrivez la mission brièvement »',
    /Décrivez la mission brièvement/.test(libelleMission), libelleMission);

  const zones = await page.evaluate(() => ({
    description: !!document.getElementById('pro-description'),
    infos: !!document.getElementById('pro-infos'),
    distinctes: document.getElementById('pro-description') !== document.getElementById('pro-infos')
  }));
  L.check('F2 : « Informations complémentaires » reste une zone séparée',
    zones.description && zones.infos && zones.distinctes, JSON.stringify(zones));

  // Effacer global : refus de confirmation -> rien n'est touché.
  // On renseigne sans dépendre de la section ouverte : ce qui est
  // vérifié ici est l'effacement, pas la saisie.
  await page.evaluate(() => {
    document.getElementById('pro-description').value = 'TEST-QA mission décrite';
    document.getElementById('pro-adresse-rue').value = '25 avenue Victor-Hugo';
    document.getElementById('pro-adresse-ville').value = 'Paris';
  });
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.dismiss());
  await page.evaluate(() => proEffacerToutLeFormulaire());
  await page.waitForTimeout(150);
  const apresRefus = await page.evaluate(() => ({
    description: (document.getElementById('pro-description') || {}).value,
    rue: (document.getElementById('pro-adresse-rue') || {}).value
  }));
  L.check('F3 : annuler la confirmation n\'efface RIEN',
    apresRefus.description === 'TEST-QA mission décrite'
    && apresRefus.rue === '25 avenue Victor-Hugo', JSON.stringify(apresRefus));

  // Effacer global : confirmation -> toute la demande est vidée.
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => proEffacerToutLeFormulaire());
  await page.waitForTimeout(200);
  const apresEffacement = await page.evaluate(() => ({
    description: (document.getElementById('pro-description') || {}).value,
    rue: (document.getElementById('pro-adresse-rue') || {}).value,
    ville: (document.getElementById('pro-adresse-ville') || {}).value,
    specialite: !!document.querySelector('input[name="pro-specialite"]:checked'),
    rubriquesVertes: PRO_RUBRIQUES.filter(c => {
      const a = document.getElementById('pro-acc-' + c);
      return a && a.classList.contains('termine');
    }).length
  }));
  L.check('F4 : confirmer vide TOUTE la demande, pas seulement Mission',
    apresEffacement.description === '' && apresEffacement.rue === ''
    && apresEffacement.ville === '' && apresEffacement.specialite === false,
    JSON.stringify(apresEffacement));
  L.check('F5 : plus aucune section ne reste marquée validée',
    apresEffacement.rubriquesVertes === 0, String(apresEffacement.rubriquesVertes));

  // OK sous Mission ne valide QUE Mission.
  await page.evaluate(() => {
    proBasculerRubrique('mission');
    document.getElementById('pro-description').value = 'TEST-QA autre mission';
    proOkRubrique('mission');
  });
  await page.waitForTimeout(150);
  const okMission = await page.evaluate(() => PRO_RUBRIQUES.map(c => {
    const a = document.getElementById('pro-acc-' + c);
    return { cle: c, verte: !!(a && a.classList.contains('termine')) };
  }));
  L.check('F6 : OK sous Mission ne valide QUE la section Mission',
    okMission.filter(x => x.verte).every(x => x.cle === 'mission'), JSON.stringify(okMission));

  // ── E. EXEMPLES D'ADRESSE ──
  await ouvrirRubrique(page, 'lieu');
  const adresses = await page.evaluate(() => ({
    rue: (document.getElementById('pro-adresse-rue') || {}).placeholder,
    cp: (document.getElementById('pro-adresse-cp') || {}).placeholder,
    ville: (document.getElementById('pro-adresse-ville') || {}).placeholder
  }));
  L.check('E1 : l\'exemple d\'adresse est « 25 avenue Victor-Hugo, 75016 Paris »',
    adresses.rue === '25 avenue Victor-Hugo' && adresses.cp === '75016' && adresses.ville === 'Paris',
    JSON.stringify(adresses));

  const fs = require('fs');
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  L.check('E2 : le site RÉEL d\'HelixCar n\'a pas été touché',
    /ville:\s*'Noisy-le-Grand'/.test(idx) && /code_postal:\s*'93160'/.test(idx));

  const nbEchecs = L.results();
  await browser.close();
  process.exit(nbEchecs ? 1 : 0);
})();
