// RIB APRÈS VALIDATION + PROGRESSION VIDÉO VISIBLE
// Contrôles structurels de sécurité complétés par les campagnes
// navigateur qui chargent réellement index.html et dashboard.html.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(libelle, condition) {
  if (condition) { console.log('PASS - ' + libelle); pass++; }
  else { console.log('FAIL - ' + libelle); fail++; }
}

const racine = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
const dashboard = fs.readFileSync(path.join(racine, 'dashboard.html'), 'utf8');
const migration = fs.readFileSync(path.join(racine, 'migrations/120_rib_partenaire_prive.sql'), 'utf8');

check('V1 : progression vidéo visible sur l\'étape finale', /id="conv-soumission-video"/.test(index));
check('V2 : le pourcentage est alimenté par convMajProgressionVideo',
  /function convMajProgressionVideo[\s\S]*conv-soumission-video-pourcent/.test(index));
check('V3 : transfert et vérification serveur sont deux états distincts',
  /_convAfficherEtapeSoumissionVideo\('verification'\)/.test(index)
  && /Vidéo envoyée — vérification de sécurité en cours/.test(index));
check('V4 : aucune progression fictive pendant la vérification',
  /etat === 'verification'[\s\S]{0,500}piste\.style\.display = 'none'/.test(index));

check('R1 : rappel RIB affichable après connexion partenaire', /id="conv-rib-rappel"/.test(dashboard));
check('R2 : dépôt limité aux formats attendus et à 10 Mo',
  /application\/pdf,image\/jpeg,image\/png/.test(dashboard) && /10 \* 1024 \* 1024/.test(dashboard));
check('R3 : chemin du RIB rattaché à l\'identifiant du partenaire',
  /conv\.id \+ '\/rib\/'/.test(dashboard));
check('R4 : bucket explicitement privé',
  /'convoyeurs-documents', 'convoyeurs-documents', false, 10485760/.test(migration)
  && /set public = false/.test(migration));
check('R5 : aucune politique anonyme sur le bucket RIB',
  !/on storage\.objects[\s\S]{0,120}to anon/.test(migration));
check('R6 : lecture limitée au propriétaire ou à l\'administrateur',
  /lecture proprietaire admin/.test(migration) && /c\.auth_user_id = \(select auth\.uid\(\)\)/.test(migration));
check('R7 : une candidature publique doit laisser le RIB vide', /with check \(rib_iban is null\)/.test(migration));
check('R8 : le serveur exige que le fichier existe et appartienne au compte',
  /from storage\.objects o/.test(migration) && /o\.owner_id = auth\.uid\(\)::text/.test(migration));

console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
