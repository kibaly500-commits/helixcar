// Non-regression : aucune creation en double avec une adresse deja connue.
const L = require('./lib.js');
const fs = require('fs');

(() => {
  const index = fs.readFileSync(L.fichier('index.html'), 'utf8');
  const migration = fs.readFileSync(L.fichier('migrations/125_email_partenaire_unique.sql'), 'utf8');
  const verification = fs.readFileSync(L.fichier('migrations/126_verification_precoce_email_partenaire.sql'), 'utf8');
  const correction = fs.readFileSync(L.fichier('migrations/127_correction_verification_email_partenaire.sql'), 'utf8');
  const verificationClient = fs.readFileSync(L.fichier('migrations/128_verification_precoce_email_client.sql'), 'utf8');

  L.check('E1 : le serveur normalise l’adresse partenaire avant comparaison',
    /email_normalise\s*:=\s*pg_catalog\.lower\(new\.email\)/i.test(migration));
  L.check('E2 : deux candidatures partenaire simultanées sont sérialisées',
    /private\.convoyeur_emails_reserves/i.test(migration)
      && /email_normalise\s+text\s+primary\s+key/i.test(migration));
  L.check('E3 : le serveur renvoie un conflit identifiable sans exposer la base',
    /errcode\s*=\s*'23505'/i.test(migration)
      && /message\s*=\s*'EMAIL_DEJA_UTILISE'/i.test(migration));
  L.check('E4 : les anciens doublons ne sont ni supprimés ni fusionnés',
    !/delete\s+from\s+public\.convoyeurs/i.test(migration)
      && !/create\s+unique\s+index/i.test(migration));
  L.check('E4b : la fonction privilégiée reste hors du schéma exposé',
    /function\s+private\.reserver_email_convoyeur/i.test(migration)
      && !/function\s+public\.refuser_email_convoyeur_duplique/i.test(migration)
      && /revoke all on function private\.reserver_email_convoyeur\(\)/i.test(migration));
  L.check('E5 : le formulaire partenaire affiche le message demandé',
    /_showFieldError\('conv-email',\s*'Cette adresse e-mail est déjà utilisée\.'/i.test(index));
  L.check('E6 : un compte client existant sans session bloque avant l’écriture',
    /if \(_compteEtat === 'existe_deja' && !_compteSession\)[\s\S]{0,900}return;[\s\S]{0,900}ÉCRITURE ATOMIQUE/i.test(index));
  L.check('E7 : le client est invité à se connecter pour une nouvelle demande',
    /Cette adresse e-mail est déjà utilisée\. Connectez-vous pour faire une nouvelle demande\./i.test(index));
  L.check('E8 : le partenaire est contrôlé dès le clic sur Continuer',
    /async function convStepNext\(\)[\s\S]{0,1800}_convEmailDejaUtilise\(emailVerifie\)[\s\S]{0,900}_convAfficherEmailDejaUtilise\(\)[\s\S]{0,200}return;/i.test(index));
  L.check('E9 : le contrôle préalable ne renvoie qu’un booléen borné',
    /function public\.email_partenaire_deja_utilise\(p_email text\)[\s\S]*returns boolean/i.test(verification)
      && /length\(email_normalise\) > 254/i.test(verification)
      && /return exists/i.test(verification));
  L.check('E10 : l’accès RPC est explicite et le registre reste privé',
    /revoke all on function public\.email_partenaire_deja_utilise\(text\)[\s\S]*from public, anon, authenticated/i.test(verification)
      && /grant execute on function public\.email_partenaire_deja_utilise\(text\)[\s\S]*to anon, authenticated/i.test(verification)
      && !/grant\s+select[\s\S]*convoyeur_emails_reserves/i.test(verification));
  L.check('E10b : la comparaison finale distingue la variable de la colonne',
    /where reserve\.email_normalise\s*=\s*v_email_normalise/i.test(correction));
  L.check('E11 : le message partenaire est une carte HelixCar rouge et ivoire',
    /#modal-convoyeur \.field-error-msg\.hc-email-existe[\s\S]{0,700}background:\s*#fff8f3/i.test(index)
      && /Adresse déjà associée à un compte/i.test(index));
  L.check('E12 : le bleu natif est neutralisé aussi pour le formulaire partenaire',
    /#modal-convoyeur input[^\n]*:-webkit-autofill[\s\S]{0,1400}box-shadow:\s*0 0 0 1000px #fff inset !important/i.test(index));
  L.check('E13 : le serveur vérifie les comptes et les dossiers client',
    /function public\.email_client_deja_utilise\(p_email text\)[\s\S]*from auth\.users[\s\S]*from public\.clients/i.test(verificationClient));
  L.check('E14 : le contrôle client ne renvoie qu’un booléen borné',
    /returns boolean/i.test(verificationClient)
      && /length\(v_email_normalise\) > 254/i.test(verificationClient));
  L.check('E15 : les permissions de la RPC client sont explicites',
    /revoke all on function public\.email_client_deja_utilise\(text\)[\s\S]*from public, anon, authenticated/i.test(verificationClient)
      && /grant execute on function public\.email_client_deja_utilise\(text\)[\s\S]*to anon, authenticated/i.test(verificationClient));
  L.check('E16 : le client est vérifié dès le premier clic sur Continuer',
    /async function clientStepNext\(\)[\s\S]{0,2200}_clientEmailDejaUtilise\(emailVerifie\)[\s\S]{0,900}_clientAfficherEmailDejaUtilise\(\)[\s\S]{0,200}return;/i.test(index));
  L.check('E17 : un client déjà connecté n’est pas bloqué par sa propre adresse',
    /_formStepState\.client === 1 && !_hcIdCompteConnecte\(\)/.test(index));
  L.check('E18 : le message client reprend la carte rouge et ivoire du partenaire',
    /#modal-client \.field-error-msg\.hc-email-existe[\s\S]{0,800}background:\s*#fff8f3/i.test(index)
      && /Cette adresse e-mail est déjà utilisée\. Connectez-vous pour faire une nouvelle demande\./i.test(index));

  process.exit(L.results() ? 1 : 0);
})();
