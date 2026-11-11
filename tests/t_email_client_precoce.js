// Parcours navigateur : une adresse client connue bloque dès l'étape 1.
const L = require('./lib.js');

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);
  try {
    await page.evaluate(() => openModal('client'));
    await page.selectOption('#client-type', 'particulier');
    await page.fill('#client-prenom', 'Test');
    await page.fill('#client-nom', 'Client');
    await page.fill('#client-email', 'client-connu@example.invalid');
    await page.fill('#client-tel', '+33600000000');
    await page.fill('#client-password', 'MotDePasse123!');
    await page.selectOption('#client-source', 'google');
    await page.evaluate(() => {
      window.__verificationClient = [];
      _clientEmailDejaUtilise = async function (email) {
        window.__verificationClient.push(email);
        return true;
      };
    });
    await page.click('#client-step-next-btn');
    await page.waitForTimeout(80);

    const bloque = await page.evaluate(() => {
      const champ = document.getElementById('client-email');
      const msg = document.getElementById('client-email-err');
      return {
        etape: _formStepState.client,
        appels: window.__verificationClient.slice(),
        visible: !!(msg && msg.classList.contains('visible')),
        texte: msg ? msg.textContent : '',
        fond: getComputedStyle(champ).backgroundImage + ' ' + getComputedStyle(champ).backgroundColor
      };
    });
    L.check('EC1 : une adresse client connue reste sur la première étape', bloque.etape === 1);
    L.check('EC2 : l’adresse normalisée est vérifiée une seule fois',
      bloque.appels.length === 1 && bloque.appels[0] === 'client-connu@example.invalid');
    L.check('EC3 : le message demandé apparaît immédiatement',
      bloque.visible && /Cette adresse e-mail est déjà utilisée/.test(bloque.texte));
    L.check('EC4 : le champ en erreur ne reçoit aucun fond bleu',
      !/rgb\((?:0|[1-9]\d?),\s*(?:80|9\d|1\d\d|2[0-4]\d),\s*(?:1\d\d|2\d\d)\)/i.test(bloque.fond));

    await page.fill('#client-email', 'nouveau-client@example.invalid');
    await page.evaluate(() => { _clientEmailDejaUtilise = async function () { return false; }; });
    await page.click('#client-step-next-btn');
    await page.waitForTimeout(80);
    L.check('EC5 : une adresse disponible ouvre l’étape suivante',
      await page.evaluate(() => _formStepState.client === 2));
    L.check('EC6 : aucune erreur JavaScript navigateur', page.jsErrors.length === 0, page.jsErrors.join(' | '));
  } finally {
    await browser.close();
  }
  process.exit(L.results() ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
