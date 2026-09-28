// Parcours navigateur : l'adresse partenaire est contrôlée à l'étape 1.
const L = require('./lib.js');

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);
  try {
    await page.evaluate(() => openModal('convoyeur'));
    await page.fill('#conv-prenom', 'Test');
    await page.fill('#conv-nom', 'HelixCar');
    await page.evaluate(() => {
      const civilite = document.getElementById('conv-civilite');
      civilite.value = 'monsieur';
      civilite.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.fill('#conv-email', 'partenaire-connu@example.invalid');
    await page.fill('#conv-tel', '+33600000000');
    await page.evaluate(() => {
      window.__verificationPartenaire = [];
      _convEmailDejaUtilise = async function (email) {
        window.__verificationPartenaire.push(email);
        return true;
      };
    });
    await page.click('#conv-step-next-btn');
    await page.waitForTimeout(80);

    const bloque = await page.evaluate(() => {
      const champ = document.getElementById('conv-email');
      const msg = document.getElementById('conv-email-err');
      const style = getComputedStyle(champ);
      return {
        etape: _formStepState.convoyeur,
        appels: window.__verificationPartenaire.slice(),
        messageVisible: !!(msg && msg.classList.contains('visible')),
        titre: msg ? msg.querySelector('strong').textContent : '',
        fond: style.backgroundImage + ' ' + style.backgroundColor
      };
    });
    L.check('E13 : une adresse connue reste sur la première étape', bloque.etape === 1);
    L.check('E14 : l’adresse normalisée est vérifiée une seule fois',
      bloque.appels.length === 1 && bloque.appels[0] === 'partenaire-connu@example.invalid');
    L.check('E15 : la carte d’erreur dédiée est visible immédiatement',
      bloque.messageVisible && bloque.titre === 'Adresse déjà associée à un compte');
    L.check('E16 : le champ en erreur ne reçoit aucun fond bleu', !/rgb\((?:0|[1-9]\d?),\s*(?:80|9\d|1\d\d|2[0-4]\d),\s*(?:1\d\d|2\d\d)\)/i.test(bloque.fond));

    await page.fill('#conv-email', 'nouveau-partenaire@example.invalid');
    const masque = await page.evaluate(() => {
      const msg = document.getElementById('conv-email-err');
      _convEmailDejaUtilise = async function () { return false; };
      return !!(msg && !msg.classList.contains('visible') && !msg.classList.contains('hc-email-existe'));
    });
    L.check('E17 : corriger l’adresse efface l’ancien message', masque);
    await page.click('#conv-step-next-btn');
    await page.waitForTimeout(80);
    L.check('E18 : une adresse disponible ouvre l’étape suivante',
      await page.evaluate(() => _formStepState.convoyeur === 2));
    L.check('E19 : aucune erreur JavaScript navigateur', page.jsErrors.length === 0, page.jsErrors.join(' | '));
  } finally {
    await browser.close();
  }
  process.exit(L.results() ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
