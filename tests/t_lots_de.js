// ══════════════════════════════════════════════════════════════════
// LOTS D ET E — LOGIQUE MÉTIER DES FORMULAIRES, DESIGN ET VALIDATIONS
// ══════════════════════════════════════════════════════════════════
// Chaque section reproduit d'abord ce qui était constaté, puis vérifie
// la règle demandée. Aucune donnée réelle, aucun réseau : tests/env.js
// coupe toute requête sortante.
const L = require('./lib.js');
const { fichier, urlFichier } = L;
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 280) + ']' : '')); fail++; echecs.push(l); }
}

async function scenarioStockage(page, ach, sortie, n) {
  await page.evaluate((a) => {
    const el = document.getElementById('nb-vehicules');
    if (el) { el.value = String(a.n); el.dispatchEvent(new Event('change', { bubbles: true })); }
    const r1 = document.querySelector('input[name="stock-acheminement"][value="' + a.ach + '"]');
    if (r1) { r1.checked = true; r1.dispatchEvent(new Event('change', { bubbles: true })); }
    const r2 = document.querySelector('input[name="stock-sortie"][value="' + a.sortie + '"]');
    if (r2) { r2.checked = true; r2.dispatchEvent(new Event('change', { bubbles: true })); }
    if (typeof onAcheminementStockage === 'function') onAcheminementStockage();
    if (typeof onSortieStockage === 'function') onSortieStockage();
    if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
  }, { ach, sortie, n });
  await page.waitForTimeout(250);
}

function rubriquesVisibles(page, n) {
  return page.evaluate((n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = document.getElementById('veh-contenu-' + i);
      out.push(c ? Array.prototype.slice
        .call(c.querySelectorAll('.veh-sous-accordeon .veh-sous-titre'))
        .map(t => (t.textContent || '').trim()) : null);
    }
    return out;
  }, n);
}

