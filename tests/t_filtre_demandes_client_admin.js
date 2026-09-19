// Régression : « Voir ses demandes » doit rester strictement limité au
// compte sélectionné, y compris après une recherche et sur mobile.
// Test local isolé : aucune lecture ni écriture distante.
const L = require('./lib');
const { urlFichier } = require('./env');

(async () => {
  const browser = await L.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('**/*', route =>
      /^(file:|about:|data:)/.test(route.request().url()) ? route.continue() : route.abort());
    const page = await ctx.newPage();
    await page.goto(urlFichier('dashboard.html'));

    await page.evaluate(() => {
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      document.getElementById('app').classList.add('visible');
      document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
      document.getElementById('page-admin-clients').classList.add('active');
      window.verifierAccesPartenaireEnCours = () => {};

      window.qaDemandes = [
        { id: 'a-1', auth_user_id: 'compte-a', numero_client: 'HC-A-001', prenom: 'Alice', nom: 'Martin', email: 'alice@example.invalid', telephone: '0600000001', type_client: 'particulier', type_service: 'convoyage', ville_depart: 'Paris', ville_arrivee: 'Lyon', created_at: '2026-09-18T10:00:00Z', vue_admin_at: null },
        { id: 'a-2', auth_user_id: 'compte-a', numero_client: 'HC-A-002', prenom: 'Alice', nom: 'Martin', email: 'alice@example.invalid', telephone: '0600000001', type_client: 'particulier', type_service: 'stockage', stockage_date_debut: '2026-10-01', created_at: '2026-09-17T10:00:00Z', vue_admin_at: null },
        { id: 'b-1', auth_user_id: 'compte-b', numero_client: 'HC-B-001', prenom: 'Bob', nom: 'Durand', email: 'bob@example.invalid', telephone: '0600000002', type_client: 'pro', type_service: 'convoyage', ville_depart: 'Nice', ville_arrivee: 'Lille', created_at: '2026-09-16T10:00:00Z', vue_admin_at: null }
      ];
      _demandesDevisListe = window.qaDemandes;
      window.loadDemandesDevis = () => {
        _mettreAJourFiltreDemandesCompte();
        _rendreTableDemandesDevis(_demandesDuCompteAdmin(_demandesDevisListe));
      };
      afficherClientsAdmin(window.qaDemandes);
    });

    const bouton = page.locator('#clients-table button').first();
    L.check('Bouton client : action sûre et compte exact transmis',
      await bouton.getAttribute('data-hc-action') === 'voirDemandesClientAdmin' &&
      await bouton.getAttribute('data-hc-a0') === 'compte-a');
    await bouton.click();
    await page.waitForTimeout(80);

    const texteFiltre = await page.locator('#tbody-demandes-devis').innerText();
    L.check('Compte sélectionné : ses deux demandes sont visibles',
      texteFiltre.includes('HC-A-001') && texteFiltre.includes('HC-A-002'));
    L.check('Compte sélectionné : aucune demande d’un autre compte',
      !texteFiltre.includes('HC-B-001') && !texteFiltre.includes('Bob'));
    L.check('Filtre actif : identité annoncée à l’administrateur',
      await page.locator('#filtre-client-devis').isVisible() &&
      (await page.locator('#filtre-client-devis-identite').innerText()).includes('Alice'));

    await page.fill('#recherche-devis', 'bob');
    await page.dispatchEvent('#recherche-devis', 'input');
    const texteRecherche = await page.locator('#tbody-demandes-devis').innerText();
    L.check('Recherche : impossible de sortir du périmètre client',
      !texteRecherche.includes('HC-B-001') && texteRecherche.includes('Aucune demande'));

    await page.fill('#recherche-devis', '');
    await page.dispatchEvent('#recherche-devis', 'input');
    L.check('Effacement recherche : périmètre client conservé',
      (await page.locator('#tbody-demandes-devis').innerText()).includes('HC-A-002') &&
      !(await page.locator('#tbody-demandes-devis').innerText()).includes('HC-B-001'));

    await page.locator('#filtre-client-devis button').click();
    const texteComplet = await page.locator('#tbody-demandes-devis').innerText();
    L.check('Afficher toutes : liste complète restaurée explicitement',
      texteComplet.includes('HC-A-001') && texteComplet.includes('HC-B-001') &&
      !(await page.locator('#filtre-client-devis').isVisible()));

    L.check('Mobile 390 px : aucun débordement horizontal du document',
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await ctx.close();
  } finally {
    await browser.close();
  }
  process.exitCode = L.results() ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
