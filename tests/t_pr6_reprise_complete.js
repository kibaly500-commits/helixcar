// Non-régression — reprise complète PR6 du 13/09/2026.
const fs = require('fs');
const path = require('path');
const RACINE = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const dashboard = fs.readFileSync(path.join(RACINE, 'dashboard.html'), 'utf8');
const migration = fs.readFileSync(path.join(RACINE, 'migrations/132_restitution_vin_immatriculation_mission.sql'), 'utf8');

let pass = 0, fail = 0;
function check(libelle, condition) {
  if (condition) { console.log('PASS - ' + libelle); pass++; }
  else { console.log('FAIL - ' + libelle); fail++; }
}

// Véhicules et restitution.
check('Les libellés de restitution ne portent plus la parenthèse avant mission',
  index.includes("id=\"client-restit-immat\"") &&
  index.includes("id=\"veh-'+i+'-restit-immat\"") &&
  !index.includes("(attendue avant mission)") && !index.includes("(attendu avant mission)") &&
  !index.includes("Plaque *</label>"));
check('Livraison Non masque aussi le mode de transport',
  index.includes("var blocMode = document.getElementById('veh-' + i + '-sous-mode');") &&
  index.includes("blocMode.style.display = actif === false ? 'none' : '';"));
check('Livraison Non vide les choix de transport cachés',
  index.includes("blocMode.querySelectorAll('input[name=\"veh-' + i + '-mode\"]')") &&
  index.includes("radio.checked = false;"));
check('Le mode sauvegardé est vide lorsque la livraison est refusée',
  index.includes("mode_transport:livActive===false?'':"));
check('Le récapitulatif omet le mode quand la livraison est refusée',
  index.includes("v.livraison_apres_stockage !== false && v.mode_transport"));
check('Le bloc Mode reste dans le DOM pour le passage Non vers Oui',
  index.includes("var blocModeHtml=_hcSousVeh(i,'mode'") &&
  index.includes("blocModeHtml=blocModeHtml.replace(") &&
  index.includes('style="display:none"'));

// États et protection multi-véhicules.
check('La complétude véhicule est dérivée des données',
  index.includes("function donneesVehiculeCompletes(i)") &&
  index.includes("window._vehiculeComplet = donneesVehiculeCompletes;"));
check('Aucun clic OK mémorisé ne pilote les couleurs',
  !index.slice(index.lastIndexOf("function donneesVehiculeCompletes")).includes("hcDejaValide") &&
  !index.includes("toutesEtapesConfirmees"));
check('Une étape applicable utilise son état réel',
  index.includes("var complet = etapeComplete(i, bloc);") &&
  index.includes("bloc.classList.toggle('termine', complet);"));
check('Les changements ciblent uniquement la fiche courante',
  index.includes("var contenu = cible && cible.closest && cible.closest('[id^=\"veh-contenu-\"]');") &&
  index.includes("_majBarreVehicule(i);"));
check('Le compteur est calculé depuis toutes les fiches réelles',
  index.includes("for (var k = 0; k < n; k++) if (_vehiculeComplet(k)) ok++;") &&
  index.includes("complets + ' / ' + n + ' COMPLÉTÉS'"));
check('Le message singulier/pluriel dépend du nombre réel',
  index.includes("nbIncomplets > 1") &&
  index.includes("nbIncomplets + ' véhicules sont incomplets. Complétez-les avant de continuer.'") &&
  index.includes("'Le véhicule ' + (i + 1) + ' est incomplet. Complétez-le avant de continuer.'"));

// Mission : informations attendues sans blocage du devis.
check('La migration suit chaque plaque de restitution',
  migration.includes("_restit_immatriculation") &&
  migration.includes("Immatriculation du véhicule à restituer"));
check('La migration suit chaque VIN de restitution',
  migration.includes("_restit_vin") &&
  migration.includes("VIN du véhicule à restituer"));
check('La fonction reste accessible au contrôle serveur de mission',
  migration.includes("current_setting('hc.creation_mission_serveur', true)"));
check('Les absences deviennent des informations attendues',
  migration.includes("case when (r ->> 'fournie')::boolean then 'fournie' else 'attendue' end"));

// Récapitulatifs, formulaire pro et dashboard.
check('Le récapitulatif porte son titre dédié en haut à droite',
  dashboard.includes("RÉCAPITULATIF DE LA DEMANDE"));
check('Le récapitulatif ne réintroduit aucun tarif',
  dashboard.includes("if (!estRecapitulatif) {") &&
  dashboard.includes("if (!estRecapitulatif && HELIXCAR_MENTIONS_LEGALES"));
check('La prestation Livraison suit les données réellement enregistrées',
  dashboard.includes("prestations.push('Livraison');"));
check('Les sous-titres professionnels sont conformes',
  index.includes("Mécanique et autres spécialités") &&
  index.includes("Accueil en concession et autres spécialités"));
check('Le dashboard réutilise le vrai logo HelixCar',
  dashboard.includes('<img src="logo-helixcar.png" alt="HelixCar — Services automobiles">'));
check('Les pictogrammes du dashboard utilisent une gamme SVG homogène',
  dashboard.includes("className='hc-ui-icon'") &&
  dashboard.includes('viewBox="0 0 24 24"') &&
  dashboard.includes("new MutationObserver(function(ms)"));
check('Le bandeau brouillon reste disponible dans le formulaire intégré',
  index.includes("titre.textContent = 'Demande en cours'") &&
  index.includes("btnReprendre.textContent = 'Reprendre'") &&
  index.includes("btnRecommencer.textContent = 'Supprimer et recommencer'"));

console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
if (fail) process.exit(1);
