const L=require('./lib');
const {urlFichier}=require('./env');
(async()=>{
 const browser=await L.launch();
 try{
  for(const width of [390,1440]){
   const page=await L.newPage(browser);await page.setViewportSize({width,height:1000});
   const animation=await page.evaluate(()=>{
    // Les rectangles CSS sont arrondis à des fractions de pixel. À la
    // frontière exacte, ne pas imposer deux seuils contradictoires (.01/.02).
    // 0.05 px couvre cet arrondi ; les extrémités restent strictement vérifiées.
    function erreurs(p){
     const errors=[];
     document.querySelectorAll('.hero2-route,.loyalty-track').forEach(root=>{
      if(!root.offsetWidth)return;
      const el=root.querySelector('.hc-sync-line'),fill=el.querySelector('.hc-sync-fill').getBoundingClientRect();
      const vertical=el.dataset.direction==='vertical';
      root.querySelectorAll('.hero2-route-dot,.node-circle').forEach((n,i)=>{
       const r=n.getBoundingClientRect(),delta=vertical?r.top+r.height/2-fill.bottom:r.left+r.width/2-fill.right;
       const reached=n.classList.contains('hc-reached');
       if((reached?delta>.05:delta<-.05)||(p===0&&i===0&&!reached)||(p===1&&!reached))
        errors.push({p,i,root:root.className,delta,reached});
      });
     });
     const fill=document.querySelector('.hero2-panel-progress-fill');
     if(Math.abs(parseFloat(fill.style.width)-p*100)>=.01)errors.push({p,progress:fill.style.width});
     return errors;
    }
    const errors=[];
    const middle=document.querySelectorAll('.loyalty-track .node-circle')[2],saved=middle.style.cssText;
    // Régression reproduite : une variation de 1/64 px suffisait à faire
    // échouer l'ancien test alors que la progression était correcte.
    for(const offset of [0,1/64,-1/64]){
     middle.style.position='relative';middle.style.left=offset+'px';middle.style.top=offset+'px';
     for(const p of [0,.1,.249,.5,.749,.99,1]){
      _hcRendreProgressionVitrine(p);errors.push(...erreurs(p));
     }
    }
    middle.style.cssText=saved;
    // Contrôles négatifs : une icône allumée trop tôt ou éteinte trop tard
    // doit toujours être rejetée, malgré la tolérance d'arrondi.
    const nodes=document.querySelectorAll('.loyalty-track .node-circle');
    _hcRendreProgressionVitrine(0);nodes[nodes.length-1].classList.add('hc-reached');
    const premature=erreurs(0).length>0;
    _hcRendreProgressionVitrine(1);nodes[0].classList.remove('hc-reached');
    const late=erreurs(1).length>0;_hcRendreProgressionVitrine(1);
    return {errors,premature,late};
   });
   L.check('Lignes et icônes synchronisées à chaque seuil, largeur '+width,animation.errors.length===0,JSON.stringify(animation.errors));
   L.check('Le contrôle détecte une icône prématurée ou tardive, largeur '+width,animation.premature&&animation.late);
   await L.fillStep1(page,'particulier');await L.chooseService(page,'convoyage');
   const times=await page.evaluate(()=>{
    const now=Date.parse('2026-09-20T12:30:00Z');
    rendreFichesVehicules();
    const date=document.getElementById('veh-0-pc-date');date.value='2026-09-20';
    const at=_hcMinimumHoraireMission('veh-0-pc-heure',now);
    const seconds=_hcMinimumHoraireMission('veh-0-pc-heure',now+20000);
    date.value='2026-09-21';const tomorrow=_hcMinimumHoraireMission('veh-0-pc-heure',now);
    date.value='2026-09-20';const midnight=_hcMinimumHoraireMission('veh-0-pc-heure',Date.parse('2026-09-20T21:45:00Z'));
    const original=Date.now;Date.now=()=>now;
    const h=document.getElementById('veh-0-pc-heure');h.value='14:59';
    const reject=!_hcVerifierDelaiMission();h.value='15:00';const accept=_hcVerifierDelaiMission();
    Date.now=()=>now+60000;const stale=!_hcVerifierDelaiMission();Date.now=()=>now;
    h.value='';_hpOuvrirPicker(h);const openingKeepsEmpty=h.value==='';_hpValiderPicker();const picker=h.value==='15:00';
    var services=true;
    for(const [service,did,hid] of [['stockage','stock-debut','stock-heure-entree'],['nettoyage','nett-date','nett-creneau-debut'],['professionnel','pro-date-debut','pro-horaire-cdeb']]){
      document.querySelector('input[name="type-service"][value="'+service+'"]').checked=true;
      document.querySelector('input[name="stock-acheminement"][value="depot_client"]').checked=true;
      document.querySelector('input[name="stock-sortie"][value="recuperation_client"]').checked=true;
      document.getElementById(did).value='2026-09-20';document.getElementById(hid).value='14:59';
      services=services&&!_hcVerifierDelaiMission();document.getElementById(hid).value='15:00';services=services&&_hcVerifierDelaiMission();
    }
    Date.now=original;
    return {at:at===900,seconds:seconds===901,tomorrow:tomorrow===0,midnight:midnight===1440,reject,accept,stale,openingKeepsEmpty,picker,services};
   });
   Object.entries(times).forEach(([k,v])=>L.check('Délai '+k+' / '+width,v));
   await page.close();
  }
  const p=await L.newPage(browser);
  await p.goto(urlFichier('index.html')+'?nouvelle-demande=1');
  const draft=await p.evaluate(()=>{
   _hcSessionClient={userId:'qa-A'};openModal('client');
   document.getElementById('client-notes').value='Brouillon privé A';_sauvegarderBrouillonClient();
   const a=_lireBrouillonClientValide();_hcSessionClient={userId:'qa-B'};const b=_lireBrouillonClientValide();
   _hcSessionClient=null;const out=_lireBrouillonClientValide();
   _hcSessionClient={userId:'qa-A'};const back=_lireBrouillonClientValide();
   return !!a&&!b&&!out&&back.champs['client-notes'].v==='Brouillon privé A';
  });
  L.check('Brouillons isolés entre comptes, déconnexion et reconnexion',draft);
  await p.goto(urlFichier('index.html'));
  L.check('Vitrine vierge après un brouillon dashboard',await p.evaluate(()=>!_lireBrouillonClientValide()));
  await p.goto(urlFichier('dashboard.html'));
  const dates=await p.evaluate(()=>({summer:_dvDateHeure('2026-09-20T12:43:44.024488'),winter:_dvDateHeure('2026-01-20T12:43:44'),zone:_dvDateHeure('2026-09-20T14:43:44+02:00')}));
  L.check('UTC sans fuseau : heure été exacte',dates.summer==='20/09/2026 à 14:43');
  L.check('UTC sans fuseau : heure hiver exacte',dates.winter==='20/01/2026 à 13:43');
  L.check('Offset existant conservé',dates.zone===dates.summer);
  await p.setViewportSize({width:1440,height:1000});
  const cards=await p.evaluate(()=>{
    const s=document.createElement('section');s.dataset.groupeDemandes='demandes';
    s.innerHTML='<h3>Demandes en cours</h3><div class="hc-demandes-grille" data-plusieurs="true">'+[0,1,2].map(i=>'<article class="hc-demande-card"><div class="hc-demande-summary">Demande '+i+'</div><p class="hc-demande-message">'+(i===0?'Demande reçue':'Informations à compléter pour préparer la prestation')+'</p>'+(i?'<button class="btn">Compléter mes informations</button>':'')+'</article>').join('')+'</div>';
    document.body.appendChild(s);const dims=Array.from(s.querySelectorAll('article')).map(x=>x.getBoundingClientRect());
    return dims.every(r=>Math.abs(r.height-dims[0].height)<1&&Math.abs(r.width-dims[0].width)<1);
  });
  L.check('Cartes de demandes homogènes avec et sans bouton',cards);
  const logout=await p.evaluate(async()=>{
    localStorage.setItem('helixcar_brouillon_public_v3','ancien public');
    const saved=localStorage.getItem('helixcar_brouillon_compte_v3:qa-A');
    window._hcRetourVitrine=function(){};
    await doLogout();
    return !localStorage.getItem('helixcar_brouillon_public_v3') && !!saved
      && localStorage.getItem('helixcar_brouillon_compte_v3:qa-A')===saved;
  });
  L.check('Déconnexion : vitrine remise à zéro, brouillon privé conservé',logout);
 }finally{await browser.close();}
 process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
