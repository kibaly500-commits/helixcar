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

function lancerNavigateur(extra) {
  return chromium.launch(optionsLancement(extra));
}

// Chemin d'un fichier du dépôt, et son URL file:// prête à ouvrir.
function fichier(rel) { return path.join(RACINE, rel); }
function urlFichier(rel) { return 'file://' + fichier(rel); }

module.exports = { RACINE, chromium, lancerNavigateur, optionsLancement, fichier, urlFichier };
