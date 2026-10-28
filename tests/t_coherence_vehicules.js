// Régression : copies repliées, saisie et effacement ne doivent jamais
// désynchroniser les rubriques, la coche, le bouton et le compteur.
const L = require('./lib.js');
const { dansNJours, fichier } = require('./env.js');
const fs = require('fs');

(async () => {
  const browser = await L.launch();
  try {
    for (const stockage of [false, true]) {
      const page = await L.newPage(browser);
      page.on('dialog', d => d.accept());
      await L.fillStep1(page, 'particulier');
      await L.chooseService(page, stockage ? 'stockage' : 'convoyage');
      await page.evaluate(({ stockage, dates }) => {
        window.qaPoser = (i, suffixe, valeur) => {
          const el = document.getElementById('veh-' + i + '-' + suffixe);
          if (!el) throw new Error('Champ absent : ' + suffixe);
          el.value = valeur;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        window.qaChoix = (i, nom, valeur) => {
          const el = document.querySelector('input[name="veh-' + i + '-' + nom + '"][value="' + valeur + '"]');
          if (!el) throw new Error('Choix absent : ' + nom);
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        if (stockage) {
          document.getElementById('stock-debut').value = dates[0];
          document.getElementById('stock-fin').value = dates[1];
          document.querySelector('[name="stock-acheminement"][value="depot_client"]').checked = true;
          document.querySelector('[name="stock-sortie"][value="helixcar"]').checked = true;
          onAcheminementStockage(); onSortieStockage();
        }
        document.getElementById('nb-vehicules').value = '3';
        onNbVehiculesChange();
        window.qaRemplir = i => {
          const type = document.getElementById('veh-' + i + '-type').options[1].value;
          qaPoser(i, 'type', type);
          qaPoser(i, 'marque', 'Modèle ' + i);
          qaPoser(i, 'immat', 'AA-12' + i + '-BB');
          if (stockage) qaChoix(i, 'liv-active', 'oui');
          qaChoix(i, 'restit-active', 'non');
          for (const p of (stockage ? ['liv'] : ['pc', 'liv'])) {
            qaPoser(i, p + '-rue', '10 rue Test ' + i);
            qaPoser(i, p + '-cp', '75001'); qaPoser(i, p + '-ville', 'Paris');
            qaPoser(i, p + '-contact', 'Contact ' + i); qaPoser(i, p + '-tel', '+33601020304');
            qaPoser(i, p + '-date', p === 'pc' ? dates[0] : dates[2]);
            qaPoser(i, p + '-heure', '13:45');
          }
          qaChoix(i, 'mode', 'standard');
          _majProgressionVehicules();
        };
        qaRemplir(0); qaRemplir(1); qaRemplir(2);
      }, { stockage, dates: [dansNJours(3), dansNJours(5), dansNJours(7)] });

      const prefix = stockage ? 'Stockage' : 'Convoyage';
      async function verifier(label, invalides = []) {
        const erreurs = await page.evaluate(invalides => {
          const erreurs = [];
          for (let i = 0; i < 3; i++) {
            const attendu = !invalides.includes(i), racine = document.getElementById('veh-contenu-' + i);
            if (_vehiculeComplet(i) !== attendu) erreurs.push(i + ': complétude ' + JSON.stringify({
              requis: _champsRequisVehicule(i).map(s => [s, (document.getElementById('veh-' + i + '-' + s) || {}).value]),
              horaires: _prefixesHoraireRequis(i).map(p => _verifierHoraire(i, p)),
              chrono: _chronologieVehiculeOk(i),
              rouges: [...racine.querySelectorAll('.incomplet')].map(b => b.id)
            }));
            if (!!document.querySelector('#veh-resume-' + i + ' .veh-etat.ok') !== attendu) erreurs.push(i + ': coche');
            if (racine.querySelector('.veh-btn-valider').disabled === attendu) erreurs.push(i + ': bouton');
            const blocs = [...racine.querySelectorAll('.veh-sous-accordeon')].filter(b => b.style.display !== 'none');
            if (blocs.every(b => b.classList.contains('termine')) !== attendu) erreurs.push(i + ': numéros');
            if (blocs.some(b => b.classList.contains('termine') && b.classList.contains('incomplet'))) erreurs.push(i + ': deux couleurs');
            if (attendu && racine.querySelector('.field-error,.hc-group-error')) erreurs.push(i + ': erreur résiduelle');
          }
          if (!document.getElementById('veh-progression').textContent.startsWith((3 - invalides.length) + ' / 3')) erreurs.push('compteur');
          return erreurs;
        }, invalides);
        L.check(prefix + ' : ' + label, erreurs.length === 0, erreurs.join(', '));
      }
      await verifier('trois fiches saisies indépendamment');
      for (const duplication of [false, true]) {
        if (duplication) await page.evaluate(() => { _hcCopierVehiculeVers(0, 1); _hcCopierVehiculeVers(0, 2); _majProgressionVehicules(); });
        for (const ouvert of [false, true]) {
          await page.evaluate(ouvert => {
            document.querySelectorAll('.veh-accordeon,.veh-sous-accordeon').forEach(b => b.classList.toggle('ouvert', ouvert));
            _majProgressionVehicules();
          }, ouvert);
          await verifier('copies=' + duplication + ', ouvert=' + ouvert);
          for (const i of [2, 0, 1]) {
            for (const champ of ['liv-contact', 'liv-rue', 'type', 'liv-heure']) {
              const avant = await page.evaluate(({ i, champ }) => {
                const valeur = document.getElementById('veh-' + i + '-' + champ).value;
                qaPoser(i, champ, ''); return valeur;
              }, { i, champ });
              await verifier('effacement ' + i + '/' + champ, champ === 'liv-contact' ? [] : [i]);
              await page.evaluate(({ i, champ, avant }) => qaPoser(i, champ, avant), { i, champ, avant });
              await verifier('ressaisie ' + i + '/' + champ);
            }
          }
        }
      }
      await page.evaluate(() => {
        const r = document.querySelector('[name="veh-1-mode"]:checked');
        r.checked = false; r.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await verifier('mode manquant dans une copie fermée', [1]);
      await page.evaluate(() => qaChoix(1, 'mode', 'plateau'));
      await verifier('mode rétabli');
      await page.evaluate(() => {
        qaChoix(2, 'liv-htype', 'creneau');
        qaPoser(2, 'liv-cdeb', '15:00'); qaPoser(2, 'liv-cfin', '14:00');
      });
      await verifier('créneau inversé', [2]);
      await page.evaluate(() => qaPoser(2, 'liv-cfin', '16:00'));
      await verifier('créneau corrigé');
      if (stockage) {
        await page.evaluate(() => {
          const r = document.querySelector('[name="veh-1-restit-active"]:checked'); r.checked = false;
          document.getElementById('veh-acc-1').classList.add('ouvert');
          document.getElementById('veh-1-sous-livraison').classList.add('ouvert');
          _hcOkSousVeh(1, 'livraison');
        });
        await verifier('OK sans réponse de restitution', [1]);
        await page.evaluate(() => qaChoix(1, 'restit-active', 'non'));
        await verifier('réponse corrigée sans contour rouge résiduel');
        await page.evaluate(() => qaChoix(1, 'restit-active', 'oui'));
        await verifier('restitution demandée mais vide', [1]);
        await page.evaluate(date => {
          qaPoser(1, 'restit-rue', '20 rue Retour'); qaPoser(1, 'restit-cp', '69001'); qaPoser(1, 'restit-ville', 'Lyon');
          qaPoser(1, 'restit-date', date); qaPoser(1, 'restit-heure', '18:00');
          qaPoser(1, 'restit-vtype', document.getElementById('veh-1-restit-vtype').options[1].value);
          qaPoser(1, 'restit-marque', 'Renault'); qaPoser(1, 'restit-consignes', 'Portail nord');
          _hcCopierVehiculeVers(1, 0); _hcCopierVehiculeVers(1, 2); _majProgressionVehicules();
        }, dansNJours(8));
        await verifier('restitution complète dupliquée, sans plaque ni VIN');
        for (const message of ['', 'Nouvelle consigne']) {
          await page.evaluate(message => qaPoser(0, 'restit-consignes', message), message);
          await verifier('consigne de restitution effacée puis remise');
          L.check('La modification de la copie ne change pas la consigne source',
            await page.evaluate(() => document.getElementById('veh-1-restit-consignes').value === 'Portail nord'));
        }
        await page.evaluate(() => { qaPoser(0, 'restit-marque', ''); _hcOkSousVeh(0, 'livraison'); });
        await verifier('OK sur une restitution incomplète', [0]);
        await page.evaluate(() => qaPoser(0, 'restit-marque', 'Renault'));
        await verifier('correction après erreur explicite');
        await page.evaluate(() => { qaChoix(1, 'restit-active', 'non'); qaChoix(2, 'liv-active', 'non'); });
        await verifier('récupération sans heure', [2]);
        await page.evaluate(() => qaPoser(2, 'recup-heure', '15:00'));
        await verifier('récupération sans mode caché obligatoire');
      }
      await page.evaluate(() => { _hcEffacerSousVeh(1, 'identite'); });
      await verifier('effacement de la rubrique identité', [1]);
      await page.evaluate(() => qaRemplir(1));
      await verifier('fiche remplie après effacement');
      await page.evaluate(() => effacerVehicule(1));
      await verifier('effacement complet du véhicule', [1]);
      await page.evaluate(() => { _hcCopierVehiculeVers(0, 1); _majProgressionVehicules(); });
      await verifier('copie vers la fiche effacée');
      await page.evaluate(() => rendreFichesVehicules());
      await verifier('reconstruction des fiches depuis les données mémorisées');
      await page.evaluate(() => { document.getElementById('nb-vehicules').value = '1'; onNbVehiculesChange(); });
      for (const vide of [false, true, false]) {
        const mono = await page.evaluate(vide => {
          const e = document.getElementById('veh-0-type');
          qaPoser(0, 'type', vide ? '' : e.options[1].value);
          return { coche: !!document.querySelector('#veh-resume-0 .veh-etat.ok'),
            numero: document.getElementById('veh-0-sous-identite').classList.contains('termine'),
            compteur: document.getElementById('veh-progression').textContent };
        }, vide);
        L.check(prefix + ' : véhicule unique, type vide=' + vide,
          mono.coche === !vide && mono.numero === !vide && mono.compteur.startsWith((vide ? '0' : '1') + ' / 1'), JSON.stringify(mono));
      }
      L.check(prefix + ' : absence d’erreur JavaScript', page.jsErrors.length === 0, page.jsErrors.join(' | '));
      await page.close();
    }
    // Premier affichage avant que le bas du document soit reçu : le
    // logo doit déjà être dimensionné, et l'attente claire, sans avatar H.
    const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
    const page = await browser.newPage();
    await page.setContent(dash.slice(0, dash.indexOf('<script>', dash.indexOf('id="login-screen"')))
      .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));
    const debut = await page.evaluate(() => ({
      fond: getComputedStyle(document.getElementById('login-screen')).backgroundColor,
      largeur: getComputedStyle(document.querySelector('.login-logo img')).width
    }));
    L.check('Premier affichage : attente claire et logo dimensionné', debut.fond === 'rgb(248, 249, 250)' && debut.largeur === '220px', JSON.stringify(debut));
    L.check('Aucun H provisoire dans l’avatar', !dash.includes('id="sb-avatar">H<'));
    await page.close();
  } finally { await browser.close(); }
  process.exit(L.results() ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
