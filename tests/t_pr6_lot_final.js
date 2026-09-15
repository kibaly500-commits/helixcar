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

// Toutes les destinations restent accessibles, avec priorité aux fiches
// vides. Vérifier le résultat, sans imposer le texte de l'ancienne boucle.
const selection = index.match(/function _hcListeVehiculesDisponibles\(source\) \{[\s\S]*?\n\}/);
function destinations(remplis) {
  return require('vm').runInNewContext(selection[0] + '\n_hcListeVehiculesDisponibles(0)', {
    _nbVehicules: () => 5,
    _hcVehiculeRenseigne: i => remplis.includes(i)
  });
}
check('Toutes les autres fiches restent duplicables, les vides en premier',
  !!selection && JSON.stringify(destinations([0, 1, 2])) === '[3,4,1,2]'
  && JSON.stringify(destinations([0, 1, 2, 3, 4])) === '[1,2,3,4]');
check('Les données duplicables remplacent la cible sans copier ses plaques',
  index.includes("['type', 'marque', 'vin',") &&
  index.includes('Les plaques restent propres à chaque véhicule et ne sont jamais copiées.'));
check('L’ancien message de blocage de duplication a disparu',
  !index.includes("Aucune fiche véhicule vierge n'est disponible"));
check('La duplication ne montre aucun avertissement ni message après copie',
  !index.includes('hc-dupliquer-avertissement') &&
  !index.includes('Confirmer la duplication ?') &&
  !index.includes('duplique-msg') &&
  !index.includes("Informations reprises d'un autre véhicule"));
check('La duplication propose uniquement un nombre puis OK',
  index.includes('id="hc-dupliquer-go"') &&
  index.includes('>OK</button>') &&
  !index.includes('hc-dupliquer-simple'));

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


// Lot suivant — validation stricte des véhicules et absence de résidus visuels.
check('Le résidu littéral antislash-n est supprimé à la source',
  !index.includes('</script>\\n'));
check('La date de prise en charge verrouillée ne montre plus de curseur interdit',
  index.includes('cursor: default !important; pointer-events: none !important;') &&
  !index.includes('#modal-client input.hc-date-verrouillee {\n    background: #eef0f2 !important; color: #66707a !important;\n    cursor: not-allowed'));
check('Le mode de transport ne peut plus être présélectionné artificiellement',
  index.includes("v.mode_transport==='standard'?'checked':''") &&
  !index.includes("v.mode_transport==='plateau'?'':'checked'"));
check('Seul le type bloque l’identité au stade du devis, le transport reste requis',
  index.includes("var req=['type'];") &&
  !index.includes("['immat', 'vin'].forEach") &&
  !index.includes("_checkRequiredText('client-marque')") &&
  index.includes("querySelector('input[name=\"veh-' + i + '-mode\"]:checked')"));
check('Valider ce véhicule dépend des données réelles, pas des clics OK',
  index.includes("var completVehicule = donneesVehiculeCompletes(i);") &&
  index.includes("bouton.disabled = !completVehicule;") &&
  index.includes("bouton.setAttribute('aria-disabled', completVehicule ? 'false' : 'true');") &&
  !index.includes("toutesEtapesConfirmees"));
check('Chaque étape reflète uniquement sa complétude réelle',
  index.includes("var complet = etapeComplete(i, bloc);") &&
  index.includes("bloc.classList.toggle('termine', complet);") &&
  index.includes("bloc.classList.toggle('incomplet', !complet);") &&
  !index.includes("toutesEtapesConfirmees"));
check('Une modification recalcule uniquement le véhicule concerné',
  index.includes("var i = parseInt(contenu.id.replace('veh-contenu-', ''), 10);") &&
  index.includes("majEtapes(i);") &&
  index.includes("_majBarreVehicule(i);"));

// Après envoi, l'ancien formulaire est détruit et les demandes réelles sont rerendues.
check('Une demande client envoyée ne peut pas se rouvrir ni être renvoyée',
  dashboard.includes("cadre.setAttribute('src', 'about:blank');") &&
  dashboard.includes("cadre.removeAttribute('src');") &&
  dashboard.includes("loadDemandesClient()"));
check('Mes demandes propose un aperçu compact en lecture seule',
  dashboard.includes("actionHtml('ouvrirApercuDemandeClient', [d.id])") &&
  dashboard.includes("window.ouvrirApercuDemandeClient=async function(id)") &&
  dashboard.includes("HC_ACTIONS.ouvrirApercuDemandeClient") &&
  dashboard.includes('Télécharger le PDF') &&
  dashboard.includes("documentPdf.save('Recapitulatif_HelixCar_") &&
  !dashboard.includes('Imprimer / enregistrer en PDF'));

check('Le récapitulatif réutilise la maquette PDF, le logo et une couleur distincte',
  dashboard.includes('function _construirePdfDevis(c, d, options)') &&
  dashboard.includes('var estRecapitulatif = options.recapitulatif === true;') &&
  dashboard.includes('var COULEUR_ACCENT = estRecapitulatif ? [42, 101, 110] : ROUGE;') &&
  dashboard.includes('{recapitulatif:true}') &&
  dashboard.includes("doc.addImage(HELIXCAR_LOGO_PDF"));
check('Le récapitulatif masque le titre de devis, le tarif et les mentions commerciales',
  dashboard.includes("if (estRecapitulatif) {") &&
  dashboard.includes("T('RÉCAPITULATIF DE LA DEMANDE'") &&
  dashboard.includes("if (!estRecapitulatif && HELIXCAR_MENTION_TVA)") &&
  dashboard.includes("if (!estRecapitulatif) {\n  var yFinPrestations = y;"));

check('Le bandeau de brouillon propose explicitement reprendre ou recommencer',
  index.includes("titre.textContent = 'Demande en cours';") &&
  index.includes("btnReprendre.textContent = 'Reprendre';") &&
  index.includes("btnRecommencer.textContent = 'Supprimer et recommencer';"));
check('La règle de fidélité en euros est retirée mais le message sans points reste',
  !dashboard.includes('1 € TTC entier payé') &&
  dashboard.includes("Vous n\\'avez pas encore de points. Ils vous sont attribués lorsqu\\'une ") &&
  dashboard.includes('prestation est terminée et payée.</div>'));
check('Le VIN reste transmis sans bloquer la demande de devis',
  index.includes('vin:                    vin_val || null') &&
  !index.includes("['immat', 'vin'].forEach"));

// Identité pro et compteurs : uniquement les vraies données.
check('La société est affichée avant le nom pour un compte professionnel',
  dashboard.includes("if (c.type_client === 'pro' && societe) return societe + (personne ? ' / ' + personne : '');") &&
  dashboard.includes("roleLabel: premiere.type_client === 'pro' ? 'Client professionnel' : 'Client'"));
check('Le compteur mensuel compte les acceptations réelles avec deux bornes',
  dashboard.includes("devis?select=prix,statut,date_acceptation&statut=eq.accepte") &&
  dashboard.includes("'&date_acceptation=gte.'") &&
  dashboard.includes("'&date_acceptation=lt.'") &&
  dashboard.includes("_ecrireStat('stat-ca', rows.length.toLocaleString('fr-FR'));"));
check('Aucun compteur d’administration ne démarre sur une valeur fictive',
  !/class="stat-value"[^>]*>\s*\d+(?:\s*€)?\s*</.test(dashboard) &&
  !dashboard.includes('3 en attente de validation') &&
  !dashboard.includes('id="fc-conv-total">0 €'));

console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
if (fail) process.exit(1);
