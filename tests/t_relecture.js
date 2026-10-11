const L=require('./lib'),{urlFichier}=require('./env');
(async()=>{const browser=await L.launch();try{
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:1100}});await page.route('https://**/*',r=>r.abort());
 await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};});
 await page.goto(urlFichier('index.html')); 
 await page.evaluate(()=>{
  _completerDemandeId='QA';_completerVerrouillee=false;_completerEditions=new Set();sessionStorage.clear();window.__sent=[];
  window.__lines=[{cle:'vehicule_1_vin',libelle:'Véhicule 1 — VIN',valeur:'VF111111111111111',statut:'fournie'},{cle:'vehicule_1_adresse_depart',libelle:'Véhicule 1 — Adresse de départ',valeur:'12 rue Départ',statut:'fournie'},{cle:'vehicule_1_motorisation',libelle:'Véhicule 1 — Motorisation',valeur:null,statut:'attendue'}];
  _sb.rpc=async(n,args)=>{if(n==='modifier_information_demande'){if(window.__failEditOnce){window.__failEditOnce=false;throw Error('Réseau indisponible');}__sent.push({[args.p_cle]:args.p_valeur});var l=__lines.find(x=>x.cle===args.p_cle);l.valeur=args.p_valeur;l.statut='transmise';return {data:1};}if(n==='repondre_informations_demande'){__sent.push(args.p_reponses);for(const l of __lines){if(l.cle in args.p_reponses){l.valeur=args.p_reponses[l.cle];l.statut='transmise';}}return {data:Object.keys(args.p_reponses).length};}return {data:__lines};};
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
 await page.getByRole('button',{name:'Annuler',exact:true}).click();
 L.check(width+' annulation conserve la rubrique ouverte',await page.getByRole('button',{name:'Modifier VIN',exact:true}).isVisible());
 await page.getByRole('button',{name:'Modifier VIN',exact:true}).click();
 await page.locator('#completer-champ-vehicule_1_vin').fill('VF222222222222222');
 L.check(width+' bouton global bloqué par les champs manquants',await page.locator('#completer-envoyer').isDisabled());
 L.check(width+' libellé sans doublon',await page.locator('.completion-known .modal-form-group label').count()===0);
 await page.locator('#modal-completer').screenshot({path:'/tmp/hc-edit-buttons-'+width+'.png'});
 await page.evaluate(()=>{window.__failEditOnce=true;});
 await page.getByRole('button',{name:'Valider la modification',exact:true}).click();
 await page.waitForFunction(()=>!_completerEnvoiEnCours);
 L.check(width+' erreur conserve la saisie sans faux succès',await page.locator('#completer-champ-vehicule_1_vin').inputValue()==='VF222222222222222'&&await page.locator('.completion-pending').count()===0);
 await page.getByRole('button',{name:'Valider la modification',exact:true}).click();
 await page.waitForFunction(()=>!_completerEnvoiEnCours);
 L.check(width+' modification envoyée seule',await page.evaluate(()=>__sent.length===1&&Object.keys(__sent[0]).join()==='vehicule_1_vin'));
 L.check(width+' attente visible dans informations reçues',await page.locator('.completion-known .completion-pending').innerText()==='En attente de validation par HelixCar');
 L.check(width+' compteur reçu reste stable après envoi',await page.locator('.completion-known summary').textContent()==='2 informations déjà reçues');
 L.check(width+' bouton global toujours bloqué',await page.locator('#completer-envoyer').isDisabled());
 await page.locator('#modal-completer').screenshot({path:'/tmp/hc-inline-edit-'+width+'.png'});
 for(const value of ['VF333333333333333','VF444444444444444']){
  await page.evaluate(()=>{__lines[0].statut='validee';_completerRendre(__lines);});
  await page.getByRole('button',{name:'Modifier VIN',exact:true}).click();
  await page.locator('#completer-champ-vehicule_1_vin').fill(value);
  await page.getByRole('button',{name:'Valider la modification',exact:true}).click();
  await page.waitForFunction(()=>!_completerEnvoiEnCours);
  L.check(width+' nouvelle modification après validation '+value,await page.locator('.completion-known .completion-pending').isVisible()&&await page.evaluate(v=>__lines[0].valeur===v,value));
  L.check(width+' champs manquants toujours bloquants '+value,await page.locator('#completer-envoyer').isDisabled());
 }
 await page.evaluate(()=>{__lines[0].statut='a_corriger';__lines[0].commentaire='Vérifiez le VIN';_completerRendre(__lines);});
 L.check(width+' motif du refus visible',(await page.locator('.completion-correction').innerText()).includes('Vérifiez le VIN'));
 await page.locator('#completer-champ-vehicule_1_vin').fill('VF555555555555555');
 await page.getByRole('button',{name:'Valider la correction',exact:true}).click();
 await page.waitForFunction(()=>!_completerEnvoiEnCours);
 L.check(width+' correction seule transmise',await page.evaluate(()=>__sent.length===4&&__lines[0].statut==='transmise'&&__lines[0].valeur==='VF555555555555555'));
 L.check(width+' correction en attente et autres champs bloquants',await page.locator('.completion-pending').isVisible()&&await page.locator('#completer-envoyer').isDisabled());
 await page.locator('.completion-choices').getByRole('button',{name:'Diesel',exact:true}).click();
 await page.locator('#completer-envoyer').click();
 L.check(width+' confirmation avant envoi',await page.locator('.hc-completion-confirm').isVisible()&&await page.evaluate(()=>__sent.length===4));
 await page.locator('.hc-completion-confirm').screenshot({path:'/tmp/hc-confirmation-'+width+'.png'});
 await page.locator('.hc-completion-confirm [data-cancel]').click();
 L.check(width+' annulation conserve la saisie',(await page.locator('.completion-known').innerText()).includes('VF555555555555555'));
 await page.locator('#completer-envoyer').click();await page.locator('.hc-completion-confirm [data-confirm]').click();
 await page.waitForFunction(()=>__sent.length===5&&!_completerEnvoiEnCours);
 L.check(width+' envoi limité aux champs autorisés',await page.evaluate(()=>Object.keys(__sent[4]).join()==='vehicule_1_motorisation'));
 L.check(width+' dossier verrouillé après confirmation',await page.locator('.completion-edit').count()===0&&await page.locator('#completer-envoyer').isHidden());
 await page.close();

 }
 }finally{await browser.close();}process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
