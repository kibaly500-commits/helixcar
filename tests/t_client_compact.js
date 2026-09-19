// Fixtures uniquement : toutes les requêtes externes sont bloquées.
const fs = require('fs'), path = require('path'), assert = require('assert');
const {lancerNavigateur} = require('./env');
(async () => {
  const b = await lancerNavigateur();
  try {
    const p = await b.newPage();
    await p.route('**/*', r => r.abort());
    await p.evaluate(() => {
      window.__vehicules = [];
      window.supabase = {createClient:() => ({
        auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
        from:() => ({select(){return this},eq(){return this},order:async()=>({data:window.__vehicules})})
      })};
    });
    await p.setContent(fs.readFileSync(path.join(__dirname, '../dashboard.html'), 'utf8'));
    await p.evaluate(async () => {
      document.getElementById('login-screen').remove();
      document.getElementById('app').classList.add('visible');
      document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
      document.getElementById('page-client-dashboard').classList.add('active');
      window._currentClient = {email:'fixture+qa-final01@example.test'};
      window.chargerDemandesClient = async () => [{id:'d1',numero_client:'HC-DEMO-001',type_service:'convoyage',statut:'nouveau'}];
      window.chargerDevisClient = async () => [{id:'q1',client_id:'d1',statut:'accepte',paiement_statut:'paye'}];
      window.chargerInformationsDemande = async () => [{cle:'vehicule_1_vin',libelle:'VIN',statut:'attendue'}];
      await loadDemandesClient();
      window.__completion = null;
      HC_ACTIONS.ouvrirCompletionDemande = id => window.__completion = id;
    });
    const details = p.locator('.hc-demande-details');
    assert.equal(await details.getAttribute('open'), null);
    assert.equal(await p.getByText('Consulter mon devis', {exact:true}).isVisible(), false);
    assert(await p.getByText('Compléter mes informations →', {exact:true}).isVisible());
    await p.getByText('Compléter mes informations →', {exact:true}).click();
    assert.equal(await p.evaluate(() => window.__completion), 'd1');
    await details.locator('summary').click();
    assert(await p.getByText('Consulter mon devis', {exact:true}).isVisible());
    assert(await p.getByText('Document de paiement TEST', {exact:true}).isVisible());
    await details.locator('summary').click();
    for (const width of [390,1440]) {
      await p.setViewportSize({width,height:950});
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await p.screenshot({path:'/tmp/hc-demandes-compactes-'+width+'.png',fullPage:true});
    }
    await p.evaluate(async () => {
      window.__vehicules = [{position:1,marque_modele:'Peugeot 308',immatriculation:'AB-123-CD',ville_depart:'Paris',ville_arrivee:'Lyon'}];
      await loadInfosClient();
    });
    const vehicle = p.locator('.hc-info-vehicle summary');
    assert.match(await vehicle.textContent(), /Peugeot 308 · AB-123-CD · Paris → Lyon/);
    assert.equal(await p.locator('.hc-info-vehicle').getAttribute('open'), null);
    await p.evaluate(async () => {window.chargerInformationsDemande = async () => [];await loadDemandesClient();});
    assert.equal(await p.locator('[data-completion-note]').count(), 0);
    await p.evaluate(async () => {window.chargerInformationsDemande = async () => {throw Error('offline')};await loadDemandesClient();});
    assert.match(await p.locator('[data-completion-note]').textContent(), /indisponibles/);
    const index = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    const vm = require('vm'), ctx = {};
    vm.createContext(ctx);
    vm.runInContext(index.slice(index.indexOf('var _completerVehicules ='),index.indexOf('function _completerEstRestante')),ctx);
    ctx._completerVehicules = [{position:2,marque_modele:'Renault Clio',immatriculation:'XY-456-ZZ',ville_depart:'Nice',ville_arrivee:'Lille'}];
    assert.match(ctx._completerGrouper([{cle:'vehicule_2_vin',statut:'attendue'}])[0].identite,/Renault Clio · XY-456-ZZ · Nice → Lille/);
    assert.match(ctx._completerGrouper([{cle:'vehicule_1_vin',statut:'attendue'}])[0].identite,/Identité non renseignée/);
    console.log('=== 14 PASS / 0 FAIL ===');
  } finally {await b.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