(async () => {
  const browser = await L.lancerNavigateur();
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');

  // ══ D1. LA LIVRAISON QUAND HELIXCAR N'INTERVIENT PAS ══
  {
    const page = await L.newPage(browser);
    await L.fillStep1(page, 'particulier');
    await L.chooseService(page, 'stockage');
    await page.waitForTimeout(150);

    // Le client dépose ET récupère lui-même : HelixCar ne touche jamais
    // le véhicule.
    await scenarioStockage(page, 'depot_client', 'recuperation_client', 3);
    let r = await rubriquesVisibles(page, 3);
    check('D1-1 : plus aucune rubrique « Livraison » sur aucun véhicule',
      r.every(v => v && v.indexOf('Livraison') === -1), JSON.stringify(r));
    check('D1-2 : l\'identité du véhicule, elle, reste demandée',
      r.every(v => v && v.indexOf('Identité du véhicule') !== -1), JSON.stringify(r));

    const scenario = await page.evaluate(() => ({
      sc: _scenarioTrajet(), sansObjet: _livraisonSansObjet()
    }));
    check('D1-3 : la règle porte sur le fait métier, pas sur la mise en page',
      scenario.sansObjet === true && scenario.sc.pc === false && scenario.sc.liv === false,
      JSON.stringify(scenario));

    const payload = await page.evaluate(() => _lireFichesVehicules().map(v => ({
      liv: v.livraison_apres_stockage,
      adresse: v.adresse_arrivee_rue, contact: v.liv_contact_nom,
      restit: v.restitution_concernee, restitAdresse: v.restit_adresse_rue
    })));
    check('D1-4 : et rien de tout cela ne part en base',
      payload.every(v => !v.liv && !v.adresse && !v.contact && !v.restit && !v.restitAdresse),
      JSON.stringify(payload));

    // DÈS QUE HelixCar intervient, la rubrique revient.
    await scenarioStockage(page, 'helixcar', 'recuperation_client', 3);
    r = await rubriquesVisibles(page, 3);
    check('D1-5 : dès que HelixCar achemine, la rubrique revient',
      r.every(v => v && v.indexOf('Livraison') !== -1), JSON.stringify(r));

    await scenarioStockage(page, 'depot_client', 'helixcar', 3);
    r = await rubriquesVisibles(page, 3);
    check('D1-6 : et quand HelixCar livre, elle est là aussi',
      r.every(v => v && v.indexOf('Livraison') !== -1), JSON.stringify(r));

    // BASCULE : revenir au scénario sans objet nettoie ce qui avait été saisi.
    await page.evaluate(() => {
      const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
      const oui = document.querySelector('input[name="veh-0-liv-active"][value="oui"]');
      if (oui) { oui.checked = true; if (typeof basculerLivraisonVehicule === 'function') basculerLivraisonVehicule(0); }
      set('veh-0-liv-rue', 'TEST-QA 4 rue de la Livraison');
    });
    await page.waitForTimeout(150);
    await scenarioStockage(page, 'depot_client', 'recuperation_client', 3);
    const apresBascule = await page.evaluate(() => _lireFichesVehicules()[0]);
    check('D1-7 : après bascule, l\'ancienne adresse de livraison a disparu du payload',
      !apresBascule.adresse_arrivee_rue && !apresBascule.livraison_apres_stockage,
      JSON.stringify({ a: apresBascule.adresse_arrivee_rue, l: apresBascule.livraison_apres_stockage }));

    // Le CONVOYAGE n'est en rien modifié.
    await L.chooseService(page, 'convoyage');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const el = document.getElementById('nb-vehicules');
      if (el) { el.value = '2'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
    });
    await page.waitForTimeout(250);
    const conv = await rubriquesVisibles(page, 2);
    check('D1-8 : le Convoyage garde sa rubrique Livraison, intacte',
      conv.every(v => v && v.indexOf('Livraison') !== -1), JSON.stringify(conv));
    check('D1-9 : la question de restitution n\'est ni réécrite ni reconditionnée',
      /Une restitution est-elle prévue pour ce véhicule \?/.test(idx));
    await page.close();
  }

  // ══ D3. LES HORAIRES DE NETTOYAGE SONT OBLIGATOIRES ══
  {
    const page = await L.newPage(browser);
    await L.fillStep1(page, 'pro');
    await L.chooseService(page, 'nettoyage');
    await page.waitForTimeout(200);

    const libelles = await page.evaluate(() => {
      const lire = id => {
        const e = document.getElementById(id);
        const g = e && e.closest('.modal-form-group');
        const l = g && g.querySelector('label');
        return l ? (l.textContent || '').replace(/\s+/g, ' ').trim() : null;
      };
      return { debut: lire('nett-creneau-debut'), fin: lire('nett-creneau-fin'),
               valDebut: (document.getElementById('nett-creneau-debut') || {}).value,
               valFin: (document.getElementById('nett-creneau-fin') || {}).value };
    });
    check('D3-1 : « facultatif » a disparu des deux libellés',
      !/facultatif/i.test(libelles.debut || '') && !/facultatif/i.test(libelles.fin || ''),
      JSON.stringify(libelles));
    check('D3-2 : et l\'indicateur obligatoire est là, sur les deux',
      /\*/.test(libelles.debut || '') && /\*/.test(libelles.fin || ''),
      JSON.stringify(libelles));
    check('D3-3 : aucune heure factice n\'est préremplie',
      libelles.valDebut === '' && libelles.valFin === '', JSON.stringify(libelles));

    // La chronologie compare des COUPLES date+heure.
    const chrono = await page.evaluate(() => ({
      memeJourInverse: _nettChronologieOk('2026-11-02', '17:00', '2026-11-02', '09:00'),
      memeJourOk:      _nettChronologieOk('2026-11-02', '09:00', '2026-11-02', '17:00'),
      memeJourEgal:    _nettChronologieOk('2026-11-02', '09:00', '2026-11-02', '09:00'),
      surDeuxJours:    _nettChronologieOk('2026-11-02', '17:00', '2026-11-04', '09:00'),
      finAvantDebut:   _nettChronologieOk('2026-11-04', '09:00', '2026-11-02', '17:00')
    }));
    check('D3-4 : le même jour, 17:00 → 09:00 est refusé',
      chrono.memeJourInverse === false, JSON.stringify(chrono));
    check('D3-5 : le même jour, 09:00 → 17:00 passe',
      chrono.memeJourOk === true, JSON.stringify(chrono));
    check('D3-6 : le même jour, deux heures identiques sont refusées',
      chrono.memeJourEgal === false, JSON.stringify(chrono));
    check('D3-7 : sur deux jours, 17:00 → 09:00 est parfaitement valide',
      chrono.surDeuxJours === true, JSON.stringify(chrono));
    check('D3-8 : une fin antérieure au début reste refusée',
      chrono.finAvantDebut === false, JSON.stringify(chrono));

    // Le récapitulatif montre la période ET les deux horaires.
    const recap = await page.evaluate(() => {
      const p = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      p('nett-date', '2026-11-02'); p('nett-date-fin', '2026-11-04');
      p('nett-creneau-debut', '08:30'); p('nett-creneau-fin', '16:45');
      construireRecapNettoyage();
      return (document.getElementById('recap-demande') || {}).textContent || '';
    });
    check('D3-9 : le récapitulatif montre la période complète',
      /Date de début/i.test(recap) && /Date de fin/i.test(recap), recap.slice(0, 300));
    check('D3-10 : et les deux horaires, avec les libellés du formulaire',
      /Horaire de début sur place/i.test(recap) && /Horaire de fin sur place/i.test(recap)
      && /08:30/.test(recap) && /16:45/.test(recap), recap.slice(0, 400));
    await page.close();
  }

  // ══ D4. LE TECHNICIEN N'A PLUS D'INFORMATIONS VÉHICULES ══
  {
    const page = await L.newPage(browser);
    await L.fillStep1(page, 'pro');
    await L.chooseService(page, 'professionnel');
    await L.ouvrirEtapeProfessionnel(page);
    await page.waitForTimeout(200);
    const etat = await page.evaluate(() => {
      const coche = (n, v, h) => {
        const e = document.querySelector('input[name="' + n + '"][value="' + v + '"]');
        if (e) { e.checked = true; if (typeof window[h] === 'function') window[h](); }
      };
      coche('pro-categorie', 'technicien', 'proOnCategorieChange');
      coche('pro-specialite', 'mecanique', 'proOnMetierChange');
      return {
        rubriques: PRO_RUBRIQUES.slice(),
        accordeon: !!document.getElementById('pro-acc-vehicules'),
        champs: document.querySelectorAll('[id^="pro-veh-"], #pro-nb-vehicules').length,
        payload: _construireDetailsProfessionnel(),
        nbPros: !!document.getElementById('pro-nb-pros')
      };
    });
    check('D4-1 : les quatre rubriques conservées, exactement',
      JSON.stringify(etat.rubriques) === JSON.stringify(['besoin', 'lieu', 'periode', 'mission']),
      JSON.stringify(etat.rubriques));
    check('D4-2 : aucune rubrique ni aucun champ de véhicule ne subsiste',
      etat.accordeon === false && etat.champs === 0, JSON.stringify(etat));
    check('D4-3 : le nombre de professionnels, lui, est conservé', etat.nbPros === true);
    check('D4-4 : le payload ne porte aucun véhicule, et n\'en invente aucun',
      etat.payload.nombre_vehicules === null && etat.payload.vehicules.length === 0,
      JSON.stringify({ n: etat.payload.nombre_vehicules, v: etat.payload.vehicules }));

    // RENFORT : strictement inchangé. On compare son empreinte
    // fonctionnelle complète avant/après changement de catégorie.
    const renfort = await page.evaluate(() => {
      const coche = (n, v, h) => {
        const e = document.querySelector('input[name="' + n + '"][value="' + v + '"]');
        if (e) { e.checked = true; if (typeof window[h] === 'function') window[h](); }
      };
      coche('pro-categorie', 'renfort', 'proOnCategorieChange');
      coche('pro-mission', 'jockey', 'proOnMetierChange');
      const d = _construireDetailsProfessionnel();
      return {
        cles: Object.keys(d).sort(),
        categorie: d.categorie, mission: d.mission,
        libelle: _proLibelleMetier(d),
        titreMission: (document.getElementById('pro-mission-titre') || {}).textContent,
        vehicules: document.querySelectorAll('[id^="pro-veh-"], #pro-acc-vehicules').length
      };
    });
    check('D4-5 : le Renfort garde son métier et son libellé',
      renfort.categorie === 'renfort' && renfort.mission === 'jockey'
      && renfort.libelle === 'Jockey automobile', JSON.stringify(renfort));
    check('D4-6 : son titre de rubrique Mission est inchangé',
      renfort.titreMission === 'Type de mission', renfort.titreMission);
    check('D4-7 : et il n\'a toujours aucun véhicule — comme avant',
      renfort.vehicules === 0, String(renfort.vehicules));

    // Un ancien brouillon ne peut plus réinjecter de véhicules.
    const brouillon = await page.evaluate(() => _construireBrouillonClient());
    check('D4-8 : un brouillon ne mémorise plus aucun véhicule professionnel',
      JSON.stringify(brouillon.professionnelVehicules) === '{}',
      JSON.stringify(brouillon.professionnelVehicules));
    await page.close();
  }

  // ══ E1. PLUS AUCUN GRAND ENCADRÉ ROUGE OU VERT ══
  {
    // Aucune alerte native, nulle part dans les formulaires publics.
    check('E1-1 : plus aucune alerte native dans index.html',
      !/(^|[^.\w])alert\(/m.test(idx.replace(/\/\/[^\n]*/g, '')), 'alert() encore présent');
    check('E1-2 : ni prompt(), ni confirm() dans les écrans d\'authentification',
      !/prompt\([^)]*mot de passe/i.test(dash));

    // Plus aucun grand encadré coloré : ni dans la vitrine, ni dans les
    // écrans d'authentification du Dashboard.
    const couleursInterdites = /#FEF2F2|#FCA5A5|#991B1B|#ECFDF5|#6EE7B7|#065F46/;
    check('E1-3 : aucune couleur de grand encadré rouge ou vert dans index.html',
      !couleursInterdites.test(idx), (idx.match(couleursInterdites) || [])[0]);
    const zoneAuth = dash.slice(0, dash.indexOf('async function finaliserSessionConvoyeur') + 4000);
    check('E1-4 : ni dans les écrans d\'authentification du Dashboard',
      !couleursInterdites.test(zoneAuth), (zoneAuth.match(couleursInterdites) || [])[0]);

    // Le composant partagé existe des deux côtés, avec le même rendu.
    check('E1-5 : un composant partagé, déclaré des deux côtés',
      /\.hc-note \{/.test(idx) && /\.hc-note \{/.test(dash));
    check('E1-6 : fond transparent et repère vertical, jamais un cadre plein',
      /background: transparent;[\s\S]{0,140}border-left: 3px solid #DC2626/.test(idx)
      && /background: transparent;[\s\S]{0,140}border-left: 3px solid #DC2626/.test(dash));

    // Le rendu réel, mesuré dans la page.
    const page = await L.newPage(browser);
    const rendu = await page.evaluate(() => {
      _hcNote('connexion-message', 'TEST-QA message', 'erreur');
      const el = document.getElementById('connexion-message');
      const st = getComputedStyle(el);
      return { fond: st.backgroundColor, bordure: st.borderLeftWidth,
               bordureCouleur: st.borderLeftColor, visible: st.display !== 'none',
               haut: st.borderTopWidth, droite: st.borderRightWidth };
    });
    check('E1-7 : le message s\'affiche sans aucun fond',
      rendu.visible === true && /rgba\(0, 0, 0, 0\)|transparent/.test(rendu.fond),
      JSON.stringify(rendu));
    check('E1-8 : et seulement avec un repère vertical à gauche',
      parseFloat(rendu.bordure) >= 2 && parseFloat(rendu.haut) === 0
      && parseFloat(rendu.droite) === 0, JSON.stringify(rendu));

    // Une erreur de champ garde son petit repère, et disparaît à la correction.
    // F01-010 : Nettoyage est réservé aux professionnels, y compris dans ce scénario.
    await L.fillStep1(page, 'pro');
    await L.chooseService(page, 'nettoyage');
    await page.waitForTimeout(150);
    const champ = await page.evaluate(() => {
      _showFieldError('nett-adresse-rue', 'Ce champ est obligatoire.');
      const e = document.getElementById('nett-adresse-rue');
      const g = e.closest('.modal-form-group');
      const m = g.querySelector('.field-error-msg');
      const avant = { classe: e.classList.contains('field-error'),
                      visible: !!m && m.classList.contains('visible'),
                      texte: m ? m.textContent : '' };
      _clearFieldError('nett-adresse-rue');
      return { avant, apres: { classe: e.classList.contains('field-error'),
                               visible: !!m && m.classList.contains('visible') } };
    });
    check('E1-9 : une erreur de champ s\'affiche juste dessous',
      champ.avant.classe === true && champ.avant.visible === true
      && /obligatoire/i.test(champ.avant.texte), JSON.stringify(champ));
    check('E1-10 : et disparaît dès la correction',
      champ.apres.classe === false && champ.apres.visible === false, JSON.stringify(champ));
    check('E1-11 : les messages sont annoncés aux lecteurs d\'écran',
      /id="connexion-message" class="hc-note" role="status"/.test(idx)
      && /id="supabase-debug" class="hc-note" role="alert"/.test(idx));
    await page.close();
  }

  // ══ E2. LE FOND BLEU DE L'AUTOREMPLISSAGE ══
  {
    check('E2-1 : la couleur d\'autoremplissage est neutralisée, des deux côtés',
      /:-webkit-autofill/.test(idx) && /:-webkit-autofill/.test(dash));
    check('E2-2 : par background-clip, jamais en désactivant l\'autocomplétion',
      /-webkit-background-clip: text/.test(idx) && /background-clip: text/.test(dash));
    check('E2-3 : Firefox est couvert aussi',
      /input:autofill/.test(idx) && /:autofill/.test(dash));
    check('E2-4 : l\'autocomplétion n\'est jamais désactivée',
      !/autocomplete="off"/.test(idx.slice(idx.indexOf('id="connexion-email"') - 400,
                                            idx.indexOf('id="connexion-email"') + 400)));
    check('E2-5 : les champs gardent leurs valeurs d\'autocomplétion utiles',
      /autocomplete="new-password"/.test(idx));
  }

  // ══ E3. LES BOUTONS « EFFACER / OK » ══
  {
    check('E3-1 : le style suit la CLASSE du bouton, plus son conteneur',
      /#modal-client \.veh-sous-effacer,\s*\n#modal-client \.veh-sous-valider \{/.test(idx));
    check('E3-2 : « Effacer » reste secondaire, « OK » reste sombre et principal',
      /\.veh-sous-effacer \{ background:transparent/.test(idx)
      && /\.veh-sous-valider \{ background:var\(--ink\)/.test(idx));
    check('E3-3 : tout conteneur d\'actions aligne le couple à droite',
      /#modal-client \.veh-sous-ok,\s*\n#modal-client \.veh-sous-actions \{[\s\S]{0,120}justify-content:flex-end/.test(idx));

    const page = await L.newPage(browser);
    await L.fillStep1(page, 'particulier');
    await L.chooseService(page, 'convoyage');
    await page.evaluate(() => {
      const el = document.getElementById('nb-vehicules');
      if (el) { el.value = '2'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
    });
    await page.waitForTimeout(250);
    const boutons = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#modal-client .veh-sous-effacer').forEach(b => {
        const st = getComputedStyle(b);
        const p = getComputedStyle(b.parentElement);
        out.push({ fond: st.backgroundColor, radius: st.borderRadius,
                   aligne: p.justifyContent });
      });
      return out;
    });
    check('E3-4 : chaque « Effacer » est réellement stylé, jamais du HTML brut',
      boutons.length > 0 && boutons.every(b => parseFloat(b.radius) > 0
        && /rgba\(0, 0, 0, 0\)|transparent/.test(b.fond)),
      JSON.stringify(boutons.slice(0, 3)));
    check('E3-5 : et le couple est aligné à droite',
      boutons.every(b => b.aligne === 'flex-end'), JSON.stringify(boutons.slice(0, 3)));
    await page.close();
  }

  // ══ E4. LE CALENDRIER DU NETTOYAGE ══
  {
    check('E4-1 : les deux bornes du nettoyage sont des ronds',
      /#hc-cal-grille\[data-hc-periode="nettoyage"\] \.hc-cal-jour--p1-borne \{[\s\S]{0,80}border-radius: 50%/.test(idx));
    check('E4-2 : les jours intermédiaires portent un petit rond, beaucoup plus clair',
      /#hc-cal-grille\[data-hc-periode="nettoyage"\] \.hc-cal-jour--p1-inter::after \{[\s\S]{0,320}opacity: \.32/.test(idx));
    check('E4-3 : le Convoyage et le Stockage gardent leur rendu carré',
      /\.hc-cal-jour--p1-borne \{ background: var\(--accent\); color: #fff !important; \}/.test(idx));

    const page = await L.newPage(browser);
    await L.fillStep1(page, 'pro');
    await L.chooseService(page, 'nettoyage');
    await page.waitForTimeout(200);
    await page.evaluate(() => _hcOuvrirCalendrier(document.getElementById('nett-date')));
    await page.waitForTimeout(250);
    const marque = await page.evaluate(() =>
      (document.getElementById('hc-cal-grille') || {}).getAttribute('data-hc-periode'));
    check('E4-4 : la grille du nettoyage porte bien sa marque', marque === 'nettoyage', String(marque));

    // On choisit une période de plusieurs jours et on regarde le rendu.
    const rendu = await page.evaluate(() => {
      const jours = Array.prototype.slice
        .call(document.querySelectorAll('#hc-cal-grille button.hc-cal-jour'))
        .filter(j => !j.disabled && j.className.indexOf('hors-mois') === -1);
      if (jours.length < 5) return null;
      jours[0].click();
      const suite = Array.prototype.slice
        .call(document.querySelectorAll('#hc-cal-grille button.hc-cal-jour'))
        .filter(j => !j.disabled && j.className.indexOf('hors-mois') === -1);
      suite[Math.min(4, suite.length - 1)].click();
      const tous = Array.prototype.slice.call(document.querySelectorAll('#hc-cal-grille .hc-cal-jour'));
      const bornes = tous.filter(j => j.classList.contains('hc-cal-jour--p1-borne'));
      const inter = tous.filter(j => j.classList.contains('hc-cal-jour--p1-inter'));
      return {
        bornes: bornes.length,
        inter: inter.length,
        rondBorne: bornes.length ? getComputedStyle(bornes[0]).borderRadius : '',
        fondInter: inter.length ? getComputedStyle(inter[0]).backgroundColor : '',
        debut: (document.getElementById('nett-date') || {}).value,
        fin: (document.getElementById('nett-date-fin') || {}).value
      };
    });
    check('E4-5 : les deux bornes sont marquées, et rondes',
      rendu && rendu.bornes === 2 && /50%|9999px/.test(rendu.rondBorne), JSON.stringify(rendu));
    check('E4-6 : les jours intermédiaires sont marqués sans fond plein',
      rendu && rendu.inter > 0
      && /rgba\(0, 0, 0, 0\)|transparent/.test(rendu.fondInter), JSON.stringify(rendu));
    check('E4-7 : et les deux dates sont réellement écrites',
      rendu && /^\d{4}-\d{2}-\d{2}$/.test(rendu.debut) && /^\d{4}-\d{2}-\d{2}$/.test(rendu.fin)
      && rendu.fin > rendu.debut, JSON.stringify(rendu));
    await page.close();
  }

  // ══ F. LES DEVIS PDF ══
  {
    check('F1-1 : les titres à aérer sont nommés, y compris le nouveau',
      /'Mission sur site'/.test(dash) && /'Informations complémentaires'/.test(dash)
      && /'Prestation', 'Prestations'/.test(dash) && /'Période et horaires'/.test(dash));
    check('F2-1 : le devis Nettoyage porte les deux horaires, avec les libellés du formulaire',
      /\['Horaire de début sur place', ndPdf\.creneau_debut \|\| ''\]/.test(dash)
      && /\['Horaire de fin sur place', ndPdf\.creneau_fin \|\| ''\]/.test(dash));
    check('F2-2 : ils sont placés près des dates, dans la même carte',
      /carteLignes\('Période et horaires', \[\s*\n\s*\['Date de début'/.test(dash));
    check('F2-3 : une valeur longue passe à la ligne au lieu de déborder',
      /splitTextToSize\(String\(valeur\)/.test(dash) && /_lignesValeurLV/.test(dash));
    check('F2-4 : et la hauteur est mesurée avec le MÊME calcul que le dessin',
      /_hauteurLigneLV/.test(dash)
      && /return \(m\.lignes\.length \+ \(m\.sousLibelle \? 1 : 0\)\) \* HAUTEUR_LIGNE_LV \+ 1\.6;/.test(dash));
    check('F3-1 : le devis Technicien ne montre plus aucun véhicule',
      !/\['Véhicules', pdPdf\.nombre_vehicules/.test(dash));
    check('F3-2 : il se lit sur la durée et le nombre de professionnels',
      /estTechPdf \? \[[\s\S]{0,320}\['Professionnels', pdPdf\.nombre_professionnels[\s\S]{0,80}\['Durée', _proDureeTexte\(pdPdf\)\]/.test(dash));
    check('F3-3 : aucun véhicule fictif n\'est inventé pour un professionnel',
      /return pd\.nombre_vehicules \|\| 0;/.test(dash)
      && !/return pd\.nombre_vehicules \|\| 1;/.test(dash));
  }

  // ══ G. LES PROTECTIONS DE LA PR nº 3 SURVIVENT À CE LOT ══
  //
  // Les lots D1 et D3 touchent la fiche véhicule et le nettoyage : on
  // vérifie ICI que rien de ce qui avait été gagné n'est reperdu.
  {
    const page = await L.newPage(browser);
    await L.fillStep1(page, 'particulier');
    await L.chooseService(page, 'convoyage');
    await page.waitForTimeout(150);

    for (const n of [1, 2, 3, 5]) {
      await page.evaluate((n) => {
        const el = document.getElementById('nb-vehicules');
        if (el) { el.value = String(n); el.dispatchEvent(new Event('change', { bubbles: true })); }
        const r = document.querySelector('input[name="trajet-commun"][value="non"]');
        if (r) { r.checked = true; if (typeof changerTrajetCommun === 'function') changerTrajetCommun(r); }
        if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
      }, n);
      await page.waitForTimeout(220);
      const fiches = await page.evaluate((n) => {
        const out = [];
        for (let i = 0; i < n; i++) {
          const c = document.getElementById('veh-contenu-' + i);
          out.push({
            rubriques: c ? Array.prototype.slice
              .call(c.querySelectorAll('.veh-sous-accordeon .veh-sous-titre'))
              .map(t => (t.textContent || '').trim()) : null,
            modes: document.querySelectorAll('input[name="veh-' + i + '-mode"]').length,
            modesDedans: c ? Array.prototype.slice
              .call(document.querySelectorAll('input[name="veh-' + i + '-mode"]'))
              .filter(r => c.contains(r)).length : 0
          });
        }
        return out;
      }, n);
      check('G1-' + n + ' : ' + n + ' véhicule(s) — quatre rubriques, dans l\'ordre',
        fiches.every(f => f.rubriques && f.rubriques.length === 4
          && f.rubriques[0] === 'Identité du véhicule'
          && f.rubriques[1] === 'Prise en charge'
          && f.rubriques[2] === 'Livraison'
          && f.rubriques[3] === 'Mode de transport'),
        JSON.stringify(fiches.map(f => f.rubriques)));
      check('G2-' + n + ' : le mode de transport reste DANS chaque fiche',
        fiches.every(f => f.modes === 2 && f.modesDedans === 2),
        JSON.stringify(fiches.map(f => [f.modes, f.modesDedans])));
    }

    // Chaque véhicule garde SA valeur, et une modification n'en touche
    // aucun autre.
    const modes = await page.evaluate(() => {
      const poser = (i, v) => {
        const r = document.querySelector('input[name="veh-' + i + '-mode"][value="' + v + '"]');
        if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      poser(0, 'plateau'); poser(2, 'plateau');
      return _lireFichesVehicules().map(v => v && v.mode_transport);
    });
    check('G3 : chaque véhicule garde sa propre valeur',
      JSON.stringify(modes) === JSON.stringify(['plateau', 'standard', 'plateau', 'standard', 'standard']),
      JSON.stringify(modes));

    // Convoyage → Stockage → Convoyage : la structure revient intacte.
    await L.chooseService(page, 'stockage');
    await page.waitForTimeout(200);
    await scenarioStockage(page, 'helixcar', 'helixcar', 5);
    await L.chooseService(page, 'convoyage');
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const r = document.querySelector('input[name="trajet-commun"][value="non"]');
      if (r) { r.checked = true; if (typeof changerTrajetCommun === 'function') changerTrajetCommun(r); }
      if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
    });
    await page.waitForTimeout(250);
    const retour = await rubriquesVisibles(page, 5);
    check('G4 : après Convoyage → Stockage → Convoyage, la structure revient intacte',
      retour.every(v => v && v.length === 4 && v[3] === 'Mode de transport'),
      JSON.stringify(retour.map(v => v && v.length)));
    const modesRetour = await page.evaluate(() =>
      [0, 1, 2, 3, 4].map(i => document.querySelectorAll('input[name="veh-' + i + '-mode"]').length));
    check('G5 : et le mode de transport ne se dédouble jamais',
      modesRetour.every(n => n === 2), JSON.stringify(modesRetour));

    // Le contrôle parasite global ne revient pas.
    check('G6 : aucun contrôle global « Standard / Sur plateau »',
      !/id="client-mode"/.test(idx) && !/id="client-plateau"/.test(idx)
      && !/name="mode-transport"/.test(idx) && !/function onModeTransport/.test(idx));
    const standard = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#modal-client input[type="radio"]').forEach(r => {
        const l = r.closest('label');
        if (l && /^\s*Standard\s*$/.test(l.textContent || '')) out.push(r.name);
      });
      return out;
    });
    check('G7 : le mot « Standard » ne subsiste que dans « Délai souhaité »',
      standard.length > 0 && standard.every(n => /delai/i.test(n)), JSON.stringify(standard));
    check('G8 : et « Délai souhaité » garde ses deux choix',
      /Prioritaire/.test(idx) && /D[ée]lai souhait[ée]/.test(idx));
    check('G9 : aucune erreur JavaScript sur tout le cycle',
      page.jsErrors.length === 0, page.jsErrors.slice(0, 2).join(' | '));
    await page.close();
  }

  // ══ H. LES AUTRES PROTECTIONS DE LA PR nº 3 ══
  {
    const PROTECTIONS = [
      ['compteur de demandes rafraîchi immédiatement',
        () => /DELAI_MIN_RECOMPTAGE_MS = 30000/.test(dash) && /visibilitychange/.test(dash)],
      ['aucune erreur COALESCE entre une date et un texte',
        () => !/coalesce\(\s*\w+\.date_[a-z_]+\s*,\s*\w+\.[a-z_]+\s*\)\s*is null/i
                .test(fs.readFileSync(fichier('migrations/103_nettoyage_horaires_obligatoires.sql'), 'utf8'))],
      ['les quatre activités partenaire restent acceptées',
        () => /activites_partenaire\(\)/.test(
          fs.readFileSync(fichier('migrations/100_activites_partenaire.sql'), 'utf8'))],
      ['la création de compte ne peut pas annoncer un faux succès',
        () => /_compteEtat/.test(idx) && /existe_deja/.test(idx) && /_retourSrv/.test(idx)],
      ['duplication indépendante des véhicules',
        () => /_memoriserVehicules/.test(idx) && /_vehiculeMemorise/.test(idx)],
      ['la référence de mission vient d\'une séquence, jamais d\'un max()',
        () => /nextval\('public\.missions_nettoyage_numero'\)/.test(
          fs.readFileSync(fichier('migrations/102_nettoyage_periode_et_mission.sql'), 'utf8'))],
      ['une seule mission de nettoyage par demande',
        () => /missions_nettoyage_une_par_demande/.test(
          fs.readFileSync(fichier('migrations/102_nettoyage_periode_et_mission.sql'), 'utf8'))],
      ['isolement réseau des tests',
        () => /abort/.test(fs.readFileSync(fichier('tests/env.js'), 'utf8'))],
      ['intégration continue en deux tâches', () => {
        const y = fs.readFileSync(fichier('.github/workflows/tests.yml'), 'utf8');
        return /Politiques RLS/.test(y) && /Suites navigateur/.test(y);
      }]
    ];
    PROTECTIONS.forEach(([nom, preuve], i) => {
      let ok = false, err = '';
      try { ok = !!preuve(); } catch (e) { err = e.message; }
      check('H' + (i + 1) + ' : ' + nom + ' — intacte', ok, err);
    });
  }

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
