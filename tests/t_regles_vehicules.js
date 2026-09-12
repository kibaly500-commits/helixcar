// Parcours navigateur : titres, duplication sans plaque et nouvelle fiche
// complète dès que l'activité choisie change.
const L = require('./lib.js');

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);
  try {
    await L.fillStep1(page, 'particulier');
    await L.chooseService(page, 'convoyage');
    await page.evaluate(() => {
      const nombre = document.getElementById('nb-vehicules');
      nombre.value = '2';
      onNbVehiculesChange();

      function poser(id, valeur) {
        const el = document.getElementById(id);
        if (el) el.value = valeur;
      }
      poser('veh-0-marque', 'Renault Clio V');
      poser('veh-0-immat', 'AA-123-BB');
      poser('veh-0-vin', 'VIN-SOURCE-123');
      poser('veh-0-pc-rue', '10 rue du Départ');
      poser('veh-0-pc-cp', '75001');
      poser('veh-0-pc-ville', 'Paris');
      poser('veh-0-pc-contact', 'Mme Départ');
      poser('veh-0-pc-tel', '+33601020304');
      poser('veh-0-pc-date', '2030-01-10');
      poser('veh-0-pc-heure', '08:45');
      poser('veh-0-recup-heure', '07:30');
      poser('veh-0-restit-marque', 'Peugeot 208');
      poser('veh-0-restit-immat', 'CC-456-DD');
      poser('veh-0-restit-vin', 'VIN-RESTIT-456');
      poser('veh-0-restit-consignes', 'Accès portail nord');

      const plateau = document.querySelector('input[name="veh-0-mode"][value="plateau"]');
      if (plateau) plateau.checked = true;
      _hcCopierVehiculeVers(0, 1);
    });

    const copie = await page.evaluate(() => {
      const val = id => (document.getElementById(id) || {}).value || '';
      return {
        marque: val('veh-1-marque'), immat: val('veh-1-immat'), vin: val('veh-1-vin'),
        rue: val('veh-1-pc-rue'), contact: val('veh-1-pc-contact'), tel: val('veh-1-pc-tel'),
        date: val('veh-1-pc-date'), heure: val('veh-1-pc-heure'), recuperation: val('veh-1-recup-heure'),
        restitMarque: val('veh-1-restit-marque'), restitImmat: val('veh-1-restit-immat'),
        restitVin: val('veh-1-restit-vin'), consignes: val('veh-1-restit-consignes'),
        mode: (document.querySelector('input[name="veh-1-mode"]:checked') || {}).value || ''
      };
    });
    L.check('RV1 : la duplication reprend identité, trajet, contacts, horaires et consignes',
      copie.marque === 'Renault Clio V' && copie.vin === 'VIN-SOURCE-123'
      && copie.rue === '10 rue du Départ' && copie.contact === 'Mme Départ'
      && copie.tel === '+33601020304' && copie.date === '2030-01-10'
      && copie.heure === '08:45' && copie.recuperation === '07:30'
      && copie.restitMarque === 'Peugeot 208' && copie.restitVin === 'VIN-RESTIT-456'
      && copie.consignes === 'Accès portail nord' && copie.mode === 'plateau', JSON.stringify(copie));
    L.check('RV2 : aucune plaque d’immatriculation n’est dupliquée',
      copie.immat === '' && copie.restitImmat === '', JSON.stringify(copie));

    const entete = await page.evaluate(() => {
      const vraieCompletude = _vehiculeComplet;
      _vehiculeComplet = function () { return true; };
      _majBarreVehicule(0);
      const texte = (document.getElementById('veh-resume-0') || {}).textContent || '';
      _vehiculeComplet = vraieCompletude;
      return texte;
    });
    L.check('RV3 : l’en-tête affiche le rang, le modèle et la plaque',
      /VÉHICULE 1 SUR 2/.test(entete) && /Renault Clio V/.test(entete) && /AA-123-BB/.test(entete), entete);

    const mono = await page.evaluate(() => {
      const nombre = document.getElementById('nb-vehicules');
      nombre.value = '1';
      onNbVehiculesChange();
      const vraieCompletude = _vehiculeComplet;
      _vehiculeComplet = function () { return true; };
      _majBarreVehicule(0);
      const visible = !!document.querySelector('#veh-resume-0 .veh-btn-dupliquer');
      _vehiculeComplet = vraieCompletude;
      return visible;
    });
    L.check('RV4 : aucun bouton Dupliquer avec un seul véhicule', mono === false);

    await page.evaluate(() => {
      const nombre = document.getElementById('nb-vehicules');
      nombre.value = '2';
      onNbVehiculesChange();
      document.getElementById('veh-0-marque').value = 'Donnée convoyage';
      document.getElementById('veh-0-immat').value = 'EE-789-FF';
      document.getElementById('stock-debut').value = '2030-02-01';
      document.getElementById('stock-fin').value = '2030-02-08';
    });
    await page.click('input[name="type-service"][value="stockage"]');
    const apresStockage = await page.evaluate(() => ({
      marque: (document.getElementById('veh-0-marque') || {}).value || '',
      immat: (document.getElementById('veh-0-immat') || {}).value || '',
      debut: (document.getElementById('stock-debut') || {}).value || '',
      fin: (document.getElementById('stock-fin') || {}).value || '',
      memoire: Object.keys(_memoireVehicules).length
    }));
    L.check('RV5 : changer d’activité efface véhicules et dates',
      !apresStockage.marque && !apresStockage.immat && !apresStockage.debut
      && !apresStockage.fin && apresStockage.memoire === 0, JSON.stringify(apresStockage));

    await page.evaluate(() => { document.getElementById('veh-0-marque').value = 'Donnée stockage'; });
    await page.click('input[name="type-service"][value="stockage"]');
    L.check('RV6 : recliquer sur la même activité conserve la fiche',
      await page.evaluate(() => document.getElementById('veh-0-marque').value === 'Donnée stockage'));
    await page.click('input[name="type-service"][value="convoyage"]');
    L.check('RV7 : le changement inverse crée lui aussi une fiche vierge',
      await page.evaluate(() => document.getElementById('veh-0-marque').value === ''));
    L.check('RV8 : aucune erreur JavaScript navigateur', page.jsErrors.length === 0, page.jsErrors.join(' | '));
  } finally {
    await browser.close();
  }
  process.exit(L.results() ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
