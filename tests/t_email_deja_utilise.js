// Non-regression : aucune creation en double avec une adresse deja connue.
const L = require('./lib.js');
const fs = require('fs');

(() => {
  const index = fs.readFileSync(L.fichier('index.html'), 'utf8');
  const migration = fs.readFileSync(L.fichier('migrations/125_email_partenaire_unique.sql'), 'utf8');

  L.check('E1 : le serveur normalise l’adresse partenaire avant comparaison',
    /lower\s*\(\s*(?:pg_catalog\.)?btrim\s*\(\s*c\.email\s*\)\s*\)/i.test(migration));
  L.check('E2 : deux candidatures partenaire simultanées sont sérialisées',
    /pg_advisory_xact_lock/i.test(migration) && /hashtextextended/i.test(migration));
  L.check('E3 : le serveur renvoie un conflit identifiable sans exposer la base',
    /errcode\s*=\s*'23505'/i.test(migration)
      && /message\s*=\s*'EMAIL_DEJA_UTILISE'/i.test(migration));
  L.check('E4 : les anciens doublons ne sont ni supprimés ni fusionnés',
    !/delete\s+from\s+public\.convoyeurs/i.test(migration)
      && !/create\s+unique\s+index/i.test(migration));
  L.check('E5 : le formulaire partenaire affiche le message demandé',
    /_showFieldError\('conv-email',\s*'Cette adresse e-mail est déjà utilisée\.'/i.test(index));
  L.check('E6 : un compte client existant sans session bloque avant l’écriture',
    /if \(_compteEtat === 'existe_deja' && !_compteSession\)[\s\S]{0,900}return;[\s\S]{0,900}ÉCRITURE ATOMIQUE/i.test(index));
  L.check('E7 : le client est invité à se connecter pour une nouvelle demande',
    /Cette adresse e-mail est déjà utilisée\. Connectez-vous pour faire une nouvelle demande\./i.test(index));

  process.exit(L.results() ? 1 : 0);
})();
