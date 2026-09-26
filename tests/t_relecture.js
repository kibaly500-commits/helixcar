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
 L.check(width+' modification dans les informations reçues',await page.locator('.completion-known #completer-champ-vehicule_1_vin').count()===1);
 L.check(width+' compteur reçu stable',await page.locator('.completion-known summary').textContent()==='2 informations déjà reçues');
 L.check(width+' champ manquant séparé',await page.locator('.completion-known #completer-champ-vehicule_1_motorisation').count()===0);
 await page.locator('#completer-champ-vehicule_1_vin').fill('');
 L.check(width+' champ reçu vidé reste reçu',await page.locator('.completion-known summary').textContent()==='2 informations déjà reçues'&&await page.locator('.completer-etat').textContent()==='1 à compléter');
 await page.getByRole('button',{name:'Annuler la modification',exact:true}).click();
 L.check(width+' annulation conserve la rubrique ouverte',await page.getByRole('button',{name:'Modifier VIN',exact:true}).isVisible());
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

 }
 }finally{await browser.close();}process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
