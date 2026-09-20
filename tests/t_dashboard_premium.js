// Données fictives, aucune connexion ni écriture distante.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'../dashboard.html'),'utf8');
const section=src.slice(src.indexOf('// Informations manquantes : les valeurs'),src.indexOf('function rendreCentreInformationsAdmin'));
(async()=>{
 const status={textContent:''},calls=[];
 const ctx={currentRole:'admin',_sbAuthPret:()=>true,document:{getElementById:()=>status},rendreCentreInformationsAdmin:()=>{},
 sbAuth:{from:()=>({select(){return this},in(){return this},order(){return this},range:async()=>({data:[],error:null})})},
 sbAuthListeDevisTriee:async()=>[
  {client_id:'paid',statut:'accepte',paiement_statut:'paye'},
  {client_id:'unpaid',statut:'accepte',paiement_statut:'en_attente'},
  {client_id:'complete',statut:'accepte',paiement_statut:'paye'},
  {client_id:'old',statut:'accepte',paiement_statut:'rembourse'},
  {client_id:'old',statut:'accepte',paiement_statut:'paye'}],
 sbFetchToutePage:async(q)=>q.startsWith('clients?')?['paid','unpaid','complete','old'].map(id=>({id})):[{dossier_id:'paid',position:1,marque_modele:'Peugeot 308',immatriculation:'AB-123-CD'}],
 chargerInfosDemandeAdmin:async(id)=>{calls.push(id);return [{cle:'vehicule_1_vin',statut:id==='complete'?'validee':'attendue'}];}};
 vm.createContext(ctx);vm.runInContext(section,ctx);await ctx.chargerCentreInformationsAdmin();
 assert.deepStrictEqual(Array.from(ctx._adminInfosDossiers,d=>d.client.id),['paid']);
 assert.deepStrictEqual(calls,['paid','complete']);
 assert.equal(ctx._adminInfosDossiers[0].client.vehicules[0].immatriculation,'AB-123-CD');
 ctx.sbAuthListeDevisTriee=async()=>{throw Error('offline')};await ctx.chargerCentreInformationsAdmin();
 assert(status.textContent.includes('Impossible'));console.log('PASS paid-only, unpaid/refunded excluded, complete hidden, vehicle identity, read failure');
 const {lancerNavigateur}=require('./env');const b=await lancerNavigateur();
 try{
 const p=await b.newPage();await p.route('**/*',r=>r.abort());await p.setContent(src);
 await p.evaluate(logo=>{document.getElementById('login-screen').remove();document.getElementById('app').classList.add('visible');document.querySelector('.sidebar-logo img').src=logo;},'data:image/png;base64,'+fs.readFileSync(require('path').join(__dirname,'../logo-helixcar.png')).toString('base64'));
 for(const role of ['admin','client','convoyeur'])for(const width of [390,1440]){
  await p.setViewportSize({width,height:900});
  await p.evaluate(role=>{document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById('page-'+role+'-dashboard').classList.add('active');document.getElementById('sidebar-nav').innerHTML='<button class="nav-item active">Tableau de bord</button><button class="nav-item">Mes missions</button>';},role);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.screenshot({path:'/tmp/helixcar-premium-'+role+'-'+width+'.png',fullPage:true});
  console.log('PASS layout '+role+' '+width);
 }
 await p.setViewportSize({width:1440,height:1100});
 await p.evaluate(()=>{
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-admin-infos').classList.add('active');
  _adminInfosDossiers=[{client:{id:'demo',prenom:'Camille',nom:'Martin',numero_client:'DEMO-001',vehicules:[{position:1,immatriculation:'AB-123-CD',marque_modele:'Peugeot 308',ville_depart:'Paris',ville_arrivee:'Lyon'}]},lignes:[{cle:'vehicule_1_vin',libelle:'VIN',statut:'attendue'},{cle:'vehicule_1_contact_pc_nom',libelle:'Contact au départ',valeur:'Alex Martin',statut:'transmise'}]}];
  _adminInfosSelection='demo';rendreCentreInformationsAdmin();
 });
 assert((await p.locator('.ai-vehicle').textContent()).includes('AB-123-CD · Peugeot 308'));
 assert(await p.getByText('Paris → Lyon',{exact:true}).count());
 await p.screenshot({path:'/tmp/helixcar-premium-infos-1440.png',fullPage:true});
 console.log('PASS rendered vehicle identity and route');
 }finally{await b.close();}
 console.log('=== 13 PASS / 0 FAIL ===');
})().catch(e=>{console.error(e);process.exitCode=1;});
