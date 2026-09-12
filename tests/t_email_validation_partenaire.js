// Non-régression : l'e-mail de validation reste générique et les règles
// opérationnelles ne sont envoyées qu'avec une mission attribuée.
const L = require('./lib.js');
const fs = require('fs');

(() => {
  const dashboard = fs.readFileSync(L.fichier('dashboard.html'), 'utf8');
  const debutValidation = dashboard.indexOf('function validerConvoyeur(');
  const finValidation = dashboard.indexOf('function refuserConvoyeur(', debutValidation);
  const validation = dashboard.slice(debutValidation, finValidation);
  const debutMission = dashboard.indexOf('function envoyerEmailFicheMission(');
  const finMission = dashboard.indexOf('// ── HISTORIQUE / SUIVI DE MISSION', debutMission);
  const mission = dashboard.slice(debutMission, finMission);

  L.check('E1 : le changement de domaine du lien reste reporté au lot final',
    /const lienCompte = _hcOrigineOfficielle\(\) \+ '\/creer-compte-convoyeur\.html\?email='/.test(validation));
  L.check('E2 : l’e-mail de validation ne contient plus les règles de mission',
    !/Quelques règles importantes|Tenue professionnelle|Annulation client|niveau de carburant/.test(validation));
  L.check('E3 : l’e-mail de validation ne dit plus « À très vite sur la route »',
    !/À très vite sur la route/.test(validation));
  L.check('E4 : l’e-mail de validation conserve une signature neutre',
    /Cordialement,\\nL\\'équipe HelixCar/.test(validation));
  L.check('E5 : les règles sont présentes dans l’e-mail envoyé avant une mission',
    /Quelques règles importantes à respecter pour cette mission/.test(mission)
      && /Tenue professionnelle obligatoire/.test(mission)
      && /Tout retard, absence injustifiée ou infraction routière/.test(mission)
      && /Annulation client < 48h avant/.test(mission)
      && /même niveau de carburant/.test(mission));

  process.exit(L.results() ? 1 : 0);
})();
