// Non-régression — lot PR 6 validé le 13/09/2026.
const fs = require('fs');
const path = require('path');
const RACINE = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const dashboard = fs.readFileSync(path.join(RACINE, 'dashboard.html'), 'utf8');
const pdfServeur = fs.readFileSync(path.join(RACINE, 'supabase/functions/_shared/devis-pdf.mjs'), 'utf8');

let pass = 0, fail = 0;
function check(libelle, condition) {
  if (condition) { console.log('PASS - ' + libelle); pass++; }
  else { console.log('FAIL - ' + libelle); fail++; }
}

// Le correctif créneau ne doit plus neutraliser le mode heure précise.
check('Heure précise délègue au sélecteur commun hors créneau',
  index.includes('return ajusterHeureSimple.apply(this, arguments);'));
check('Le sélecteur créneau conserve la contrainte de quinze minutes',
  index.includes("f = Math.max(d + 15, Math.min(1439, candidat));"));

// Stockage : le trajet opérationnel peut exister, sans demander sa raison.
check('Type de trajet limité au service principal convoyage',
  index.includes("var servicePrincipalConvoyage = (t === 'convoyage' || t === 'convoyage_stockage');") &&
  index.includes("grpTrajet.style.display = servicePrincipalConvoyage ? 'block' : 'none';"));

// Duplication : la limite dépend du total, jamais de l'état antérieur des fiches.
check('Toutes les autres fiches sont duplicables',
  index.includes("for (var j = 0; j < n; j++) { if (j !== source) out.push(j); }"));
check('Les données duplicables remplacent la cible sans copier ses plaques',
  index.includes("['type', 'marque', 'vin',") &&
  index.includes('Les plaques restent propres à chaque véhicule et ne sont jamais copiées.'));
check('L’ancien message de blocage de duplication a disparu',
  !index.includes("Aucune fiche véhicule vierge n'est disponible"));

// L’option pro reste désactivée pour un particulier, mais sans curseur rouge.
check('Nettoyage professionnel grisé sans symbole d’interdiction',
  index.includes('label.radio-opt.hc-opt-reservee {\n  opacity: .55;\n  cursor: default;') &&
  index.includes('label.radio-opt.hc-opt-reservee input[type="radio"] { cursor: default; }'));

// Nouvelle demande et parasite visuel.
check('Sous-titre de compte supprimé de Nouvelle demande',
  !dashboard.includes('Vos informations de compte sont déjà connues : elles ne vous seront pas redemandées.'));
check('Le caractère n parasite est retiré uniquement en mode intégré',
  index.includes('function retirerNParasiteIntegre()') &&
  index.includes("noeud.nodeValue.trim() === 'n'"));

// Les deux générateurs PDF doivent rester strictement alignés.
for (const [nom, source] of [['navigateur', dashboard], ['serveur', pdfServeur]]) {
  check('Titre véhicule singulier/pluriel sans « à stocker » — ' + nom,
    source.includes("var titreVeh = vhPdf.length === 1 ? 'Véhicule' : 'Véhicules';") &&
    !source.includes("? 'Véhicule à stocker'"));
  check('Stockage avec transport HelixCar mentionne le convoyage — ' + nom,
    source.includes("if (_operationAssureeParHelixCar(c, 'pc') || _operationAssureeParHelixCar(c, 'liv')) {") &&
    source.includes("prestations.push('Convoyage automobile');"));
}

console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
if (fail) process.exit(1);
