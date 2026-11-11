const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const L=require('./lib');
const ctx={setInterval(){}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(L.fichier('assets/admin-demandes-informations.js'),'utf8'),ctx);
const resume=(l,m={},c=true)=>JSON.parse(JSON.stringify(ctx._resumerInfosDemande(l,m,c)));
assert.equal(resume([{statut:'fournie'}])[0].cle,'complet');
assert.equal(resume([{statut:'validee'}])[0].cle,'complet');
assert.equal(resume([{statut:'fournie'}],{},false)[0].cle,'confirmation');
assert.equal(resume([])[0].cle,'indisponible');
assert.equal(resume([{statut:'inconnu'}])[0].cle,'indisponible');
const mixed=resume([{cle:'vin',statut:'attendue'},{cle:'tel',statut:'transmise'},{cle:'nom',statut:'transmise'},{cle:'plaque',statut:'transmise'},{cle:'adresse',statut:'a_corriger'}],{nom:{ancienne_valeur:'Ancien nom'},plaque:{ancienne_valeur:'Ancienne plaque',correction_recue:true}});
assert.deepEqual(mixed.map(e=>e.cle),['corrections','modifications','nouvelles','a_corriger','manquantes']);
assert.equal(mixed.some(e=>e.cle==='complet'),false);
(async()=>{const b=await L.launch();try{
const p=await b.newPage({viewport:{width:1440,height:900}});await p.route('**/*',r=>/^(file:|about:|data:)/.test(r.request().url())?r.continue():r.abort());await p.goto(L.urlFichier('dashboard.html'));
await p.evaluate(()=>{
 currentRole='admin';_sbAuthPret=()=>true;
 _demandesDevisListe=[{id:'a',numero_client:'HC-A',type_service:'stockage'},{id:'b',numero_client:'HC-B',type_service:'nettoyage'},{id:'c',numero_client:'HC-C',type_service:'convoyage'}];
 _devisParClient={a:{statut:'accepte',paiement_statut:'paye'}};
 sbFetchToutePage=async path=>path.startsWith('clients?')?[{id:'a',informations_confirmees_le:'2026-09-26'},{id:'b',informations_confirmees_le:'2026-09-26'},{id:'c'}]:[{client_id:'a',cle:'nom',ancienne_valeur:'Ancien nom'}];
 chargerInfosDemandeAdmin=async id=>id==='a'?[{cle:'vin',statut:'attendue'},{cle:'nom',statut:'transmise'}]:id==='b'?[{cle:'contact',statut:'validee'}]:[];
});
await p.evaluate(()=>_chargerEtatsInformationsDemandes());
let text=await p.locator('#tbody-demandes-devis').innerText();assert.match(text,/Informations modifiées/);assert.match(text,/Champs manquants/);assert.match(text,/Dossier complet/);assert.match(text,/État non disponible/);assert.match(text,/DEVIS PAYÉ/);
await p.evaluate(()=>{document.getElementById('filtre-informations-devis').value='modifications';filtrerDemandesDevis('');});text=await p.locator('#tbody-demandes-devis').innerText();assert.match(text,/HC-A/);assert.doesNotMatch(text,/HC-B|HC-C/);
await p.evaluate(()=>{document.getElementById('filtre-informations-devis').value='complet';filtrerDemandesDevis('');});assert.match(await p.locator('#tbody-demandes-devis').innerText(),/HC-B/);
await p.evaluate(()=>{chargerInfosDemandeAdmin=async()=>{throw Error('réseau')};return _chargerEtatsInformationsDemandes()});assert.match(await p.locator('#tbody-demandes-devis').innerText(),/Aucune demande/);
await p.evaluate(()=>{document.getElementById('filtre-informations-devis').value='indisponible';filtrerDemandesDevis('');});assert.match(await p.locator('#tbody-demandes-devis').innerText(),/Chargement impossible/);
await p.evaluate(()=>{
 document.getElementById('filtre-informations-devis').value='';
 _demandesDevisListe=[
  {id:'ancien',numero_client:'HC-ANCIEN',created_at:'2026-01-01',activite_demande_le:'2026-09-27T12:00:00.123456Z',vue_admin_at:null},
  {id:'nouveau',numero_client:'HC-NOUVEAU',created_at:'2026-09-27T11:00:00Z',activite_demande_le:'2026-09-27T11:00:00Z',vue_admin_at:null}];
 _devisParClient={ancien:{statut:'accepte',paiement_statut:'paye'}};filtrerDemandesDevis('');
});
assert.match(await p.locator('#tbody-demandes-devis tr').first().innerText(),/HC-ANCIEN/);
assert.match(await p.locator('#tbody-demandes-devis tr').first().innerText(),/Non lu/);
await p.evaluate(async()=>{
 window._requeteLecture='';sbFetch=async(path,opts)=>{window._requeteLecture=path;return [{..._demandesDevisListe[0],vue_admin_at:JSON.parse(opts.body).vue_admin_at}];};
 await _ecrireEtatLecture('ancien','2026-09-27T12:01:00Z','Échec');
});
assert.match(await p.evaluate(()=>window._requeteLecture),/activite_demande_le=eq.2026-09-27T12%3A00%3A00.123456Z/);
assert.equal(await p.locator('#tbody-demandes-devis tr').first().getAttribute('class'),null);
// Une nouveauté simultanée empêche le PATCH de marquer cette nouvelle version lue.
await p.evaluate(async()=>{
 sbFetch=async()=>[];
 loadDemandesDevis=async()=>{_demandesDevisListe[0].vue_admin_at=null;_demandesDevisListe[0].activite_demande_le='2026-09-27T12:02:00Z';filtrerDemandesDevis('');};
 await _ecrireEtatLecture('ancien','2026-09-27T12:01:00Z','Échec');
});
assert.equal(await p.locator('#tbody-demandes-devis tr').first().getAttribute('class'),'demande-non-lue');
console.log('PASS : états simples et mixtes, modifications/corrections, paiement indépendant, filtres, actualisation et erreurs sans faux complet');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
