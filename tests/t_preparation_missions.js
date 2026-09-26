const assert=require('assert'),L=require('./lib'),{urlFichier}=require('./env');const planner=require('../assets/preparation-missions.js');
const v={id:'veh-1',position:1,type_vehicule:'berline',marque_modele:'Peugeot 308',immatriculation:'SECRET-PLATE',vin:'SECRET-VIN',adresse_depart_rue:'12 rue Secrète',adresse_arrivee_rue:'10 rue Cachée',ville_depart:'Paris',ville_arrivee:'Lyon',date_prise_en_charge:'2026-11-08',date_livraison:'2026-11-10',heure_prise_en_charge:'09:00',pc_heure_type:'creneau',pc_creneau_debut:'09:00',pc_creneau_fin:'11:00',heure_livraison:'15:00',restitution_concernee:true,restit_marque_modele:'Audi A3',restit_ville:'Dijon',restit_date:'2026-11-10',restit_heure_type:'creneau',restit_creneau_debut:'16:00',restit_creneau_fin:'17:00',restit_contraintes:'Clefs secrètes',restit_immatriculation:'SECRET-RESTIT'};
const c={id:'client-1',type_service:'convoyage',type_client:'professionnel',societe:'SECRET-SOCIETE',notes:'SECRET-NOTE',stockage_date_debut:'2026-11-08',stockage_date_fin:'2026-11-13',stockage_acheminement:'helixcar',stockage_sortie:'helixcar'};
(async()=>{
 for(const [days,count] of [[0,1],[1,1],[2,1],[3,2],[5,2]]){const x=planner.build(c,[{...v,date_livraison:'2026-11-'+String(8+days).padStart(2,'0')}]);L.check('Seuil automatique '+days+' jours',x.length===count);if(days>2)L.check('Restitution sur le trajet final seulement',!x[0].mission.restitution&&x[1].mission.restitution);}
 for(const [inMode,outMode,n] of [['client','client',0],['helixcar','client',1],['client','helixcar',1],['helixcar','helixcar',2]]){const x=planner.build({...c,type_service:'stockage',stockage_acheminement:inMode,stockage_sortie:outMode},[v]);L.check('Stockage '+inMode+'/'+outMode,x.length===n);}
 const override=planner.build({...c,type_service:'stockage'},[{...v,livraison_apres_stockage:false}]);L.check('Choix individuel sans livraison respecté',override.length===1&&override[0].kind==='avant_stockage');
 const split=planner.build(c,[{...v,date_livraison:'2026-11-14'}],'12 rue de l’Université, 93160 Noisy-le-Grand');
 L.check('Deux trajets présentés comme convoyages',split.every(p=>p.title==='Convoyage automobile'&&!JSON.stringify(planner.publicData(p)).includes('stockage')));
 L.check('Point de remise réservé au privé',split[0].mission.adresse_arrivee.includes('12 rue')&&!JSON.stringify(planner.publicData(split[0])).includes('12 rue'));
 const invalidAfter=planner.build({...c,type_service:'stockage'},[{...v,date_livraison:'2026-11-10'}]);
 L.check('Livraison avant sortie du stockage bloquée',invalidAfter[1].missing.includes('Livraison antérieure à la prise en charge'));
 const p=planner.build(c,[v])[0];L.check('Consignes restitution administratives conservées',p.mission.restit_info==='Clefs secrètes');L.check('Projection publique sans données privées',!JSON.stringify(planner.publicData(p)).includes('SECRET')&&!JSON.stringify(planner.publicData(p)).includes('rue'));
 L.check('Tiret entre horaires',planner.publicData(p).rows.some(r=>r.value.includes('16:00 - 17:00')));
 const clean={...c,type_service:'nettoyage',nettoyage_details:{type_nettoyage:'interieur_exterieur',nombre_vehicules_approx:4,adresse_ville:'Créteil',date_souhaitee:'2026-11-08',date_fin:'2026-11-08',creneau_debut:'09:00',creneau_fin:'12:00'}};
 const prof={...c,type_service:'professionnel',professionnel_details:{categorie:'technicien',specialite:'diagnostic',nombre_professionnels:2,adresse_ville:'Nanterre',date_debut:'2026-11-08',date_fin:'2026-11-09',heure_debut:'09:00',heure_fin:'17:00'}};
 for(const sample of [clean,prof]){const x=planner.build(sample,[])[0];L.check(sample.type_service+' : pas de trajet artificiel',x.kind==='intervention'&&!('ville_depart' in x.mission));L.check(sample.type_service+' : données préremplies',x.rows.some(r=>r.value.includes('09:00 - ')));}
 L.check('Professionnels : métier et nombre repris',planner.build(prof,[])[0].category==='technicien'&&planner.build(prof,[])[0].nb_professionnels===2);
 const browser=await L.launch();try{for(const width of [390,1280]){const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async()=>({data:null})})};});await page.goto(urlFichier('dashboard.html'));
 await page.evaluate(({c,v})=>{window.__calls=[];window.__source={client:c,vehicules:[v],devis_id:'dv1',reference:'DEV-QA',empreinte:'hash',brouillons:[]};sbAuth.rpc=async(name,args)=>{__calls.push(name);if(name==='source_preparation_missions')return {data:__source};if(name==='enregistrer_preparation_missions'){__source.brouillons=args.p_plans.map((p,i)=>({id:'p'+i,cle:p.key,empreinte:'hash',plan:p,annonce:p.public}));return {data:__source};}throw Error('Publication interdite dans ce test');};document.getElementById('login-screen').style.display='none';_devisParClient[c.id]={statut:'accepte',paiement_statut:'paye'};}, {c,v});
 const button=await page.evaluate(c=>_blocDevisHtml(c),c);L.check(width+' bouton depuis devis payé',button.includes('Préparer les missions'));
 await page.evaluate(()=>ouvrirPreparationDemande('client-1'));L.check(width+' ouverture sans mutation',await page.evaluate(()=>__calls.join()==='source_preparation_missions'));
 L.check(width+' heure de prise en charge préremplie',await page.locator('[data-field="heure_prise_en_charge"]').inputValue()==='09:00');
 await page.locator('[data-field="remuneration"]').fill('250');await page.locator('[data-field="distance"]').fill('465');await page.locator('[data-field="motorisation"]').selectOption('Hybride');await page.locator('[data-field="restit_motorisation"]').selectOption('Essence');await page.locator('[data-prep-view="preview"]').first().click();
 const content=await page.locator('#hc-prep-body').innerText();L.check(width+' aperçu filtré avec prix total',content.includes('250')&&!content.includes('SECRET')&&!content.includes('rue'));
 L.check(width+' créneau de départ conservé',content.includes('09:00 - 11:00'));
 L.check(width+' modèle dans le bon trajet',await page.locator('[aria-label="Livraison"] .hc-prep-leg-facts').innerText().then(t=>t.includes('Peugeot 308')&&!t.includes('Audi A3'))&&await page.locator('[aria-label="Restitution"] .hc-prep-leg-facts').innerText().then(t=>t.includes('Audi A3')&&!t.includes('Peugeot 308')));
 L.check(width+' flèche centrée sur les villes',await page.locator('.hc-prep-route').first().evaluate(e=>{const city=e.querySelector('.hc-prep-city').getBoundingClientRect(),arrow=e.querySelector('.hc-prep-direction').getBoundingClientRect();return Math.abs(city.y+city.height/2-arrow.y-arrow.height/2)<2;}));
 L.check(width+' restitution : horaire sous la ville d’arrivée',await page.locator('[aria-label="Restitution"] .hc-prep-route>div').last().innerText().then(t=>t.includes('Dijon')&&t.includes('16:00 - 17:00')));
 L.check(width+' cartes sans débordement',await page.locator('.hc-prep-annonce').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 await page.locator('#hc-prep-body').screenshot({path:'/tmp/hc-preparation-apercu-'+width+'.png'});
 const absentHour=await page.evaluate(()=>hcPreparationCarteOpportunite({id:'qa-empty-time',preparation_annonce:{category:'convoyage',rows:[{label:'Départ',value:'Paris'},{label:'Arrivée',value:'Lyon'},{label:'Prise en charge',value:'2026-11-08'}]}},{}));
 L.check(width+' horaire absent signalé',absentHour.includes('Heure à préciser'));
 L.check(width+' aperçu ne publie pas',await page.evaluate(()=>!__calls.includes('publier_preparation_mission')));
 await page.locator('#hc-prep-close').click();await page.evaluate(()=>ouvrirPreparationDemande('client-1'));L.check(width+' brouillon retrouvé',await page.locator('[data-field="remuneration"]').inputValue()==='250');
 L.check(width+' sans débordement',await page.locator('#modal-preparation-missions .hc-prep-modal').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 await page.evaluate(async()=>{__source.brouillons=[];__source.vehicules[0].vin=null;await ouvrirPreparationDemande('client-1');});
 await page.locator('.hc-prep-private summary').click();
 L.check(width+' VIN manquant affiché dans les informations privées',await page.locator('.hc-prep-private').innerText().then(t=>t.includes('VIN du véhicule livré')&&t.includes('À compléter dans la demande')));
 const filtering=await page.evaluate(()=>{
   _demandesDevisListe=[{id:'a',nom:'Alpha',email:'a@example.test'},{id:'b',nom:'Beta',email:'b@example.test'},{id:'c',nom:'Gamma',email:'a@example.test'}];
   _devisParClient={a:{statut:'accepte',paiement_statut:'en_attente'},b:{statut:'accepte',paiement_statut:'paye'},c:{statut:'envoye',consulte_le:'2026-09-01'}};
   const select=document.getElementById('filtre-statut-devis');const out={};
   for(const key of ['accepte','paye','consulte']){select.value=key;filtrerDemandesDevis('');out[key]=document.getElementById('tbody-demandes-devis').innerText;}
   select.value='paye';filtrerDemandesDevis('Alpha');out.search=document.getElementById('tbody-demandes-devis').innerText;
   _filtreDemandesCompteAdmin={email:'a@example.test'};filtrerDemandesDevis('');out.owner=document.getElementById('tbody-demandes-devis').innerText;
   select.value='';_filtreDemandesCompteAdmin=null;return out;
 });
 L.check(width+' filtre accepté exclut payé',filtering.accepte.includes('Alpha')&&!filtering.accepte.includes('Beta'));
 L.check(width+' filtre payé',filtering.paye.includes('Beta')&&!filtering.paye.includes('Alpha'));
 L.check(width+' filtre consulté',filtering.consulte.includes('Gamma')&&!filtering.consulte.includes('Beta'));
 L.check(width+' filtres recherche et compte respectés',filtering.search.includes('Aucune demande')&&filtering.owner.includes('Aucune demande'));
 if(width===1280)await page.screenshot({path:'/tmp/hc-preparation-integree.png',fullPage:true});L.check(width+' sans exception JS',errors.length===0);await page.close();}
 }finally{await browser.close();}process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1});
