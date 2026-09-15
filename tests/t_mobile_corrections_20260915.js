// Corrections mobiles du 15/09/2026 : vitrine, calendrier et zoom tactile.
const { lancerNavigateur, fichier, urlFichier } = require('./env.js');
const fs = require('fs');

let pass = 0, fail = 0;
function check(libelle, condition, detail) {
  if (condition) { console.log('PASS - ' + libelle); pass++; }
  else { console.log('FAIL - ' + libelle + (detail ? '  [' + detail + ']' : '')); fail++; }
}

(async () => {
  const source = fs.readFileSync(fichier('index.html'), 'utf8');
  check('M0 : le calendrier intercepte le premier geste tactile iPhone',
    /touchstart[\s\S]{0,500}e\.preventDefault\(\)[\s\S]{0,250}_hcOuvrirCalendrier\(champ\)/.test(source) &&
    /passive:\s*false/.test(source));

  const browser = await lancerNavigateur();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const erreurs = [];
  mobile.on('pageerror', e => erreurs.push(e.message));
  await mobile.goto(urlFichier('index.html'), { waitUntil: 'load' });

  const renduMobile = await mobile.evaluate(() => {
    const note = document.querySelector('.pricing-note-inner');
    const texte = note.querySelector(':scope > div:first-child');
    const bouton = note.querySelector('.btn');
    const tag = document.querySelector('.renfort-tag');
    const ligne = document.querySelector('.hero2-panel .hero2-route-line');
    const dot1 = document.querySelector('.hero2-panel .hero2-route-point:first-child .hero2-route-dot');
    const dot2 = document.querySelector('.hero2-panel .hero2-route-point:nth-child(3) .hero2-route-dot');
    const dot3 = document.querySelector('.hero2-panel .hero2-route-point:nth-child(5) .hero2-route-dot');
    const evt = new Event('touchstart', { bubbles: true, cancelable: true });
    document.getElementById('stock-debut').dispatchEvent(evt);
    return {
      touchAction: getComputedStyle(document.body).touchAction,
      noteDisplay: getComputedStyle(note).display,
      noteColumns: getComputedStyle(note).gridTemplateColumns,
      texteLargeur: texte.getBoundingClientRect().width,
      boutonLargeur: bouton.getBoundingClientRect().width,
      noteLargeur: note.getBoundingClientRect().width,
      decoration: getComputedStyle(tag).textDecorationLine,
      bordBas: getComputedStyle(tag).borderBottomWidth,
      ligneLargeur: ligne.getBoundingClientRect().width,
      ligneEffet: getComputedStyle(ligne, '::after').filter,
      dot1Fond: getComputedStyle(dot1).backgroundColor,
      dot1Bord: getComputedStyle(dot1).borderTopColor,
      dot1Halo: getComputedStyle(dot1).boxShadow,
      animationDot2: getComputedStyle(dot2).animationName,
      animationDot3: getComputedStyle(dot3).animationName,
      datePrevented: evt.defaultPrevented,
      calendrierOuvert: document.querySelector('.hc-cal-overlay').classList.contains('open'),
      debordement: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    };
  });

  check('M1 : le double toucher ne zoome plus la page', renduMobile.touchAction === 'manipulation', JSON.stringify(renduMobile));
  check('M2 : le bloc tarifaire mobile empile proprement texte et bouton',
    renduMobile.noteDisplay === 'grid' && renduMobile.texteLargeur > 280 &&
    renduMobile.boutonLargeur >= renduMobile.noteLargeur - 42, JSON.stringify(renduMobile));
  check('M3 : aucun soulignement sous Renfort',
    renduMobile.decoration === 'none' && renduMobile.bordBas === '0px', JSON.stringify(renduMobile));
  check('M4 : les traits de progression sont élargis sur mobile',
    renduMobile.ligneLargeur >= 34, JSON.stringify(renduMobile));
  check('M5 : les deuxième et troisième étapes s’allument successivement',
    /hc-mobile-route-dot-2/.test(renduMobile.animationDot2) &&
    /hc-mobile-route-dot-3/.test(renduMobile.animationDot3), JSON.stringify(renduMobile));
  check('M5b : le premier jalon reprend le rendu lumineux Paris-Lyon',
    renduMobile.dot1Fond === 'rgb(245, 242, 234)' &&
    renduMobile.dot1Bord === 'rgb(181, 68, 75)' && renduMobile.dot1Halo !== 'none', JSON.stringify(renduMobile));
  check('M5c : les traits utilisent aussi la surbrillance lumineuse',
    renduMobile.ligneEffet !== 'none', JSON.stringify(renduMobile));
  check('M5d : traits et jalons partagent exactement les seuils de synchronisation',
    /hc-mobile-route-line-1[\s\S]*30%,94%/.test(source) &&
    /hc-mobile-route-dot-2[\s\S]*30%,94%/.test(source) &&
    /hc-mobile-route-line-2[\s\S]*60%,94%/.test(source) &&
    /hc-mobile-route-dot-3[\s\S]*60%,94%/.test(source));
  check('M6 : le calendrier HelixCar remplace le calendrier natif au toucher',
    renduMobile.datePrevented && renduMobile.calendrierOuvert, JSON.stringify(renduMobile));
  check('M7 : aucun débordement horizontal mobile', !renduMobile.debordement, JSON.stringify(renduMobile));
  check('M8 : aucune erreur JavaScript mobile', erreurs.length === 0, erreurs.join(' | '));
  await mobile.close();

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(urlFichier('index.html'), { waitUntil: 'load' });
  const renduDesktop = await desktop.evaluate(() => {
    const note = document.querySelector('.pricing-note-inner');
    const panel = document.querySelector('.hero2-panel');
    const dot2 = document.querySelector('.hero2-panel .hero2-route-point:nth-child(3) .hero2-route-dot');
    return {
      noteDisplay: getComputedStyle(note).display,
      panelPadding: getComputedStyle(panel).padding,
      dot2Animation: getComputedStyle(dot2).animationName,
      touchAction: getComputedStyle(document.body).touchAction
    };
  });
  check('M9 : le bloc tarifaire PC reste horizontal', renduDesktop.noteDisplay === 'flex', JSON.stringify(renduDesktop));
  check('M10 : le panneau PC conserve ses dimensions', renduDesktop.panelPadding === '36px 32px', JSON.stringify(renduDesktop));
  check('M11 : l’animation mobile ne s’applique pas sur PC',
    renduDesktop.dot2Animation === 'none' && renduDesktop.touchAction !== 'manipulation', JSON.stringify(renduDesktop));

  const dashboardMobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  await dashboardMobile.goto(urlFichier('dashboard.html'), { waitUntil: 'domcontentloaded' });
  const dashboardTouch = await dashboardMobile.evaluate(() => getComputedStyle(document.body).touchAction);
  check('M12 : le Dashboard client neutralise aussi le double toucher mobile',
    dashboardTouch === 'manipulation', dashboardTouch);
  await dashboardMobile.close();

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (fail) process.exit(1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
