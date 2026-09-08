// SOCLE COMMUN DES TESTS — chemins portables
// ------------------------------------------------------------------
// Les suites référençaient des chemins propres à une machine :
// /home/user/helixcar, /opt/node22/lib/node_modules/playwright,
// /opt/pw-browsers/chromium-1194/... Elles ne pouvaient donc tourner
// nulle part ailleurs, et surtout pas dans une intégration continue.
//
// Ce module résout les trois questions une fois pour toutes :
//   * où est le dépôt          -> RACINE, déduite de CE fichier ;
//   * où est Playwright        -> la dépendance du projet, ou celle
//                                 indiquée par PLAYWRIGHT_MODULE ;
//   * où est le navigateur     -> celui que Playwright a installé, ou
//                                 celui indiqué par CHROME_PATH.
//
// Aucun chemin absolu n'y est écrit en dur.
const path = require('path');

const RACINE = path.resolve(__dirname, '..');

function chargerPlaywright() {
  // 1) Un chemin explicite, pour un environnement déjà outillé.
  if (process.env.PLAYWRIGHT_MODULE) {
    return require(process.env.PLAYWRIGHT_MODULE);
  }
  // 2) La dépendance du projet (npm ci), le cas normal en intégration.
  try { return require('playwright'); } catch (e) { /* essai suivant */ }
  try { return require('@playwright/test'); } catch (e) { /* essai suivant */ }
  // 3) Une installation globale, pour un poste de développement.
  const globaux = [
    '/opt/node22/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright',
  ];
  for (const g of globaux) {
    try { return require(g); } catch (e) { /* suivant */ }
  }
  throw new Error(
    'Playwright est introuvable.\n' +
    'Installez les dépendances du projet :  npm ci && npx playwright install chromium\n' +
    'ou indiquez son emplacement :          PLAYWRIGHT_MODULE=/chemin/vers/playwright'
  );
}

const { chromium } = chargerPlaywright();

// Options de lancement. Sans CHROME_PATH, Playwright utilise le
// navigateur qu'il a lui-même installé — c'est le cas nominal.
function optionsLancement(extra) {
  const o = Object.assign({}, extra || {});
  if (process.env.CHROME_PATH) o.executablePath = process.env.CHROME_PATH;
  // En conteneur d'intégration, le bac à sable du noyau n'est pas
  // toujours disponible. On ne l'assouplit QUE si on l'y demande.
  if (process.env.CI_NO_SANDBOX === '1') {
    o.args = (o.args || []).concat(['--no-sandbox', '--disable-dev-shm-usage']);
  }
  return o;
}

// ── ISOLEMENT RÉSEAU — non négociable ───────────────────────
// Les suites remplacent Supabase par un double, injecté avant le
// chargement de la page. Ce double ne tient QUE si la vraie
// bibliothèque ne se charge pas : `index.html` et `dashboard.html`
// chargent supabase-js depuis un CDN, et
//
//     const sbAuth = window.supabase ? window.supabase.createClient(...) : null
//
// prend la DERNIÈRE valeur de window.supabase. Si le CDN répond, la
// vraie bibliothèque écrase le double, et les tests parlent au VRAI
// projet Supabase.
//
// Sur un poste sans accès sortant, cela ne se voit pas : le CDN est
// injoignable, le double gagne. Sur GitHub Actions, le CDN répond — et
// 44 contrôles sont tombés d'un coup, tous pour cette raison. Le pire
// n'était pas l'échec : c'est que les tests auraient pu ATTEINDRE la
// base réelle.
//
// On ne laisse donc plus cela au hasard du réseau. Toute requête
// sortante est coupée, partout, sur toutes les machines. Seuls
// subsistent les fichiers locaux et les serveurs de test lancés sur la
// machine elle-même (t_tus).
const RESEAU_AUTORISE =
  /^(file:|data:|blob:|about:|chrome-|https?:\/\/(localhost|127\.0\.0\.1)([:/]|$))/i;

async function isolerPage(page) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (RESEAU_AUTORISE.test(url)) return route.continue();
    return route.abort();
  });
  return page;
}

function _isolerNavigateur(navigateur) {
  const newPageReel = navigateur.newPage.bind(navigateur);
  navigateur.newPage = async function (...args) {
    const page = await newPageReel(...args);
    await isolerPage(page);
    return page;
  };
  const newContextReel = navigateur.newContext.bind(navigateur);
  navigateur.newContext = async function (...args) {
    const contexte = await newContextReel(...args);
    // Au niveau du contexte : toutes ses pages en héritent, y compris
    // celles ouvertes plus tard.
    await contexte.route('**/*', (route) => {
      const url = route.request().url();
      if (RESEAU_AUTORISE.test(url)) return route.continue();
      return route.abort();
    });
    return contexte;
  };
  return navigateur;
}

async function lancerNavigateur(extra) {
  return _isolerNavigateur(await chromium.launch(optionsLancement(extra)));
}

// DATE CIVILE — jamais UTC.
//
// toISOString() convertit vers UTC. En France (UTC+1, UTC+2 l'été), le
// 10 décembre à minuit heure locale devient « 2026-12-09T23:00:00Z » :
// découper les dix premiers caractères donne LA VEILLE. Un test bâti
// dessus passe sous TZ=UTC et échoue sous Europe/Paris — c'est-à-dire
// dans le fuseau des utilisateurs.
//
// C'est le formateur de la production (_hcFormaterYMD dans index.html) :
// on compare des dates civiles avec la règle qui les produit.
function jourCivil(d) {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function dansNJours(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return jourCivil(d);
}

// Chemin d'un fichier du dépôt, et son URL file:// prête à ouvrir.
function fichier(rel) { return path.join(RACINE, rel); }
function urlFichier(rel) { return 'file://' + fichier(rel); }

module.exports = { RACINE, chromium, lancerNavigateur, optionsLancement, fichier, urlFichier,
                   jourCivil, dansNJours, isolerPage };
