/* Admin-only arrival checks, calculated and retained by the server. */
(function(){
 'use strict';
 let rows=[],ticket=0;
 const esc=x=>escapeHtml(String(x??''));
 const km=x=>x==null?'Non renseigné':Number(x).toLocaleString('fr-FR')+' km';
 function card(r){
  const labels={normal:'Écart inférieur au seuil',orange:'Dépassement à vérifier',rouge:'Dépassement important',incomplet:'Contrôle impossible : données manquantes',incoherent:'Relevés kilométriques incohérents'};
  return '<section class="hc-km hc-km-'+esc(r.niveau)+'"><strong>'+esc(r.phase==='restitution_arrivee'?'Restitution':'Livraison')+' · '+esc(labels[r.niveau]||'Contrôle à vérifier')+'</strong><dl><div><dt>Compteur départ</dt><dd>'+esc(km(r.km_depart))+'</dd></div><div><dt>Compteur arrivée</dt><dd>'+esc(km(r.km_arrivee))+'</dd></div><div><dt>Distance prévue</dt><dd>'+esc(km(r.distance_prevue))+'</dd></div><div><dt>Distance parcourue</dt><dd>'+esc(km(r.distance_reelle))+'</dd></div><div><dt>Écart</dt><dd>'+esc(r.ecart==null?'Non calculable':(Number(r.ecart)>0?'+':'')+km(r.ecart))+'</dd></div></dl><small>Contrôle à l’état des lieux d’arrivée. Un écart nécessite une vérification ; il ne prouve pas un usage abusif.</small></section>';
 }
 function overview(){
  for(const id of ['page-admin-dashboard','page-admin-operations']){
   const page=document.getElementById(id);if(!page)continue;
   let box=page.querySelector('[data-km-overview]');if(!box){box=document.createElement('div');box.dataset.kmOverview='';box.className='card';page.prepend(box);}
   const alerts=rows.filter(r=>r.niveau!=='normal'),red=alerts.filter(r=>r.niveau==='rouge').length;
   const open=box.querySelector('details')?.open;
   box.innerHTML='<details'+(open?' open':'')+'><summary class="hc-km-summary">Contrôles kilométriques · '+alerts.length+' à vérifier'+(red?' · '+red+' rouge(s)':'')+'</summary><p>Orange dès +60 km · Rouge dès +100 km. Livraison et restitution contrôlées séparément.</p>'+(alerts.length?alerts.map(r=>'<div><button class="btn btn-outline" data-km-mission="'+esc(r.mission_id)+'">'+esc(r.missions?.reference_courte||'Voir la mission')+'</button>'+card(r)+'</div>').join(''):'<p>Aucune alerte enregistrée.</p>')+'</details>';
  }
 }
 window.HCKm={
  async load(){
   if(currentRole!=='admin')return;const n=++ticket,cycle=window.HCSync?.capture();
   try{const data=await sbFetchToutePage('controles_kilometriques?select=*,missions(reference_courte)&order=created_at.desc');
    if(n!==ticket||currentRole!=='admin'||cycle&&!window.HCSync.safe(cycle))return;
    rows=data;overview();
   }catch(e){if(n===ticket&&currentRole==='admin')for(const id of ['page-admin-dashboard','page-admin-operations']){let page=document.getElementById(id),box=page?.querySelector('[data-km-overview]');if(!box&&page){box=document.createElement('div');box.dataset.kmOverview='';page.prepend(box);}if(box)box.textContent='Contrôles kilométriques indisponibles. Actualisez pour réessayer.';}}
  },
  detail(id){return rows.filter(r=>r.mission_id===id).map(card).join('');}
 };
 document.addEventListener('click',e=>{const b=e.target.closest('[data-km-mission]');if(b)window.HCMissions?.openMission(b.dataset.kmMission);});
 window.addEventListener('hc-session-fermee',()=>{ticket++;rows=[];document.querySelectorAll('[data-km-overview]').forEach(x=>x.remove());});
})();
