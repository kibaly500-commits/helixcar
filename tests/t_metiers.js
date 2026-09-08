// SÉLECTION MULTI-MÉTIERS DES CANDIDATS (§13)
// ------------------------------------------------------------------
// Un client peut demander un TECHNICIEN (mécanique, carrosserie,
// diagnostic) ou un RENFORT pour une mission précise (jockey, accueil en
// concession, soutien administratif). Le formulaire de candidature
// n'offrait que trois cases, sans aucun métier : personne ne pouvait se
// déclarer technicien, et un renfort ne pouvait pas dire ce qu'il sait
// faire. Ce fichier vérifie la correction sur le VRAI formulaire.
const L = require('./lib.js');
const fs = require('fs');

async function ouvrirCandidature(page) {
  await page.evaluate(() => { try { openModal('convoyeur'); } catch (e) {} });
  await page.waitForTimeout(80);
}
async function cocher(page, id, valeur) {
  await page.evaluate(([i, v]) => {
    const e = document.getElementById(i);
    if (!e) return;
    e.checked = v;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, valeur]);
  await page.waitForTimeout(60);
}
async function cocherMetier(page, activite, valeur, coche) {
  await page.evaluate(([a, v, c]) => {
    const e = document.querySelector('input[name="conv-metiers"][data-activite="' + a + '"][value="' + v + '"]');
    if (!e) return;
    e.checked = c;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, [activite, valeur, coche]);
  await page.waitForTimeout(50);
}
async function etat(page) {
  return page.evaluate(() => ({
    activites: _activitesPartenaire(),
    metiers: _metiersPartenaire(),
    sansMetier: _activitesSansMetier(),
    blocRenfort: (document.getElementById('conv-metiers-renfort') || {}).style.display,
    blocTech: (document.getElementById('conv-metiers-technicien') || {}).style.display,
    videoRequise: _convVideoRequise(),
    dureeMax: _convVideoDureeMax(),
  }));
}

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);
  await ouvrirCandidature(page);

  // ── A. LES QUATRE MÉTIERS SONT PROPOSÉS ──
  const cases = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#modal-convoyeur input[name="conv-activites"]')).map(e => e.value));
  L.check('A1 : les quatre activités sont proposées au candidat',
    ['convoyage', 'nettoyage', 'renfort', 'technicien'].every(v => cases.indexOf(v) !== -1),
    JSON.stringify(cases));
  L.check('A2 : le technicien, que les clients pouvaient déjà demander, existe enfin',
    cases.indexOf('technicien') !== -1, JSON.stringify(cases));
  L.check('A3 : ce sont bien des cases à cocher, donc cumulables',
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('#modal-convoyeur input[name="conv-activites"]'))
        .every(e => e.type === 'checkbox')));

  // ── B. LES MÉTIERS N'APPARAISSENT QUE QUAND ILS ONT UN SENS ──
  let e = await etat(page);
  L.check('B1 : au départ, aucun bloc de métiers n\'est affiché',
    e.blocRenfort === 'none' && e.blocTech === 'none', JSON.stringify(e));

  await cocher(page, 'conv-act-nettoyage', true);
  e = await etat(page);
  L.check('B2 : le nettoyage n\'ouvre aucun sous-métier — l\'activité EST le métier',
    e.blocRenfort === 'none' && e.blocTech === 'none' && e.sansMetier.length === 0, JSON.stringify(e));

  await cocher(page, 'conv-act-renfort', true);
  e = await etat(page);
  L.check('B3 : cocher le renfort ouvre ses missions', e.blocRenfort === 'block', e.blocRenfort);
  L.check('B4 : et le technicien reste fermé', e.blocTech === 'none', e.blocTech);
  L.check('B5 : tant qu\'aucune mission n\'est choisie, il manque quelque chose',
    e.sansMetier.length === 1 && e.sansMetier[0] === 'renfort', JSON.stringify(e.sansMetier));

  const missions = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[name="conv-metiers"][data-activite="renfort"]')).map(x => x.value));
  L.check('B6 : les missions proposées sont celles du formulaire client',
    ['jockey', 'accueil_preparation', 'soutien_administratif'].every(v => missions.indexOf(v) !== -1),
    JSON.stringify(missions));

  await cocher(page, 'conv-act-technicien', true);
  e = await etat(page);
  L.check('B7 : cocher le technicien ouvre ses spécialités', e.blocTech === 'block', e.blocTech);
  const specs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[name="conv-metiers"][data-activite="technicien"]')).map(x => x.value));
  L.check('B8 : les spécialités proposées sont celles du formulaire client',
    ['mecanique', 'carrosserie', 'diagnostic'].every(v => specs.indexOf(v) !== -1), JSON.stringify(specs));

  // ── C. PLUSIEURS MÉTIERS, DANS PLUSIEURS ACTIVITÉS ──
  await cocherMetier(page, 'renfort', 'jockey', true);
  await cocherMetier(page, 'renfort', 'accueil_preparation', true);
  await cocherMetier(page, 'technicien', 'carrosserie', true);
  await cocherMetier(page, 'technicien', 'mecanique', true);
  e = await etat(page);
  L.check('C1 : plusieurs métiers sont retenus, dans plusieurs activités',
    e.metiers.length === 4, JSON.stringify(e.metiers));
  L.check('C2 : et plus rien ne manque', e.sansMetier.length === 0, JSON.stringify(e.sansMetier));
  L.check('C3 : les activités restent cumulées', e.activites.length === 3, JSON.stringify(e.activites));

  // ── D. AUCUN MÉTIER FANTÔME ──
  await cocher(page, 'conv-act-technicien', false);
  e = await etat(page);
  L.check('D1 : décocher une activité referme son bloc', e.blocTech === 'none', e.blocTech);
  L.check('D2 : et ses métiers ne sont PAS conservés en arrière-plan',
    e.metiers.indexOf('carrosserie') === -1 && e.metiers.indexOf('mecanique') === -1,
    JSON.stringify(e.metiers));
  L.check('D3 : les cases elles-mêmes sont réellement décochées',
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[name="conv-metiers"][data-activite="technicien"]'))
        .every(x => !x.checked)));
  L.check('D4 : les métiers de l\'autre activité sont intacts',
    e.metiers.length === 2 && e.metiers.indexOf('jockey') !== -1, JSON.stringify(e.metiers));

  // ── E. LA VALIDATION D'ÉTAPE REFUSE UNE ACTIVITÉ SANS MÉTIER ──
  await cocherMetier(page, 'renfort', 'jockey', false);
  await cocherMetier(page, 'renfort', 'accueil_preparation', false);
  let v = await page.evaluate(() => ({
    ok: _validateConvStep(2),
    erreur: (document.getElementById('conv-activites-group-err') || {}).textContent || '',
  }));
  L.check('E1 : un renfort sans aucune mission est refusé', v.ok === false, JSON.stringify(v));
  L.check('E2 : et le message nomme ce qui manque',
    /mission de renfort/i.test(v.erreur), v.erreur);

  await cocherMetier(page, 'renfort', 'soutien_administratif', true);
  v = await page.evaluate(() => _validateConvStep(2));
  L.check('E3 : avec une mission, l\'étape passe', v === true, String(v));

  await page.evaluate(() => {
    ['convoyage', 'nettoyage', 'renfort', 'technicien'].forEach(a => {
      const el = document.getElementById('conv-act-' + a);
      if (el) { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });
  await page.waitForTimeout(80);
  v = await page.evaluate(() => ({
    ok: _validateConvStep(2),
    erreur: (document.getElementById('conv-activites-group-err') || {}).textContent || '',
  }));
  L.check('E4 : aucune activité du tout reste refusé', v.ok === false, JSON.stringify(v));
  L.check('E5 : avec un message parlant de métier, pas de jargon',
    /au moins un métier/i.test(v.erreur), v.erreur);

  // ── F. LA VIDÉO SUIT LE MÉTIER RÉELLEMENT DÉCLARÉ ──
  await cocher(page, 'conv-act-nettoyage', true);
  e = await etat(page);
  L.check('F1 : un nettoyeur seul n\'a aucune vidéo à fournir',
    e.videoRequise === false && e.dureeMax === 0, JSON.stringify(e));
  await cocher(page, 'conv-act-technicien', true);
  await cocherMetier(page, 'technicien', 'diagnostic', true);
  e = await etat(page);
  L.check('F2 : un technicien, qui intervient chez le client, doit se présenter',
    e.videoRequise === true, JSON.stringify(e));
  L.check('F3 : avec la même durée qu\'un renfort — 2 minutes',
    e.dureeMax === 120, String(e.dureeMax));
  await cocher(page, 'conv-act-technicien', false);
  await cocher(page, 'conv-act-convoyage', true);
  e = await etat(page);
  L.check('F4 : un convoyeur seul garde sa minute', e.dureeMax === 60, String(e.dureeMax));

  // ── G. UNE SEULE NOMENCLATURE, PARTAGÉE ──
  const idx = fs.readFileSync('/home/user/helixcar/index.html', 'utf8');
  const dash = fs.readFileSync('/home/user/helixcar/dashboard.html', 'utf8');
  L.check('G1 : les métiers sont déclarés dans une seule table côté formulaire',
    (idx.match(/var CONV_METIERS_PAR_ACTIVITE = \{/g) || []).length === 1);
  L.check('G2 : les clés du candidat sont celles du client (missions)',
    ['jockey', 'accueil_preparation', 'soutien_administratif']
      .every(k => new RegExp('data-activite="renfort" value="' + k + '"').test(idx))
    && ['jockey', 'accueil_preparation', 'soutien_administratif']
      .every(k => new RegExp('^\\s*' + k + ':', 'm').test(idx)));
  L.check('G3 : et celles du client pour les spécialités',
    ['mecanique', 'carrosserie', 'diagnostic']
      .every(k => new RegExp('data-activite="technicien" value="' + k + '"').test(idx)));
  L.check('G4 : le Dashboard connaît les mêmes métiers',
    ['jockey', 'accueil_preparation', 'soutien_administratif', 'mecanique', 'carrosserie', 'diagnostic']
      .every(k => new RegExp(k + ':').test(dash.slice(dash.indexOf('var CONV_LIB_METIER'), dash.indexOf('var CONV_LIB_METIER') + 500))));
  L.check('G5 : et la même liste d\'activités',
    /CONV_ACTIVITES_CONNUES = \['convoyage', 'nettoyage', 'renfort', 'technicien'\]/.test(dash));
  L.check('G6 : le technicien reçoit une décision comme les autres activités',
    /technicien: 'Technicien automobile'/.test(dash));

  L.check('Z1 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.slice(0, 3).join(' | '));

  await browser.close();
  process.exit(L.results() === 0 ? 0 : 1);
})();
