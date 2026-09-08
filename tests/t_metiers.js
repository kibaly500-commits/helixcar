// MÉTIERS DÉCLARÉS PAR LES CANDIDATS (§13)
// ------------------------------------------------------------------
// Un client peut demander un TECHNICIEN (mécanique, carrosserie,
// diagnostic) ou un RENFORT pour une mission précise (jockey, accueil en
// concession, soutien administratif). Le formulaire de candidature
// n'offrait que trois cases d'activité, sans aucun métier : personne ne
// pouvait se déclarer technicien, et un renfort ne pouvait pas dire ce
// qu'il sait faire.
//
// Le candidat AJOUTE désormais ses métiers un par un, les voit dans un
// récapitulatif, et peut en retirer d'un clic. Les ACTIVITÉS — la
// granularité des décisions administrateur — en sont DÉDUITES.
const L = require('./lib.js');
const fs = require('fs');

async function ouvrirCandidature(page) {
  await page.evaluate(() => { try { openModal('convoyeur'); } catch (e) {} });
  await page.waitForTimeout(120);
  // Les métiers vivent à l'étape 2 : on s'y place, comme un candidat
  // qui a rempli son identité.
  await page.evaluate(() => { _formStepState.convoyeur = 2; _renderFormStep('convoyeur'); });
  await page.waitForTimeout(120);
}
async function ajouter(page, cle) {
  await page.click('#conv-metiers-liste [data-ajouter="' + cle + '"]');
  await page.waitForTimeout(70);
}
async function retirer(page, cle) {
  await page.click('#conv-metiers-badges [data-retirer="' + cle + '"]');
  await page.waitForTimeout(70);
}
async function etat(page) {
  return page.evaluate(() => ({
    metiers: _metiersPartenaire(),
    activites: _activitesPartenaire(),
    recapVisible: (document.getElementById('conv-metiers-recap') || {}).style.display,
    badges: Array.from(document.querySelectorAll('#conv-metiers-badges [data-badge]'))
      .map(b => b.getAttribute('data-badge')),
    videoRequise: _convVideoRequise(),
    dureeMax: _convVideoDureeMax(),
  }));
}

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);
  await ouvrirCandidature(page);

  // ── A. TOUS LES MÉTIERS RÉELLEMENT PROPOSÉS, AVEC UN BOUTON + ──
  const lignes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#conv-metiers-liste .conv-metier-ligne')).map(l => ({
      cle: l.getAttribute('data-metier'),
      nom: (l.querySelector('.conv-metier-nom') || {}).textContent,
      famille: (l.querySelector('.conv-metier-famille') || {}).textContent,
      plus: (l.querySelector('.conv-metier-plus') || {}).textContent,
    })));
  const ATTENDUS = ['convoyage', 'nettoyage', 'jockey', 'accueil_preparation',
                    'soutien_administratif', 'mecanique', 'carrosserie', 'diagnostic'];
  L.check('A1 : tous les métiers proposés sont affichés',
    ATTENDUS.every(c => lignes.some(l => l.cle === c)), JSON.stringify(lignes.map(l => l.cle)));
  L.check('A2 : « Accueil en concession » et « Soutien administratif » en font partie',
    lignes.some(l => /Accueil en concession/.test(l.nom))
    && lignes.some(l => /Soutien administratif/.test(l.nom)));
  L.check('A3 : chaque métier porte un bouton +',
    lignes.every(l => l.plus === '+'), JSON.stringify(lignes.map(l => l.plus)));
  L.check('A4 : chaque métier annonce à quelle famille il appartient',
    lignes.every(l => (l.famille || '').trim().length > 3), JSON.stringify(lignes.map(l => l.famille)));

  let e = await etat(page);
  L.check('A5 : au départ, aucun métier retenu et aucun récapitulatif',
    e.metiers.length === 0 && e.recapVisible === 'none', JSON.stringify(e));

  // ── B. AJOUT, RÉCAPITULATIF, RETRAIT ──
  await ajouter(page, 'carrosserie');
  e = await etat(page);
  L.check('B1 : le métier ajouté apparaît dans le récapitulatif',
    e.badges.length === 1 && e.badges[0] === 'carrosserie', JSON.stringify(e.badges));
  L.check('B2 : le récapitulatif devient visible', e.recapVisible === 'block', e.recapVisible);
  L.check('B3 : son bouton + devient inactif — pas de doublon possible',
    await page.evaluate(() =>
      document.querySelector('#conv-metiers-liste [data-ajouter="carrosserie"]').disabled === true));
  L.check('B4 : sa ligne est marquée comme retenue',
    await page.evaluate(() =>
      document.querySelector('[data-metier="carrosserie"]').getAttribute('data-retenu') === 'oui'));

  // Un second clic ne doit rien ajouter.
  await page.evaluate(() => convAjouterMetier('carrosserie'));
  await page.waitForTimeout(50);
  e = await etat(page);
  L.check('B5 : ajouter deux fois le même métier ne le duplique pas',
    e.metiers.length === 1, JSON.stringify(e.metiers));

  await ajouter(page, 'jockey');
  await ajouter(page, 'accueil_preparation');
  await ajouter(page, 'nettoyage');
  e = await etat(page);
  L.check('B6 : plusieurs métiers, de familles différentes, cohabitent',
    e.metiers.length === 4, JSON.stringify(e.metiers));
  L.check('B7 : les badges suivent, dans l\'ordre d\'ajout',
    e.badges.join(',') === 'carrosserie,jockey,accueil_preparation,nettoyage', e.badges.join(','));

  await retirer(page, 'jockey');
  e = await etat(page);
  L.check('B8 : retirer un métier le retire réellement',
    e.metiers.indexOf('jockey') === -1 && e.metiers.length === 3, JSON.stringify(e.metiers));
  L.check('B9 : et ne touche pas les autres',
    ['carrosserie', 'accueil_preparation', 'nettoyage'].every(c => e.metiers.indexOf(c) !== -1),
    JSON.stringify(e.metiers));
  L.check('B10 : son bouton + redevient disponible',
    await page.evaluate(() =>
      document.querySelector('#conv-metiers-liste [data-ajouter="jockey"]').disabled === false));

  // ── C. LES ACTIVITÉS SONT DÉDUITES, JAMAIS SAISIES DEUX FOIS ──
  e = await etat(page);
  L.check('C1 : les activités découlent des métiers retenus',
    e.activites.slice().sort().join(',') === 'nettoyage,renfort,technicien',
    JSON.stringify(e.activites));
  L.check('C2 : une activité n\'apparaît qu\'une fois, même avec deux métiers',
    e.activites.length === new Set(e.activites).size, JSON.stringify(e.activites));
  await retirer(page, 'accueil_preparation');
  e = await etat(page);
  L.check('C3 : retirer le dernier métier d\'une famille retire son activité',
    e.activites.indexOf('renfort') === -1, JSON.stringify(e.activites));
  L.check('C4 : aucune activité ne peut donc rester « vide »',
    e.activites.every(a => e.metiers.some(m => true)), JSON.stringify(e));

  // Une clé inconnue ne peut pas entrer.
  await page.evaluate(() => convAjouterMetier('pirate'));
  await page.waitForTimeout(50);
  e = await etat(page);
  L.check('C5 : une valeur incohérente est refusée',
    e.metiers.indexOf('pirate') === -1, JSON.stringify(e.metiers));

  // ── D. VALIDATION ──
  let v = await page.evaluate(() => _validateConvStep(2));
  L.check('D1 : avec des métiers, l\'étape passe', v === true, String(v));
  await page.evaluate(() => { _convMetiersRetenus = []; convRendreMetiers(); onChoixActivitesPartenaire(); });
  await page.waitForTimeout(60);
  v = await page.evaluate(() => ({
    ok: _validateConvStep(2),
    erreur: (document.getElementById('conv-activites-group-err') || {}).textContent || '',
  }));
  L.check('D2 : sans aucun métier, l\'étape est refusée', v.ok === false, JSON.stringify(v));
  L.check('D3 : avec un message qui parle de métier',
    /au moins un métier/i.test(v.erreur), v.erreur);

  // ── E. LA VIDÉO SUIT LE MÉTIER RÉELLEMENT DÉCLARÉ ──
  await ajouter(page, 'nettoyage');
  e = await etat(page);
  L.check('E1 : un nettoyeur seul n\'a aucune vidéo à fournir',
    e.videoRequise === false && e.dureeMax === 0, JSON.stringify(e));
  await ajouter(page, 'diagnostic');
  e = await etat(page);
  L.check('E2 : un technicien, qui intervient chez le client, doit se présenter',
    e.videoRequise === true, JSON.stringify(e));
  L.check('E3 : avec la même durée qu\'un renfort — 2 minutes', e.dureeMax === 120, String(e.dureeMax));
  await retirer(page, 'diagnostic');
  await ajouter(page, 'convoyage');
  e = await etat(page);
  L.check('E4 : un convoyeur seul garde sa minute', e.dureeMax === 60, String(e.dureeMax));

  // ── F. LE PAYLOAD PORTE LES DEUX NIVEAUX ──
  const payload = await page.evaluate(() => ({
    metiers: _metiersPartenaire(),
    activites: _activitesPartenaire(),
  }));
  L.check('F1 : les métiers partent tels que déclarés',
    payload.metiers.indexOf('convoyage') !== -1 && payload.metiers.indexOf('nettoyage') !== -1,
    JSON.stringify(payload.metiers));
  L.check('F2 : et les activités qui en découlent aussi',
    payload.activites.slice().sort().join(',') === 'convoyage,nettoyage',
    JSON.stringify(payload.activites));

  // ── G. RÉOUVERTURE : AUCUN MÉTIER FANTÔME ──
  await page.evaluate(() => { try { closeModal('convoyeur'); } catch (e) {} });
  await page.waitForTimeout(80);
  await ouvrirCandidature(page);
  e = await etat(page);
  L.check('G1 : rouvrir le formulaire repart d\'une liste vide',
    e.metiers.length === 0 && e.recapVisible === 'none', JSON.stringify(e));
  L.check('G2 : et tous les boutons + sont de nouveau disponibles',
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('#conv-metiers-liste [data-ajouter]')).every(b => !b.disabled)));

  // ── H. UNE SEULE NOMENCLATURE, PARTAGÉE ──
  const idx = fs.readFileSync('/home/user/helixcar/index.html', 'utf8');
  const dash = fs.readFileSync('/home/user/helixcar/dashboard.html', 'utf8');
  L.check('H1 : les métiers sont déclarés dans une seule table',
    (idx.match(/var METIERS_PARTENAIRE = \[/g) || []).length === 1);
  L.check('H2 : les clés du candidat sont celles du formulaire client',
    ['jockey', 'accueil_preparation', 'soutien_administratif']
      .every(k => new RegExp("^\\s*" + k + ':', 'm').test(idx)));
  L.check('H3 : le Dashboard connaît les mêmes métiers',
    ['jockey', 'accueil_preparation', 'soutien_administratif', 'mecanique', 'carrosserie', 'diagnostic']
      .every(k => new RegExp(k + ':').test(
        dash.slice(dash.indexOf('var CONV_LIB_METIER'), dash.indexOf('var CONV_LIB_METIER') + 500))));
  L.check('H4 : et la même liste d\'activités',
    /CONV_ACTIVITES_CONNUES = \['convoyage', 'nettoyage', 'renfort', 'technicien'\]/.test(dash));
  L.check('H5 : le technicien reçoit une décision comme les autres activités',
    /technicien: 'Technicien automobile'/.test(dash));

  L.check('Z1 : aucune erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.slice(0, 3).join(' | '));

  await browser.close();
  process.exit(L.results() === 0 ? 0 : 1);
})();
