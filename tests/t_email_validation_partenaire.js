// Non-régression : l'e-mail de validation reste générique et les règles
// opérationnelles ne sont envoyées qu'avec une mission attribuée.
const L = require('./lib.js');
const fs = require('fs');

(() => {
  const dashboard = fs.readFileSync(L.fichier('dashboard.html'), 'utf8');
  const serveur = fs.readFileSync(L.fichier('supabase/functions/partenaire-validation/index.ts'), 'utf8');
  const debutEnvoi = dashboard.indexOf('async function _appelerValidationPartenaire(');
  const debutValidation = dashboard.indexOf('function validerConvoyeur(');
  const finValidation = dashboard.indexOf('function refuserConvoyeur(', debutValidation);
  const envoi = dashboard.slice(debutEnvoi, debutValidation);
  const validation = dashboard.slice(debutValidation, finValidation);
  const debutMission = dashboard.indexOf('function envoyerEmailFicheMission(');
  const finMission = dashboard.indexOf('// ── HISTORIQUE / SUIVI DE MISSION', debutMission);
  const mission = dashboard.slice(debutMission, finMission);

  L.check('E1 : le changement de domaine du lien reste reporté au lot final',
    /HELIXCAR_URL_PUBLIQUE/.test(serveur)
      && /creer-compte-convoyeur\.html\?email=/.test(serveur));
  L.check('E2 : l’e-mail de validation ne contient plus les règles de mission',
    !/Quelques règles importantes|Tenue professionnelle|Annulation client|niveau de carburant/.test(serveur));
  L.check('E3 : l’e-mail de validation ne dit plus « À très vite sur la route »',
    !/À très vite sur la route/.test(serveur));
  L.check('E4 : l’e-mail de validation conserve une signature neutre',
    /Cordialement,\\nL'équipe HelixCar/.test(serveur));
  L.check('E5 : les règles sont présentes dans l’e-mail envoyé avant une mission',
    /Quelques règles importantes à respecter pour cette mission/.test(mission)
      && /Tenue professionnelle obligatoire/.test(mission)
      && /Tout retard, absence injustifiée ou infraction routière/.test(mission)
      && /Annulation client < 48h avant/.test(mission)
      && /même niveau de carburant/.test(mission));
  L.check('E6 : la validation attend réellement la réponse du service d’e-mail',
    /await _appelerValidationPartenaire\(id, 'valider'\)/.test(validation)
      && /resultat\.email_accepte/.test(validation));
  L.check('E7 : l’écran n’annonce plus un envoi lorsque le prestataire l’a refusé',
    /La validation est bien enregistrée, mais le lien de création de mot de passe n’a pas été envoyé/.test(validation));
  L.check('E8 : un partenaire actif sans compte peut recevoir un nouveau lien',
    /function renvoyerLienCreationPartenaire\(id\)/.test(dashboard)
      && /Renvoyer le lien/.test(dashboard)
      && /c\.auth_user_id/.test(dashboard)
      && /'renvoyerLienCreationPartenaire'/.test(dashboard));
  L.check('E9 : l’envoi automatique ne dépend plus d’EmailJS dans le navigateur',
    !/emailjs\.(send|sendForm)/.test(envoi + validation)
      && /functions\/v1\/partenaire-validation/.test(dashboard)
      && /fetch\(URL_FONCTION_VALIDATION_PARTENAIRE/.test(envoi));
  L.check('E10 : le serveur relit le destinataire et exige un administrateur actif',
    /from\("admins"\)/.test(serveur)
      && /from\("convoyeurs"\)/.test(serveur)
      && /to: \[destinataire\]/.test(serveur)
      && !/body\?\.email/.test(serveur));

  process.exit(L.results() ? 1 : 0);
})();
