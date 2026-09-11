// VITRINE — BARRE PREMIUM, MENU ET SERVICES EDITORIAUX
// Vérifie les demandes visuelles sans toucher aux formulaires ni à leur logique.
const { lancerNavigateur, fichier, urlFichier } = require('./env.js');
const fs = require('fs');

let pass = 0, fail = 0;
function check(libelle, condition, detail) {
  if (condition) { console.log('PASS - ' + libelle); pass++; }
  else { console.log('FAIL - ' + libelle + (detail ? '  [' + detail + ']' : '')); fail++; }
}

(async () => {
  const source = fs.readFileSync(fichier('index.html'), 'utf8');
  check('N1 : l’inspiration n’introduit aucune marque ou ressource Gucci dans le site', !/gucci/i.test(source));
  check('N2 : les deux actions conservées et et le panneau latéral sont versionnés',
    /nav-quote-action/.test(source) && !/nav-partner-action/.test(source)
      && /nav-account-action/.test(source) && /nav-menu-lines/.test(source)
      && /site-menu-panel/.test(source) && !/site-menu-quick/.test(source));
  check('N3 : le nouveau texte commercial exact remplace le doublon',
    source.includes('Prix transparent, du devis à la livraison.')
      && !source.includes('Prix transparent, sans surprise'));

  const browser = await lancerNavigateur();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.goto(urlFichier('index.html'), { waitUntil: 'load' });

  const bureau = await page.evaluate(() => {
    const nav = document.querySelector('nav').getBoundingClientRect();
    const logo = document.querySelector('nav .logo').getBoundingClientRect();
    const contact = document.querySelector('.nav-contact').getBoundingClientRect();
    const navActions = document.querySelector('.nav-actions').getBoundingClientRect();
    const services = document.getElementById('services');
    const bande = services.previousElementSibling;
    const cartes = Array.from(document.querySelectorAll('.services-grid .service-card'));
    return {
      centreLogo: logo.left + logo.width / 2,
      centreNav: nav.left + nav.width / 2,
      actions: document.querySelectorAll('.nav-icon-action').length,
      traits: document.querySelectorAll('.nav-menu-lines span').length,
      ancienMenu: document.querySelectorAll('nav .nav-links').length,
      recontact: document.querySelector('.nav-contact-link').getAttribute('href'),
      margeContact: Math.round(contact.left - nav.left),
      margeActions: Math.round(nav.right - navActions.right),
      espaceServices: services.getBoundingClientRect().top - bande.getBoundingClientRect().bottom,
      cartes: cartes.length,
      largeurs: cartes.map(el => Math.round(el.getBoundingClientRect().width)),
      hauteurs: cartes.map(el => Math.round(el.getBoundingClientRect().height)),
      grille: getComputedStyle(document.querySelector('.services-grid')).gridTemplateColumns
    };
  });
  check('N4 : le vrai logo HelixCar est centré indépendamment des actions',
    Math.abs(bureau.centreLogo - bureau.centreNav) <= 1, JSON.stringify(bureau));
  check('N5 : la barre recentrée montre deux icônes, trois traits et aucun ancien menu horizontal',
    bureau.actions === 2 && bureau.traits === 3 && bureau.ancienMenu === 0 && bureau.recontact === '#recontact'
      && bureau.margeContact >= 70 && bureau.margeActions >= 70, JSON.stringify(bureau));
  check('N6 : Nos services remonte sous la barre défilante',
    bureau.espaceServices >= 0 && bureau.espaceServices <= 55, String(bureau.espaceServices));
  check('N7 : les huit services sont conservés dans une composition de tailles hiérarchisées',
    bureau.cartes === 8 && new Set(bureau.largeurs).size >= 3 && new Set(bureau.hauteurs).size >= 2,
    JSON.stringify({ largeurs: bureau.largeurs, hauteurs: bureau.hauteurs, grille: bureau.grille }));

  await page.locator('#nav-menu-btn').click();
  const menu = await page.evaluate(() => ({
    ouvert: document.getElementById('site-menu-panel').classList.contains('open'),
    cache: document.getElementById('site-menu-panel').getAttribute('aria-hidden'),
    etendu: document.getElementById('nav-menu-btn').getAttribute('aria-expanded'),
    liens: Array.from(document.querySelectorAll('.site-menu-links a')).map(a => a.textContent.trim()),
    fond: getComputedStyle(document.getElementById('site-menu-panel')).backgroundColor
  }));
  check('N8 : le menu latéral s’ouvre et contient exactement les huit accès demandés',
    menu.ouvert && menu.cache === 'false' && menu.etendu === 'true'
      && menu.liens.join('|') === 'Services|Fidélité|Stockage|Tarifs|Renfort professionnel|Partenaires|FAQ|Contact',
    JSON.stringify(menu));
  check('N8b : aucun bouton devis ou connexion ne subsiste en bas du menu',
    (await page.locator('.site-menu-quick').count()) === 0);
  await page.locator('.site-menu-close').click();
  check('N9 : la grande croix referme proprement le panneau',
    !(await page.locator('#site-menu-panel').evaluate(el => el.classList.contains('open'))));

  for (const [selecteur, modal] of [
    ['.nav-quote-action', 'modal-client'],
    ['.nav-account-action', 'modal-connexion']
  ]) {
    await page.locator(selecteur).click();
    const ouvert = await page.locator('#' + modal).evaluate(el => el.classList.contains('open'));
    check(`N10 : ${selecteur} ouvre ${modal}`, ouvert, modal);
    await page.evaluate(id => {
      document.getElementById(id).classList.remove('open');
      document.body.classList.remove('hc-modal-open');
      document.body.style.overflow = '';
    }, modal);
  }

  const premium = await page.evaluate(() => {
    const carte = getComputedStyle(document.querySelector('.pricing-card'));
    const reflet = getComputedStyle(document.querySelector('.pricing-card'), '::after');
    const note = getComputedStyle(document.querySelector('.pricing-note-inner'));
    const confirmation = getComputedStyle(document.querySelector('.renfort-confirm'));
    const recherche = getComputedStyle(document.querySelector('.renfort-scan-line'), '::after');
    const vedette = document.querySelector('.pricing-card--featured');
    const badge = document.querySelector('.pricing-badge');
    const vedetteBox = vedette.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    return {
      tarifFond: getComputedStyle(document.querySelector('.quote-section')).backgroundColor,
      carteDegrade: carte.backgroundImage,
      carteBordure: carte.borderTopColor,
      reflet: reflet.animationName,
      refletDuree: reflet.animationDuration,
      noteDegrade: note.backgroundImage,
      noteBordure: note.borderTopColor,
      confirmationFond: confirmation.backgroundImage,
      confirmationBordure: confirmation.borderTopColor,
      confirmationLigne: getComputedStyle(document.querySelector('.renfort-confirm > span:last-child')).whiteSpace,
      rechercheDuree: recherche.animationDuration
      ,rayonCarte: parseFloat(carte.borderTopLeftRadius)
      ,badgeVisible: badgeBox.top >= vedetteBox.top && badgeBox.bottom <= vedetteBox.bottom && badgeBox.width > 0
    };
  });
  check('N11 : les tarifs gardent le fond noir avec graphite, bordure rouge et reflet lent',
    /rgb\((?:10|11|13|16), (?:14|15|18|24), (?:19|20|24|32)\)/.test(premium.tarifFond)
      && /linear-gradient/.test(premium.carteDegrade) && /linear-gradient/.test(premium.noteDegrade)
      && /229, 72, 77/.test(premium.carteBordure) && /229, 72, 77/.test(premium.noteBordure)
      && premium.reflet === 'pricingSheen' && premium.refletDuree === '10s'
      && premium.rayonCarte >= 12 && premium.badgeVisible, JSON.stringify(premium));
  check('N12 : la recherche est ralentie et la confirmation est sombre, rouge et sur une ligne',
    premium.rechercheDuree === '6.8s' && /linear-gradient/.test(premium.confirmationFond)
      && /229, 72, 77/.test(premium.confirmationBordure) && premium.confirmationLigne === 'nowrap',
    JSON.stringify(premium));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduit = await page.evaluate(() => ({
    reflet: getComputedStyle(document.querySelector('.pricing-card'), '::after').animationName,
    renfort: getComputedStyle(document.querySelector('.renfort-scan-line'), '::after').animationName,
    fidelite: getComputedStyle(document.querySelector('.track-line'), '::before').animationName
  }));
  check('N13 : la préférence de réduction des mouvements désactive les animations',
    reduit.reflet === 'none' && reduit.renfort === 'none' && reduit.fidelite === 'none', JSON.stringify(reduit));

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const bandeau = await page.evaluate(() => ({
    cycles: document.querySelectorAll('.slogan-cycle').length,
    groupes: document.querySelectorAll('.slogan-group').length,
    labels: Array.from(document.querySelectorAll('.slogan-cycle:first-child .slogan-group-label')).map(el => el.textContent.trim())
  }));
  check('N13b : le bandeau distingue marques, expertises et engagements',
    bandeau.cycles === 2 && bandeau.groupes === 6
      && bandeau.labels.join('|') === 'Ils nous font confiance|Nos expertises|Nos engagements', JSON.stringify(bandeau));
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const nav = document.querySelector('nav').getBoundingClientRect();
    const logo = document.querySelector('nav .logo').getBoundingClientRect();
    return {
      centreLogo: logo.left + logo.width / 2,
      centreNav: nav.left + nav.width / 2,
      actions: document.querySelectorAll('.nav-icon-action').length,
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth
    };
  });
  check('N14 : sur mobile le logo reste centré, la barre est allégée et ne déborde pas',
    Math.abs(mobile.centreLogo - mobile.centreNav) <= 1 && mobile.actions === 2 && mobile.scroll <= mobile.client,
    JSON.stringify(mobile));

  check('N15 : aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await browser.close();
  console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
