// Contact sur place : Moi-même / Une autre personne / nettoyage au changement
const L = require('./lib.js');

(async () => {
  const browser = await L.launch();
  let page = await L.newPage(browser);

  // --- Contexte : nettoyage jusqu'à l'étape 4 ---
  await L.fillStep1(page, 'pro');
  await L.chooseService(page, 'nettoyage');
  await L.fillNettoyageStep2(page, 3, { berline_break: 1, suv_4x4: 2 }, 'preparation_complete');
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(150);
  await page.click('input[name="nett-lieu"][value="locaux_client"]');
  await page.waitForTimeout(50);

  // 1. Aucun choix -> validation bloque
  let r = await page.evaluate(() => {
    let ids = [];
    _hcValiderContactSurPlace('nett', id => ids.push(id));
    return { ids: ids, resolu: _hcContactSurPlace('nett') };
  });
  L.check('Aucun choix -> contact invalide et non résolu',
    r.ids.length === 1 && r.resolu === null, JSON.stringify(r));

  // 2. Moi-même reprend les VRAIES données du compte (étape 1)
  await page.click('input[name="nett-contact-sp"][value="moi"]');
  await page.waitForTimeout(60);
  r = await page.evaluate(() => ({
    resolu: _hcContactSurPlace('nett'),
    apercu: (document.getElementById('nett-contact-sp-moi-valeur') || {}).textContent,
    apercuVisible: (document.getElementById('nett-contact-sp-moi-valeur') || {}).style.display,
    autreVisible: (document.getElementById('nett-contact-sp-autre') || {}).style.display
  }));
  L.check('Moi-même : reprend le nom réel du compte',
    r.resolu && r.resolu.nom === 'TEST-QA Dupont', JSON.stringify(r.resolu));
  L.check('Moi-même : reprend le téléphone réel du compte',
    r.resolu && r.resolu.telephone === '+33600000000', JSON.stringify(r.resolu));
  L.check('Moi-même : type "moi" enregistré', r.resolu && r.resolu.type === 'moi');
  L.check('Moi-même : aperçu affiché sans rien inventer',
    /TEST-QA Dupont/.test(r.apercu) && r.apercuVisible !== 'none', JSON.stringify(r));
  L.check('Moi-même : bloc "autre personne" masqué', r.autreVisible === 'none');

  let v = await page.evaluate(() => {
    let ids = []; const ok = _hcValiderContactSurPlace('nett', id => ids.push(id));
    return { ok: ok, ids: ids };
  });
  L.check('Moi-même avec compte complet -> validation OK', v.ok === true, JSON.stringify(v));

  // 3. Une autre personne exige nom ET téléphone
  await page.click('input[name="nett-contact-sp"][value="autre"]');
  await page.waitForTimeout(60);
  v = await page.evaluate(() => {
    let ids = []; const ok = _hcValiderContactSurPlace('nett', id => ids.push(id));
    return { ok: ok, ids: ids, resolu: _hcContactSurPlace('nett') };
  });
  L.check('Autre personne vide -> validation bloque nom ET téléphone',
    v.ok === false && v.ids.indexOf('nett-contact-sp-nom') !== -1 && v.ids.indexOf('nett-contact-sp-tel') !== -1,
    JSON.stringify(v));
  L.check('Autre personne incomplète -> contact non résolu', v.resolu === null);

  // nom seul : toujours bloqué
  await page.fill('#nett-contact-sp-nom', 'Karim B.');
  v = await page.evaluate(() => {
    let ids = []; const ok = _hcValiderContactSurPlace('nett', id => ids.push(id));
    return { ok: ok, ids: ids };
  });
  L.check('Autre personne : nom sans téléphone -> toujours bloqué',
    v.ok === false && v.ids.indexOf('nett-contact-sp-tel') !== -1, JSON.stringify(v));

  await page.fill('#nett-contact-sp-tel', '+33611111111');
  v = await page.evaluate(() => ({
    ok: _hcValiderContactSurPlace('nett', () => {}),
    resolu: _hcContactSurPlace('nett')
  }));
  L.check('Autre personne complète -> validation OK', v.ok === true);
  L.check('Autre personne : valeurs saisies réellement enregistrées',
    v.resolu && v.resolu.type === 'autre' && v.resolu.nom === 'Karim B.' && v.resolu.telephone === '+33611111111',
    JSON.stringify(v.resolu));

  // 4. Changement de choix -> nettoyage RÉEL des anciennes valeurs
  await page.click('input[name="nett-contact-sp"][value="moi"]');
  await page.waitForTimeout(60);
  r = await page.evaluate(() => ({
    nom: (document.getElementById('nett-contact-sp-nom') || {}).value,
    tel: (document.getElementById('nett-contact-sp-tel') || {}).value,
    resolu: _hcContactSurPlace('nett'),
    payload: _construireDetailsNettoyage().contact_sur_place
  }));
  L.check('Retour sur Moi-même : champs "autre personne" réellement vidés',
    r.nom === '' && r.tel === '', JSON.stringify(r));
  L.check('Retour sur Moi-même : ancienne valeur absente du contact résolu',
    r.resolu && r.resolu.nom === 'TEST-QA Dupont', JSON.stringify(r.resolu));
  L.check('Retour sur Moi-même : ancienne valeur absente du PAYLOAD',
    r.payload && r.payload.nom === 'TEST-QA Dupont' && r.payload.type === 'moi', JSON.stringify(r.payload));

  // 5. Le contact résolu arrive bien dans le récapitulatif
  await L.fillNettoyageStep4(page, { contactType: 'autre', contactNom: 'Sophie M.', contactTel: '+33622222222' });
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(250);
  const recap = await page.evaluate(() => {
    const z = document.getElementById('recap-demande');
    return z ? z.textContent.replace(/\s+/g, ' ') : '';
  });
  L.check('Récapitulatif affiche "Contact sur place"', /Contact sur place/i.test(recap), recap.slice(0, 400));
  L.check('Récapitulatif affiche la valeur résolue', /Sophie M\..*\+33622222222/.test(recap), recap.slice(0, 500));

  L.check('Aucune erreur JS', page.jsErrors.length === 0, page.jsErrors.join(' | '));

  // 6. Compte incomplet -> "Moi-même" refuse et n'invente rien
  await page.close();
  page = await L.newPage(browser);
  await page.evaluate(() => { try { openModal('client'); } catch (e) {} });
  await page.waitForTimeout(60);
  const sansTel = await page.evaluate(() => {
    document.getElementById('client-prenom').value = 'Jean';
    document.getElementById('client-nom').value = 'Sans-Tel';
    document.getElementById('client-tel').value = '';
    return { identite: _hcCompteIdentite(), resolu: _hcContactSurPlace('nett') };
  });
  L.check('Compte sans téléphone : identité lue sans invention',
    sansTel.identite.nom === 'Jean Sans-Tel' && sansTel.identite.telephone === '',
    JSON.stringify(sansTel.identite));
  L.check('Compte sans téléphone : contact non résolu (rien inventé)', sansTel.resolu === null);

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
