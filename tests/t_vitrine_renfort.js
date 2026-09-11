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
    /class="renfort-match"/.test(source) && /Renfort confirmé/.test(source));
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
      scene: !!sec.querySelector('.renfort-match')
    };
  });
  check('R4 : le nouveau titre orienté bénéfice est affiché', /Le bon professionnel/.test(avant.titre), avant.titre);
  check('R5 : exactement quatre métiers sont visibles en premier', avant.cartes === 4, String(avant.cartes));
  check('R6 : la liste complète reste accessible', avant.metiers === 8, String(avant.metiers));

  await page.locator('.renfort-metiers summary').click();
  check('R7 : « Voir tous les métiers » déplie réellement la liste',
    await page.locator('.renfort-metiers').evaluate(el => el.open === true));

  await page.locator('.renfort-cta').click();
  const parcours = await page.evaluate(() => ({
    ouvert: document.getElementById('modal-client').classList.contains('open'),
    choisi: document.querySelector('input[name="type-service"][value="professionnel"]').checked
  }));
  check('R8 : le bouton ouvre le parcours « Trouver un professionnel » déjà sélectionné',
    parcours.ouvert && parcours.choisi, JSON.stringify(parcours));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.getElementById('modal-client').classList.remove('open'); document.body.style.overflow = ''; });
  const largeur = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  check('R9 : aucun débordement horizontal à 390 px', largeur.scroll <= largeur.client, JSON.stringify(largeur));
  check('R10 : aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));

  await browser.close();
  console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
