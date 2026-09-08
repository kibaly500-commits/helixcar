// Helpers partagés pour les tests navigateur HelixCar
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier, jourCivil, dansNJours } = require('./env.js');
const path = require('path');

const FILE = urlFichier('index.html');
// Le navigateur vient de env.js : celui que Playwright a installé,
// ou celui indiqué par CHROME_PATH. Plus aucun chemin en dur.
const EXE = process.env.CHROME_PATH || undefined;

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { console.log('PASS - ' + label); pass++; }
  else { console.log('FAIL - ' + label + (extra ? '  [' + extra + ']' : '')); fail++; failures.push(label); }
}
function results() {
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (failures.length) { console.log('Échecs :'); failures.forEach(f => console.log('  - ' + f)); }
  return fail;
}

async function launch() {
  return lancerNavigateur({ });
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      const t = m.text();
      // Bruit attendu en file:// sans réseau (CDN, EmailJS, Supabase).
      if (/ERR_|emailjs|Failed to load resource|net::/i.test(t)) return;
      errors.push('CONSOLE: ' + t);
    }
  });
  await page.goto(FILE, { waitUntil: 'load' });
  page.jsErrors = errors;
  return page;
}

// Étape 1 complète
async function fillStep1(page, clientType) {
  await page.evaluate(() => { try { openModal('client'); } catch (e) {} });
  await page.waitForTimeout(60);
  await page.selectOption('#client-type', clientType);
  await page.waitForTimeout(40);
  if (clientType === 'pro') {
    await page.fill('#client-societe', 'TEST-QA Flotte SAS');
    await page.fill('#client-siret', '900 068 685 00012');
  }
  await page.fill('#client-prenom', 'TEST-QA');
  await page.fill('#client-nom', 'Dupont');
  await page.fill('#client-email', 'test-qa@example.invalid');
  await page.fill('#client-tel', '+33600000000');
  await page.fill('#client-password', 'Password123!');
  await page.selectOption('#client-source', 'google');
  await page.click('#client-step-next-btn');
  await page.waitForTimeout(80);
}

async function chooseService(page, value) {
  await page.click('input[name="type-service"][value="' + value + '"]');
  await page.waitForTimeout(60);
}

// Étape 2 nettoyage complète et valide
async function fillNettoyageStep2(page, total, repartition, prestation) {
  await page.click('#nett-elig-emplacement');
  await page.waitForTimeout(30);
  await page.click('#nett-elig-eau-elec');
  await page.waitForTimeout(30);
  await page.fill('#nett-nb-approx', String(total));
  await page.dispatchEvent('#nett-nb-approx', 'input');
  await page.dispatchEvent('#nett-nb-approx', 'change');
  await page.waitForTimeout(40);
  for (const [cat, n] of Object.entries(repartition)) {
    for (let i = 0; i < n; i++) {
      await page.click('[data-cat="' + cat + '"] .nett-rep-btn:last-child');
      await page.waitForTimeout(15);
    }
  }
  if (prestation) {
    await page.click('input[name="nett-type"][value="' + prestation + '"]');
    await page.waitForTimeout(40);
  }
}

// Contact sur place générique (préfixe : nett, pro...)
async function fillContactSurPlace(page, prefix, type, nom, tel) {
  await page.click('input[name="' + prefix + '-contact-sp"][value="' + type + '"]');
  await page.waitForTimeout(50);
  if (type === 'autre') {
    await page.fill('#' + prefix + '-contact-sp-nom', nom);
    await page.fill('#' + prefix + '-contact-sp-tel', tel);
    await page.waitForTimeout(30);
  }
}

// Étape 4 nettoyage complète et valide
async function fillNettoyageStep4(page, opts) {
  opts = opts || {};
  await page.click('input[name="nett-lieu"][value="' + (opts.lieu || 'locaux_client') + '"]');
  await page.waitForTimeout(50);
  await page.fill('#nett-adresse-rue', '24 avenue Victor-Hugo');
  await page.fill('#nett-adresse-cp', '93260');
  await page.fill('#nett-adresse-ville', 'Les Lilas');
  await fillContactSurPlace(page, 'nett',
    opts.contactType || 'autre', opts.contactNom || 'Karim B.', opts.contactTel || '+33600000000');
  // PÉRIODE d'intervention : début et fin. La question « Quelle est
  // votre disponibilité ? » n'existe plus ; l'horaire sur place est une
  // plage facultative, toujours visible.
  await page.evaluate((jours) => {
    // Dates CIVILES : toISOString() reculerait d'un jour en France.
    const _p = (n) => String(n).padStart(2, '0');
    const ymd = (n) => {
      const d = new Date(); d.setDate(d.getDate() + n);
      return d.getFullYear() + '-' + _p(d.getMonth() + 1) + '-' + _p(d.getDate());
    };
    document.getElementById('nett-date').value = ymd(jours.debut);
    document.getElementById('nett-date-fin').value = ymd(jours.fin);
    document.getElementById('nett-creneau-debut').value = '09:00';
    document.getElementById('nett-creneau-fin').value = '17:00';
  }, { debut: opts.joursDebut === undefined ? 7 : opts.joursDebut,
       fin: opts.joursFin === undefined ? 9 : opts.joursFin });
  await page.click('input[name="nett-delai"][value="standard"]');
  await page.waitForTimeout(40);
}

async function btnState(page) {
  return page.evaluate(() => {
    const b = document.getElementById('client-step-next-btn');
    return { disabled: b.disabled, opacity: b.style.opacity };
  });
}

async function step(page) { return page.evaluate(() => _formStepState.client); }

module.exports = {
  // Réexportés depuis env.js : une suite qui charge lib.js dispose des
  // mêmes helpers de chemin, sans second require.
  RACINE, fichier, urlFichier, lancerNavigateur, jourCivil, dansNJours, launch, newPage, fillStep1, chooseService, fillNettoyageStep2, fillNettoyageStep4, fillContactSurPlace, btnState, step, check, results, FILE };
