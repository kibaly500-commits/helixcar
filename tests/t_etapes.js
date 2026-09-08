// BOUTONS CONTINUER ET VALIDATIONS INDÉPENDANTES (§6)
// Rejoue le scénario exact signalé : professionnel -> étape 2 -> retour
// -> nettoyage, et vérifie qu'aucun champ caché ne bloque plus rien.
const L = require('./lib.js');

async function etatBouton(page) {
  return page.evaluate(() => {
    const b = document.getElementById('client-step-next-btn');
    return { disabled: b.disabled, opacite: b.style.opacity, curseur: b.style.cursor,
             visible: !!b.offsetParent };
  });
}

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);

  await L.fillStep1(page, 'pro');

  // ── A. LE SCÉNARIO SIGNALÉ ──
  await L.chooseService(page, 'professionnel');
  await page.evaluate(() => proBasculerRubrique('besoin'));
  await page.waitForTimeout(80);
  await page.click('input[name="pro-categorie"][value="technicien"]');
  await page.waitForTimeout(120);

  const proIncomplet = await etatBouton(page);
  L.check('A1 : professionnel incomplet — le bouton reste ACTIF et cliquable',
    proIncomplet.disabled === false && proIncomplet.visible === true, JSON.stringify(proIncomplet));

  // Retour à l'étape 1, puis bascule vers Nettoyage.
  await page.evaluate(() => clientStepPrev());
  await page.waitForTimeout(150);
  const etape1 = await etatBouton(page);
  L.check('A2 : de retour à l\'étape 1, le bouton n\'est plus grisé',
    etape1.disabled === false, JSON.stringify(etape1));

  await page.evaluate(() => { _formStepState.client = 2; _renderFormStep('client'); });
  await page.waitForTimeout(120);
  await L.chooseService(page, 'nettoyage');
  const apresBascule = await etatBouton(page);
  L.check('A3 : après bascule vers Nettoyage, le bouton est ACTIF',
    apresBascule.disabled === false, JSON.stringify(apresBascule));

  // Le clic doit signaler les manques du NETTOYAGE, pas ceux du professionnel.
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(250);
  const apresClic = await page.evaluate(() => ({
    etape: _formStepState.client,
    erreursVisibles: Array.from(document.querySelectorAll('#modal-client .field-error-msg.visible'))
      .map(e => ({ texte: e.textContent.trim().slice(0, 60), id: (e.id || e.parentElement.id || '') })),
    erreursPro: Array.from(document.querySelectorAll('#modal-client .group-error.visible'))
      .filter(e => /^pro-/.test(e.id || '')).length
  }));
  L.check('A4 : le clic bloque bien sur l\'étape 2 tant que Nettoyage est incomplet',
    apresClic.etape === 2, String(apresClic.etape));
  L.check('A5 : au moins une erreur est signalée au client',
    apresClic.erreursVisibles.length > 0, JSON.stringify(apresClic.erreursVisibles));
  L.check('A6 : AUCUNE erreur du parcours professionnel ne subsiste',
    apresClic.erreursPro === 0, JSON.stringify(apresClic.erreursVisibles));

  // ── B. LES DEUX CONTRÔLES CITÉS : RÉPARTITION ET ÉTOILAGE ──
  await page.click('#nett-elig-emplacement');
  await page.click('#nett-elig-eau-elec');
  await page.fill('#nett-nb-approx', '3');
  await page.dispatchEvent('#nett-nb-approx', 'change');
  await page.waitForTimeout(120);
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(200);
  const sansRepartition = await page.evaluate(() => ({
    etape: _formStepState.client,
    repartition: (document.querySelector('#nett-repartition-group .group-error, #nett-repartition-group + .group-error') || {}).textContent || '',
    texteGlobal: (document.getElementById('modal-client-form') || {}).textContent || ''
  }));
  L.check('B1 : « Répartition par catégorie » manquante est signalée',
    sansRepartition.etape === 2 && /[Rr]épartis|répartition/.test(sansRepartition.texteGlobal),
    sansRepartition.repartition);

  for (let i = 0; i < 3; i++) {
    await page.click('[data-cat="citadine"] .nett-rep-btn:last-child');
    await page.waitForTimeout(20);
  }
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(200);
  const sansEtoilage = await page.evaluate(() => ({
    etape: _formStepState.client,
    texteGlobal: (document.getElementById('modal-client-form') || {}).textContent || ''
  }));
  L.check('B2 : « Quel étoilage choisissez-vous ? » manquant est signalé',
    sansEtoilage.etape === 2 && /type de nettoyage|étoilage/i.test(sansEtoilage.texteGlobal),
    sansEtoilage.texteGlobal.slice(-160));

  await page.click('input[name="nett-type"][value="preparation_complete"]');
  await page.waitForTimeout(120);
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(300);
  const etape2Ok = await page.evaluate(() => _formStepState.client);
  L.check('B3 : une fois tout renseigné, l\'étape 2 est franchie', etape2Ok === 4, String(etape2Ok));

  // ── C. ALLERS-RETOURS SUCCESSIFS ENTRE SERVICES ──
  const parcours = ['convoyage', 'stockage', 'professionnel', 'nettoyage', 'convoyage'];
  let toutActif = true; const journal = [];
  for (const service of parcours) {
    await page.evaluate(() => { _formStepState.client = 2; _renderFormStep('client'); });
    await page.waitForTimeout(100);
    await L.chooseService(page, service);
    const e = await etatBouton(page);
    journal.push({ service, disabled: e.disabled });
    if (e.disabled) toutActif = false;
  }
  L.check('C1 : le bouton reste actif à CHAQUE changement de service',
    toutActif === true, JSON.stringify(journal));

  const erreursResiduelles = await page.evaluate(() => {
    // Aucune erreur ne doit subsister sur un champ devenu invisible.
    return Array.from(document.querySelectorAll('#modal-client .field-error-msg.visible'))
      .filter(e => {
        const g = e.closest('.modal-form-group, .veh-sous-contenu');
        return g && g.offsetParent === null;
      }).length;
  });
  L.check('C2 : aucune erreur ne subsiste sur un champ caché',
    erreursResiduelles === 0, String(erreursResiduelles));

  // ── D. L'ÉTAPE 1 NE DÉPEND JAMAIS DE L'ÉTAPE 2 ──
  await page.evaluate(() => { _formStepState.client = 1; _renderFormStep('client'); });
  await page.waitForTimeout(120);
  const etape1Final = await etatBouton(page);
  L.check('D1 : à l\'étape 1, le bouton est actif quoi qu\'il arrive à l\'étape 2',
    etape1Final.disabled === false, JSON.stringify(etape1Final));

  const validationEtape1 = await page.evaluate(() => {
    // On vide un champ obligatoire de l'étape 1 et on tente d'avancer.
    document.getElementById('client-prenom').value = '';
    clientStepNext();
    return {
      etape: _formStepState.client,
      erreurPrenom: (document.getElementById('client-prenom-err') || {}).textContent || ''
    };
  });
  L.check('D2 : l\'étape 1 valide SES propres champs, pas ceux de l\'étape 2',
    validationEtape1.etape === 1 && /obligatoire/i.test(validationEtape1.erreurPrenom),
    JSON.stringify(validationEtape1));

  L.check('D3 : aucune erreur JS', page.jsErrors.length === 0, page.jsErrors.join(' | '));

  const nbEchecs = L.results();
  await browser.close();
  process.exit(nbEchecs ? 1 : 0);
})();
