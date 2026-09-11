// VITRINE — RENFORT PROFESSIONNEL PONCTUEL
// Vérifie le nouveau récit visuel, son accès aux métiers et le départ
// direct vers le parcours client correspondant.
const { lancerNavigateur, fichier, urlFichier } = require('./env.js');
const fs = require('fs');

let pass = 0, fail = 0;
function check(libelle, condition, detail) {
  if (condition) { console.log('PASS - ' + libelle); pass++; }
  else { console.log('FAIL - ' + libelle + (detail ? '  [' + detail + ']' : '')); fail++; }
}

(async () => {
  const source = fs.readFileSync(fichier('index.html'), 'utf8');
  check('R1 : l’ancienne frise numérotée a disparu', !/class="renfort-flow"/.test(source));
  check('R2 : la scène de mise en relation et la confirmation existent',
    /class="renfort-match"/.test(source) && /Professionnel sélectionné/.test(source));
  check('R3 : le mouvement réduit est respecté',
    /prefers-reduced-motion[\s\S]{0,500}renfort-confirm[\s\S]{0,120}animation:\s*none/.test(source));

  const browser = await lancerNavigateur();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.goto(urlFichier('index.html'), { waitUntil: 'load' });

  const avant = await page.evaluate(() => {
    const sec = document.getElementById('renfort-ponctuel');
    return {
      titre: sec.querySelector('.renfort-title').innerText,
      cartes: sec.querySelectorAll('.renfort-cards .renfort-card').length,
      metiers: sec.querySelectorAll('.renfort-metiers-list span').length,
      ancien: !!sec.querySelector('.renfort-flow'),
      scene: !!sec.querySelector('.renfort-match'),
      hauteur: sec.getBoundingClientRect().height,
      profils: Array.from(sec.querySelectorAll('.renfort-profile strong')).map(el => el.textContent.trim()),
      confirmation: sec.querySelector('.renfort-confirm').innerText,
      metiersLibelles: Array.from(sec.querySelectorAll('.renfort-metiers-list span')).map(el => el.textContent.trim())
    };
  });
  check('R4 : le nouveau titre orienté bénéfice est affiché', /Le bon professionnel/.test(avant.titre), avant.titre);
  check('R5 : exactement quatre métiers sont visibles en premier', avant.cartes === 4, String(avant.cartes));
  check('R6 : la liste complète reste accessible', avant.metiers === 8, String(avant.metiers));
  check('R7 : les trois critères de sélection sont utiles et non répétitifs',
    avant.profils.join('|') === 'Disponible demain|Compétence vérifiée|Sur votre site', avant.profils.join(' | '));
  check('R8 : le bloc est compact et la confirmation donne une disponibilité concrète',
    avant.hauteur < 600 && /Disponible demain à 8 h 30/.test(avant.confirmation),
    JSON.stringify({ hauteur: avant.hauteur, confirmation: avant.confirmation }));
  check('R9 : les huit intitulés métiers utilisent les bons noms professionnels',
    avant.metiersLibelles.join('|') === 'Jockey automobile|Préparateur automobile|Soutien administratif|Carrossier|Accueil en concession|Opérateur de parc|Mécanicien|Diagnostiqueur automobile',
    avant.metiersLibelles.join(' | '));

  await page.locator('.renfort-metiers summary').click();
  const liste = await page.locator('.renfort-metiers').evaluate(el => {
    const sec = el.closest('.renfort-block');
    const panneau = el.querySelector('.renfort-metiers-list');
    return { ouvert: el.open, debordement: getComputedStyle(sec).overflowY, zIndex: getComputedStyle(panneau).zIndex };
  });
  check('R10 : « Voir tous les métiers » déplie une liste qui peut dépasser la section sans être coupée',
    liste.ouvert && liste.debordement === 'visible' && Number(liste.zIndex) >= 20, JSON.stringify(liste));

  await page.locator('.renfort-cta').click();
  const parcours = await page.evaluate(() => ({
    ouvert: document.getElementById('modal-client').classList.contains('open'),
    choisi: document.querySelector('input[name="type-service"][value="professionnel"]').checked
  }));
  check('R11 : le bouton ouvre le parcours « Trouver un professionnel » déjà sélectionné',
    parcours.ouvert && parcours.choisi, JSON.stringify(parcours));

  await page.evaluate(() => { document.getElementById('modal-client').classList.remove('open'); document.body.style.overflow = ''; });
  const miseEnPage = await page.evaluate(() => {
    const stockage = document.querySelector('.stockage-inner').getBoundingClientRect();
    const etapes = document.querySelector('.stockage-steps').getBoundingClientRect();
    const ligne = getComputedStyle(document.querySelector('.track-line'), '::after');
    const animations = Array.from(document.querySelectorAll('.node-circle')).map(el => ({
      nom: getComputedStyle(el).animationName,
      duree: getComputedStyle(el).animationDuration,
      rythme: getComputedStyle(el).animationTimingFunction
    }));
    const stockageTag = document.querySelector('#stockage-automobile .section-tag').getBoundingClientRect();
    const fideliteTag = document.querySelector('#fidelite > .section-tag').getBoundingClientRect();
    const ordre = Array.from(document.querySelectorAll('section[id]')).map(el => el.id);
    const idsAttendus = ['services', 'fidelite', 'stockage-automobile', 'devis', 'convoyeurs'];
    const positions = idsAttendus.map(id => ordre.indexOf(id));
    const heroFill = getComputedStyle(document.querySelector('.hero2-panel-progress-fill'));
    const heroMarker = getComputedStyle(document.querySelector('.hero2-panel-progress-marker'));
    return {
      largeurStockage: stockage.width,
      largeurEtapes: etapes.width,
      viewport: innerWidth,
      animationLigne: ligne.animationName,
      dureeLigne: ligne.animationDuration,
      rythmeLigne: ligne.animationTimingFunction,
      animations,
      fausseProgression: !!document.querySelector('.track-progress'),
      alignementGauche: Math.abs(stockageTag.left - fideliteTag.left),
      positions,
      flechesHero: document.querySelectorAll('.hero2-switcher-arrow').length,
      precedenteHero: !!document.querySelector('[aria-label="Service précédent"]'),
      heroFill: { nom: heroFill.animationName, duree: heroFill.animationDuration },
      heroMarker: { nom: heroMarker.animationName, duree: heroMarker.animationDuration },
      routeAnimee: getComputedStyle(document.querySelector('.hero2-route-line'), '::after').animationName
    };
  });
  check('R12 : le bloc Stockage est large et aligné à gauche sur le Programme de fidélité',
    miseEnPage.largeurStockage >= miseEnPage.viewport * .87
    && miseEnPage.largeurEtapes >= miseEnPage.largeurStockage * .98
    && miseEnPage.alignementGauche <= 1, JSON.stringify(miseEnPage));
  check('R13 : la frise Fidélité synchronise la ligne et les cinq paliers sur dix secondes',
    miseEnPage.animationLigne === 'loyaltyRun'
    && miseEnPage.dureeLigne === '10s'
    && miseEnPage.rythmeLigne === 'linear'
    && miseEnPage.animations.length === 5
    && miseEnPage.animations.map(a => a.nom).join('|') === 'loyaltyMilestone1|loyaltyMilestone2|loyaltyMilestone3|loyaltyMilestone4|loyaltyMilestone5'
    && miseEnPage.animations.every(a => a.duree === '10s' && a.rythme === 'linear')
    && miseEnPage.fausseProgression === false, JSON.stringify(miseEnPage));
  check('R14 : l’ordre éditorial demandé suit immédiatement les Services',
    miseEnPage.positions.every((position, i) => position >= 0 && (!i || position === miseEnPage.positions[i - 1] + 1)),
    JSON.stringify(miseEnPage.positions));
  check('R15 : Mission type défile uniquement vers la droite avec ligne et marqueur synchronisés',
    miseEnPage.flechesHero === 1 && !miseEnPage.precedenteHero
    && miseEnPage.heroFill.nom === 'hero2-draw'
    && miseEnPage.heroMarker.nom === 'hero2-marker'
    && miseEnPage.heroFill.duree === miseEnPage.heroMarker.duree
    && miseEnPage.routeAnimee === 'hero2-route-flow', JSON.stringify(miseEnPage));

  await page.evaluate(() => {
    document.getAnimations().forEach(animation => {
      if (/^renfort(?:Critere|Check|Confirmation)/.test(animation.animationName || '')) {
        animation.currentTime = 5200;
        animation.pause();
      }
    });
  });
  await page.waitForTimeout(50);
  const renfortFinal = await page.evaluate(() => ({
    checks: Array.from(document.querySelectorAll('.renfort-avatar')).map(el => getComputedStyle(el).backgroundColor),
    confirmation: Number(getComputedStyle(document.querySelector('.renfort-confirm')).opacity)
  }));
  check('R16 : les trois critères sont rouges avant l’apparition de la confirmation blanche',
    renfortFinal.checks.length === 3
    && renfortFinal.checks.every(c => /181, 68, 75|229, 72, 77/.test(c))
    && renfortFinal.confirmation > .9, JSON.stringify(renfortFinal));

  await page.setViewportSize({ width: 390, height: 844 });
  const largeur = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  check('R17 : aucun débordement horizontal à 390 px', largeur.scroll <= largeur.client, JSON.stringify(largeur));
  check('R18 : aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));

  await browser.close();
  console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
