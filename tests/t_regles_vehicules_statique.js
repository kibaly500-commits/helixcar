// Garde rapide, exécutable même sans navigateur installé.
const L = require('./lib.js');
const fs = require('fs');

(() => {
  const index = fs.readFileSync(L.fichier('index.html'), 'utf8');
  const debutCopie = index.indexOf('function _hcCopierVehiculeVers(');
  const finCopie = index.indexOf('var _hcDupliquerOverlay', debutCopie);
  const copie = index.slice(debutCopie, finCopie);
  const debutBarre = index.indexOf('function _majBarreVehicule(');
  const finBarre = index.indexOf('function _compterVehiculesComplets(', debutBarre);
  const barre = index.slice(debutBarre, finBarre);

  L.check('RVS1 : chaque choix explicite d’activité indique sa valeur au gestionnaire',
    (index.match(/name="type-service"[^>]+onclick="onChoixService\(this\.value\)"/g) || []).length === 5);
  L.check('RVS2 : un changement d’activité purge mémoires, fiches et dates',
    /function _reinitialiserVehiculesPourNouveauService\(\)[\s\S]{0,1200}_memoireVehicules = \{\}[\s\S]{0,1200}conteneur\.innerHTML = ''[\s\S]{0,1200}'stock-debut', 'stock-fin'/.test(index)
      && /t !== _clientDernierServiceVehicules[\s\S]{0,300}_reinitialiserVehiculesPourNouveauService\(\)/.test(index));
  L.check('RVS3 : la barre véhicule inclut l’immatriculation',
    /veh-' \+ i \+ '-immat/.test(barre) && /extras\.push\(_attr\(immatriculation\)\)/.test(barre));
  L.check('RVS4 : Dupliquer est masqué en mono-véhicule',
    /if \(n > 1 && i === 0 && complet\)/.test(barre));
  L.check('RVS5 : la copie exclut les deux plaques mais garde le reste de l’identité',
    /\['type', 'marque', 'vin',[\s\S]{0,100}'restit-vtype', 'restit-marque', 'restit-vin'\]/.test(copie)
      && !/\['type', 'marque', 'immat'/.test(copie)
      && !/'restit-marque', 'restit-immat'/.test(copie));
  L.check('RVS6 : la copie reprend contacts, téléphones et heure de récupération',
    /\['rue', 'cp', 'ville', 'contact', 'tel', 'date'\]/.test(copie)
      && /dstRecuperation\.value = srcRecuperation\.value/.test(copie));

  process.exit(L.results() ? 1 : 0);
})();
