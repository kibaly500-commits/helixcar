const L = require('./lib');
(async () => {
  const browser = await L.launch();
  try {
    for (const width of [390, 1280]) {
      const p = await L.newPage(browser);
      await p.setViewportSize({width, height: 1000});
      await L.fillStep1(p, 'particulier');
      await L.chooseService(p, 'convoyage');
      const result = await p.evaluate(() => {
        const el = id => document.getElementById(id);
        const val = (id, value) => el(id).value = value;
        const radio = (name, value) => document.querySelector('input[name="'+name+'"][value="'+value+'"]').checked = true;
        const checks = {};
        window.confirm = () => true;
        val('nb-vehicules', '2'); rendreFichesVehicules();
        val('veh-0-marque', 'À effacer'); val('veh-1-marque', 'À conserver');
        val('veh-0-pc-date', '2027-10-12'); val('veh-0-liv-date', '2027-10-26');
        val('veh-1-liv-date', '2027-10-28');
        _memoriserVehicules();
        _hcOuvrirCalendrier(el('veh-0-liv-date'));
        el('hc-cal-effacer').click();
        checks['calendar clears input'] = el('veh-0-liv-date').value === '';
        _hcFermerCalendrier(); rendreFichesVehicules();
        checks['calendar clear survives render'] = el('veh-0-liv-date').value === '';
        checks['other vehicle preserved'] = el('veh-1-liv-date').value === '2027-10-28';
        radio('veh-0-restit-active', 'oui'); basculerRestitVehicule(0);
        val('veh-0-restit-rue', 'Ancienne adresse');
        val('veh-0-restit-consignes', 'Ancienne consigne');
        val('veh-0-restit-destination', 'depart'); _hcRetourDestination(0, true);
        _memoriserVehicules();
        effacerVehicule(0);
        checks['notes erased'] = el('veh-0-restit-consignes').value === '';
        checks['manual address cache erased'] = el('veh-0-restit-destination').dataset.manuelle === '["","",""]';
        rendreFichesVehicules();
        checks['full erase survives render'] = ['marque','pc-date','liv-date','restit-rue','restit-consignes'].every(k => el('veh-0-'+k).value === '');
        checks['other identity preserved'] = el('veh-1-marque').value === 'À conserver';
        _sauvegarderBrouillonClient();
        const saved = JSON.parse(localStorage.getItem(_cleBrouillonClient()));
        checks['draft memory erased'] = !saved.memoireVehicules[0].marque_modele && !saved.memoireVehicules[0].date_livraison && !saved.memoireVehicules[0].restit_contraintes;
        _memoireVehicules = {};
        _restaurerBrouillonClientSiPresent();
        checks['draft restored without deleted values'] = ['marque','pc-date','liv-date','restit-rue','restit-consignes'].every(k => el('veh-0-'+k).value === '');
        checks['draft restored other vehicle'] = el('veh-1-marque').value === 'À conserver' && el('veh-1-liv-date').value === '2027-10-28';
        radio('type-service', 'stockage'); radio('stock-acheminement', 'helixcar'); radio('stock-sortie', 'helixcar');
        val('stock-debut','2027-10-12'); val('stock-fin','2027-10-26'); rendreFichesVehicules();
        radio('veh-0-liv-active','oui'); val('veh-0-liv-date','2027-10-26');
        _memoriserVehicules(); effacerVehicule(0);
        checks['delivery branch hidden after full erase'] = el('veh-liv-spec-0').style.display === 'none' && el('veh-restit-question-0').style.display === 'none';
        const period = _hcPeriodeVehicule(0);
        checks['no phantom delivery from storage end'] = !period.finLiv;
        _hcOuvrirCalendrier(el('veh-0-liv-date'));
        checks['no delivery marker on 26'] = !document.querySelector('#hc-cal-grille [data-jour="26"]').className.includes('hc-cal-jour--fin');
        checks['storage reference labelled honestly'] = el('hc-cal-legende').textContent.includes('Début du stockage') && !el('hc-cal-legende').textContent.includes('Livraison');
        _hcFermerCalendrier();
        _hcOuvrirCalendrier(el('stock-debut')); el('hc-cal-effacer').click();
        checks['storage erase clears inherited pickups'] = !el('stock-debut').value && !el('stock-fin').value && !el('veh-0-pc-date').value && !el('veh-1-pc-date').value;
        _hcFermerCalendrier(); rendreFichesVehicules();
        checks['inherited pickup stays cleared after render'] = !el('veh-0-pc-date').value && !el('veh-1-pc-date').value;
        return checks;
      });
      for (const [name, passed] of Object.entries(result)) L.check(width+' '+name, passed);
      L.check(width+' no JS exception', !p.jsErrors.some(e=>e.startsWith('PAGEERROR')), p.jsErrors.join('\n'));
      await p.close();
    }
  } finally { await browser.close(); }
  process.exitCode = L.results() ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
