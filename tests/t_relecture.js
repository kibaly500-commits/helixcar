const L=require('./lib'),{urlFichier}=require('./env');
(async()=>{const browser=await L.launch();try{
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:1100}});await page.route('https://**/*',r=>r.abort());
 await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};});
 await page.goto(urlFichier('index.html')); 
 await page.evaluate(()=>{
  _completerDemandeId='QA';_completerVerrouillee=false;_completerEditions=new Set();sessionStorage.clear();window.__sent=[];
  window.__lines=[{cle:'vehicule_1_vin',libelle:'Véhicule 1 — VIN',valeur:'VF111111111111111',statut:'fournie'},{cle:'vehicule_1_adresse_depart',libelle:'Véhicule 1 — Adresse de départ',valeur:'12 rue Départ',statut:'fournie'},{cle:'vehicule_1_motorisation',libelle:'Véhicule 1 — Motorisation',valeur:null,statut:'attendue'}];
  _sb.rpc=async(n,args)=>{if(n==='repondre_informations_demande'){__sent.push(args.p_reponses);for(const l of __lines){if(l.cle in args.p_reponses){l.valeur=args.p_reponses[l.cle];l.statut='transmise';}}return {data:Object.keys(args.p_reponses).length};}return {data:__lines};};
  _completerRendre(__lines);openModal('completer');
 });
 await page.locator('.completion-known summary').click();
 L.check(width+' vraie valeur lisible',(await page.locator('.completion-received').innerText()).includes('12 rue Départ'));
 L.check(width+' adresse sans crayon',await page.getByRole('button',{name:'Modifier Adresse de départ',exact:true}).count()===0);
 await page.getByRole('button',{name:'Modifier VIN',exact:true}).click();
 await page.locator('#completer-champ-vehicule_1_vin').fill('VF222222222222222');
 await page.locator('.completion-choices').getByRole('button',{name:'Diesel',exact:true}).click();
 await page.locator('#completer-envoyer').click();
 L.check(width+' confirmation avant envoi',await page.locator('.hc-completion-confirm').isVisible()&&await page.evaluate(()=>__sent.length===0));
 await page.locator('.hc-completion-confirm').screenshot({path:'/tmp/hc-confirmation-'+width+'.png'});
 await page.locator('.hc-completion-confirm [data-cancel]').click();
 L.check(width+' annulation conserve la saisie',await page.locator('#completer-champ-vehicule_1_vin').inputValue()==='VF222222222222222');
 await page.locator('#completer-envoyer').click();await page.locator('.hc-completion-confirm [data-confirm]').click();
 await page.waitForFunction(()=>__sent.length===1&&!_completerEnvoiEnCours);
 L.check(width+' envoi limité aux champs autorisés',await page.evaluate(()=>Object.keys(__sent[0]).sort().join()===['vehicule_1_motorisation','vehicule_1_vin'].sort().join()));
 L.check(width+' dossier verrouillé après confirmation',await page.locator('.completion-edit').count()===0&&await page.locator('#completer-envoyer').isHidden());
 await page.close();
 const admin=await browser.newPage({viewport:{width,height:1100}});await admin.route('https://**/*',r=>r.abort());
 await admin.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};});
 await admin.goto(urlFichier('dashboard.html'));
 await admin.evaluate(()=>{document.getElementById('login-screen').style.display='none';document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.getElementById('page-admin-dashboard').classList.add('active');document.getElementById('app').style.setProperty('display','flex');_adminInfosDossiers=[{client:{id:'qa',prenom:'Client',nom:'QA',numero_client:'HC-QA'},lignes:[{cle:'vehicule_1_vin',libelle:'Véhicule 1 — VIN',statut:'transmise',ancienne_valeur:'VF111111111111111',valeur:'VF222222222222222',correction_recue:true,commentaire:'Vérifiez le VIN'},{cle:'vehicule_2_motorisation',libelle:'Véhicule 2 — Motorisation',statut:'attendue'},{cle:'vehicule_1_contact_pc_nom',libelle:'Véhicule 1 — Contact départ',statut:'transmise',valeur:'Nouveau contact',ancienne_valeur:'Ancien contact'}]}];rendreAccueilInformationsAdmin();});
 const text=await admin.locator('#admin-infos-accueil-liste').textContent();
 L.check(width+' synthèse avant/après sans ouvrir devis',text.includes('VF111111111111111')&&text.includes('VF222222222222222')&&text.includes('Ancien contact')&&text.includes('Véhicule 2 — Motorisation'));
 L.check(width+' compteurs distincts',await admin.locator('#admin-infos-accueil-compteurs strong').allTextContents().then(x=>x.join()==='1,1,1'));
 await admin.locator('#admin-infos-accueil-filtre').evaluate(e=>{e.value='correction';e.dispatchEvent(new Event('change'));});
 L.check(width+' filtre corrections reçues',await admin.locator('.ai-home-dossier').count()===1&&await admin.locator('.ai-home-dossier').innerText().then(t=>t.includes('VF222222222222222')&&!t.includes('Ancien contact')&&!t.includes('Motorisation')));
 L.check(width+' accueil sans débordement',await admin.locator('.ai-home').evaluate(e=>e.scrollWidth<=e.clientWidth));
 await admin.locator('.ai-home').screenshot({path:'/tmp/hc-admin-relecture-'+width+'.png'});
 await admin.close();
 }
 }finally{await browser.close();}process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
