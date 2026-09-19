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
      window.chargerDemandesClient = async () => [{id:'d1',numero_client:'HC-DEMO-001',type_service:'convoyage',statut:'nouveau',created_at:'2026-09-19T14:35:00Z'}];
      window.chargerDevisClient = async () => [{id:'q1',client_id:'d1',statut:'accepte',paiement_statut:'paye'}];
      window.chargerInformationsDemande = async () => [{cle:'vehicule_1_vin',libelle:'VIN',statut:'attendue'}];
      await loadDemandesClient();
      window.__completion = null;
      HC_ACTIONS.ouvrirCompletionDemande = id => window.__completion = id;
    });
    const details = p.locator('.hc-demande-details');
    assert.equal(await p.locator('.hc-demande-date').textContent(),'19/09/2026 à 16:35');
    assert(await p.locator('.hc-demande-card>.btn').evaluate(el=>el.getBoundingClientRect().width<el.parentElement.getBoundingClientRect().width-50));
    assert.equal(await details.getAttribute('open'), null);
    assert.equal(await p.getByText('Consulter mon devis', {exact:true}).isVisible(), false);
    assert(await p.getByText('Compléter mes informations →', {exact:true}).isVisible());
    await p.getByText('Compléter mes informations →', {exact:true}).click();
    assert.equal(await p.evaluate(() => window.__completion), 'd1');
    await details.locator('summary').click();
    assert(await p.getByText('Consulter mon devis', {exact:true}).isVisible());
    assert(await p.getByText('Document de paiement TEST', {exact:true}).isVisible());
    await details.locator('summary').click();
    await p.evaluate(async () => {
      window.chargerDemandesClient = async () => [
        {id:'d1',numero_client:'HC-2026-6320',type_service:'professionnel',statut:'nouveau'},
        {id:'d2',numero_client:'HC-2026-8594',type_service:'stockage',statut:'nouveau'},
        {id:'d3',numero_client:'HC-2026-5049',type_service:'convoyage',statut:'nouveau'},
        {id:'d4',numero_client:'HC-2026-4479',type_service:'stockage',statut:'nouveau'}];
      window.chargerDevisClient = async () => [{id:'q4',client_id:'d4',statut:'accepte',paiement_statut:'en_attente'}];
      window.chargerInformationsDemande = async id => [{cle:'vehicule_1_vin',statut:id==='d1'?'transmise':id==='d2'?'attendue':'validee'}];
      await loadDemandesClient();
    });
    assert.equal(await p.locator('[data-groupe-demandes="action"] .hc-demande-card').count(),2);
    assert.equal(await p.locator('[data-groupe-demandes="suivi"] .hc-demande-card').count(),2);
    assert.match(await p.locator('[data-demande="d1"] [data-completion-note]').textContent(),/Informations en vérification/);
    assert.match(await p.locator('[data-demande="d2"] [data-completion-note]').textContent(),/Informations à compléter/);
    assert.match(await p.locator('[data-demande="d3"] .hc-info-vert').textContent(),/Demande validée/);
    assert.match(await p.locator('[data-demande="d3"] [data-completion-note]').textContent(),/Devis en préparation/);
    assert.match(await p.locator('[data-demande="d4"] [data-completion-note]').textContent(),/Devis à régler/);
    assert.equal(await p.locator('[data-demande="d4"] > a').getAttribute('href'),'devis.html?id=q4');
    assert.equal(await p.getByText('Reçue',{exact:true}).count(),0);
    for (const width of [390,1440]) {
      await p.setViewportSize({width,height:950});
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert(await p.locator('.hc-demande-card').evaluateAll(cards=>cards.every((card,i)=>{
        const s=getComputedStyle(card),r=card.getBoundingClientRect();
        const prev=i?cards[i-1].getBoundingClientRect():null;
        return s.backgroundColor==='rgb(255, 255, 255)' && parseFloat(s.borderTopWidth)>=1 && (!prev || r.top-prev.bottom>=15 || r.left-prev.right>=15);
      })));
      assert(await p.locator('.hc-demande-details summary').first().evaluate(el=>{const c=getComputedStyle(el,'::marker').color.match(/\d+/g).map(Number);return c[0]>c[1]+50 && c[0]>c[2]+50;}));
      await p.screenshot({path:'/tmp/hc-demandes-compactes-'+width+'.png',fullPage:true});
    }
    await p.evaluate(async () => {
      window.chargerDemandesClient = async () => [{id:'d1',numero_client:'HC-DEMO-001',type_service:'convoyage',statut:'nouveau'}];
      window.chargerDevisClient = async () => [{id:'q1',client_id:'d1',statut:'accepte',paiement_statut:'paye'}];
      window.chargerInformationsDemande = async () => [{cle:'vehicule_1_vin',libelle:'VIN',statut:'attendue'}];
      window.__vehicules = [{position:1,marque_modele:'Peugeot 308',immatriculation:'AB-123-CD',ville_depart:'Paris',ville_arrivee:'Lyon'}];
      await loadInfosClient();
    });
    const vehicle = p.locator('.hc-info-vehicle summary');
    assert.match(await vehicle.textContent(), /Peugeot 308 · AB-123-CD · Paris → Lyon/);
    assert.equal(await p.locator('.hc-info-vehicle').getAttribute('open'), null);
    await p.evaluate(async () => {window.chargerInformationsDemande = async () => [];await loadDemandesClient();});
    assert.match(await p.locator('[data-completion-note]').textContent(), /Prestation en préparation/);
    await p.evaluate(async () => {
      window.chargerDemandesClient = async () => [{id:'d1',numero_client:'PAYÉ',type_service:'convoyage'},{id:'d2',numero_client:'NON PAYÉ',type_service:'stockage'}];
      window.chargerInformationsDemande = async () => [{cle:'vehicule_1_vin',statut:'transmise'}];
      await loadDemandesClient(); await loadInfosClient();
    });
    assert.equal(await p.locator('[data-paiement="paye"][data-demande="d1"]').count(),1);
    assert.equal(await p.locator('[data-paiement="non-paye"][data-demande="d2"]').count(),1);
    assert.match(await p.locator('[data-paiement="paye"] [data-completion-note]').textContent(),/Informations en vérification/);
    assert.equal(await p.locator('#client-infos-liste [data-demande]').count(),2);
    assert.equal(await p.locator('#client-infos-liste button').count(),0);
    await p.evaluate(async () => {
      window.chargerMissionsClient = async () => [
        {id:'m1',client_id:'d1',statut:'brouillon'},
        {id:'m2',client_id:'d1',statut:'acceptee',convoyeur_prenom:'Alex'},
        {id:'m3',client_id:'d1',statut:'en_cours'},
        {id:'m4',client_id:'d2',statut:'brouillon'}];
      await loadMissionsResumeClient(); await loadMissionsClient();
    });
    assert.equal(await p.locator('#client-resume-en-cours').textContent(),'1');
    assert.match(await p.locator('[data-mission="m1"]').textContent(),/En préparation/);
    assert.match(await p.locator('[data-mission="m2"]').textContent(),/Alex.*Planifiée/);
    assert.match(await p.locator('[data-mission="m4"]').textContent(),/En attente de paiement/);
    await p.evaluate(async () => {window.chargerDemandesClient = async () => [{id:'d1'}];});
    await p.evaluate(async () => {window.chargerInformationsDemande = async () => {throw Error('offline')};await loadDemandesClient();});
    assert.match(await p.locator('[data-completion-note]').textContent(), /indisponible/);
    await p.evaluate(async () => {
      _construirePdfDevis = () => ({output:() => new Blob(['layout fixture'],{type:'application/pdf'})});
      await ouvrirApercuDemandeClient('d1');
    });
    for (const width of [390,1440]) {
      await p.setViewportSize({width,height:800});
      assert(await p.locator('.hc-apercu-carte').evaluate(card => {
        const actions = card.querySelector('.hc-apercu-actions');
        const button = actions.querySelector('button');
        const last = actions.lastElementChild.getBoundingClientRect();
        return card.getBoundingClientRect().bottom <= innerHeight && last.bottom < card.getBoundingClientRect().bottom - 20 && button.getBoundingClientRect().top > 0;
      }));
      await p.screenshot({path:'/tmp/hc-pdf-marge-'+width+'.png'});
    }
    const index = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    const vm = require('vm'), ctx = {};
    vm.createContext(ctx);
    vm.runInContext(index.slice(index.indexOf('var _completerVehicules ='),index.indexOf('function _completerEstRestante')),ctx);
    ctx._completerVehicules = [{position:2,marque_modele:'Renault Clio',immatriculation:'XY-456-ZZ',ville_depart:'Nice',ville_arrivee:'Lille'}];
    assert.match(ctx._completerGrouper([{cle:'vehicule_2_vin',statut:'attendue'}])[0].identite,/Renault Clio · XY-456-ZZ · Nice → Lille/);
    assert.match(ctx._completerGrouper([{cle:'vehicule_1_vin',statut:'attendue'}])[0].identite,/Identité non renseignée/);
    vm.runInContext(index.slice(index.indexOf('function _completerSection'),index.indexOf('function _completerRendre')),ctx);
    assert.equal(ctx._completerSection({cle:'vehicule_1_contact_liv_nom'}),'Livraison');
    assert.equal(ctx._completerSection({cle:'vehicule_1_restit_immatriculation'}),'Restitution');
    console.log('PASS cartes séparées, trois couleurs, flèches rouges, message unique, documents repliés, mobile et ordinateur');
  } finally {await b.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
