const L=require('./lib'),{urlFichier}=require('./env');
(async()=>{const b=await L.launch();try{for(const width of [390,1280]){
const p=await b.newPage({viewport:{width,height:1000}});await p.route('https://**/*',r=>r.abort());
await p.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};});
await p.goto(urlFichier('index.html'));
await p.evaluate(()=>{_completerDemandeId='QA-errors';_completerVerrouillee=false;_completerEditions=new Set();sessionStorage.clear();_completerRendre([1,2].flatMap(n=>[{cle:`vehicule_${n}_restit_contact_tel`,libelle:`Véhicule ${n} — Téléphone restitution`,statut:'attendue'},{cle:`vehicule_${n}_restit_immatriculation`,libelle:`Véhicule ${n} — Immatriculation restitution`,statut:'attendue'}]));openModal('completer');document.querySelectorAll('.completion-card').forEach(e=>e.open=true);});
for(const n of [1,2]){await p.locator(`#completer-champ-vehicule_${n}_restit_immatriculation`).fill('AB-123-CD');await p.locator(`#completer-champ-vehicule_${n}_restit_contact_tel`).fill('DZZDD');}
L.check(width+' téléphones invalides bloqués',await p.locator('#completer-envoyer').isDisabled());
L.check(width+' erreur précise sous chaque téléphone',await p.locator('p.completion-correction:visible').count()===2);
L.check(width+' guide indique les téléphones uniquement',await p.locator('#completer-guide').evaluate(e=>e.textContent.includes('Téléphone restitution')&&!e.textContent.includes('Immatriculation')));
L.check(width+' immatriculation remplie sans faux message manquant',!(await p.locator('#completer-champ-vehicule_2_restit_immatriculation-label').getAttribute('title')).includes('manquante'));
await p.locator('#completer-champ-vehicule_1_restit_contact_tel').fill('06 12 34 56 78');
L.check(width+' second véhicule reste bloquant',await p.locator('#completer-envoyer').isDisabled());
await p.locator('#completer-champ-vehicule_2_restit_contact_tel').fill('+33 6 12 34 56 78');
L.check(width+' validation débloquée',await p.locator('#completer-envoyer').isEnabled());
L.check(width+' erreurs effacées',await p.locator('p.completion-correction:visible').count()===0);
await p.close();}}finally{await b.close();}process.exitCode=L.results()?1:0;})().catch(e=>{console.error(e);process.exitCode=1});
