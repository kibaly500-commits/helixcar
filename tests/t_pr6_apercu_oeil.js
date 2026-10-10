// Régression navigateur : l'œil du dashboard doit réellement ouvrir le récapitulatif.
const { lancerNavigateur, urlFichier } = require('./env.js');

let pass = 0, fail = 0;
function check(libelle, condition) {
  if (condition) { console.log('PASS - ' + libelle); pass++; }
  else { console.log('FAIL - ' + libelle); fail++; }
}

(async function () {
  const navigateur = await lancerNavigateur({ headless: true });
  const page = await navigateur.newPage();
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });

  const resultat = await page.evaluate(async function () {
    window._currentClient = {
      demandes: [{
        id: 'demande-test-oeil',
        numero_client: 'HC-TEST-OEIL',
        type_service: 'stockage',
        statut: 'nouveau',
        nb_vehicules: 1
      }]
    };
    window._sbAuthPret = function () { return true; };
    window.sbAuth = {
      from: function () {
        return {
          select: function () {
            return {
              eq: function () {
                return {
                  order: async function () {
                    return { data: [], error: null };
                  }
                };
              }
            };
          }
        };
      }
    };

    const bouton = document.createElement('button');
    bouton.setAttribute('data-hc-action', 'ouvrirApercuDemandeClient');
    bouton.setAttribute('data-hc-a0', 'demande-test-oeil');
    document.body.appendChild(bouton);
    bouton.click();
    await new Promise(function (resolve) { setTimeout(resolve, 50); });

    const modale = document.getElementById('hc-apercu-demande');
    return {
      ouverte: !!(modale && modale.classList.contains('ouvert')),
      reference: document.getElementById('hc-apercu-reference') &&
        document.getElementById('hc-apercu-reference').textContent,
      contenu: document.getElementById('hc-apercu-contenu') &&
        document.getElementById('hc-apercu-contenu').textContent
    };
  });

  check("Le clic délégué sur l'œil ouvre la fenêtre", resultat.ouverte);
  check('La bonne demande est affichée', resultat.reference === 'HC-TEST-OEIL');
  check('Le récapitulatif contient la prestation', /Prestation/.test(resultat.contenu || ''));

  await navigateur.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (fail) process.exit(1);
})().catch(function (e) {
  console.error(e);
  console.log('\n=== ' + pass + ' PASS / ' + (fail + 1) + ' FAIL ===');
  process.exit(1);
});
