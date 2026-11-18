/* Documents privés et contrôle final : une seule validation ouvre la facturation. */
(function(){
 'use strict';
 const esc=v=>escapeHtml(String(v??''));
 const phases={depart:'Départ',arrivee:'Arrivée',restitution_depart:'Restitution · départ',restitution_arrivee:'Restitution · arrivée'};
 const etats={recu:'Reçu',valide:'Validé',a_corriger:'À corriger',remplace:'Remplacé'};
 let active=null,version=0;
 async function rpc(name,args){const r=await sbAuth.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;}
 const button=(text,attr)=>'<button type="button" class="btn btn-outline" '+attr+'>'+text+'</button>';
 function create(title){
  active?.close();const d=document.createElement('dialog');d.className='hc-suivi';d.innerHTML='<header><h2>'+esc(title)+'</h2>'+button('Fermer','data-suivi-close')+'</header><div class="hc-suivi-content">Chargement…</div>';
  document.body.append(d);d.querySelector('[data-suivi-close]').onclick=()=>d.close();d.addEventListener('close',()=>{d.remove();if(active===d)active=null;});d.showModal();active=d;return d;
 }
 async function pieces(context){
  const query=context.mission_id?'mission_id=eq.'+context.mission_id:'client_id=eq.'+context.client_id+'&mission_id=is.null';
  return sbFetchToutePage('pieces_mission?'+query+'&order=created_at.desc');
 }
 let countVersion=0;
 async function refreshCounts(){
  if(currentRole!=='client')return;
  const ticket=++countVersion;
  try{
   const rows=await sbFetchToutePage('pieces_mission?select=client_id,mission_id');
   if(ticket!==countVersion||currentRole!=='client')return;
   document.querySelectorAll('[data-client-doc-count]').forEach(b=>{
    const n=rows.filter(p=>b.dataset.suiviDocs?p.mission_id===b.dataset.suiviDocs:p.client_id===b.dataset.suiviClient).length;
    b.textContent=n?'Documents ('+n+')':'Ajouter un document';
    b.title=n?'Consulter les documents ou en ajouter un':'Envoyer un document à HelixCar';
   });
  }catch(e){/* Garder un accès utilisable si le compteur est indisponible. */}
 }
 async function openDocuments(mid,cid){
  const d=create(currentRole==='client'?'Documents de ma demande / prestation':'Documents de la mission');const body=d.querySelector('.hc-suivi-content');
  try{
   let contexts=await rpc('contextes_documents');if(!d.open)return;
   if(currentRole==='client'&&(mid||cid))contexts=contexts.filter(c=>mid?c.mission_id===mid:c.client_id===cid);
   if(!contexts.length){body.textContent='Aucun dossier disponible.';return;}
   let idx=contexts.findIndex(c=>mid?c.mission_id===mid:cid?c.client_id===cid&&!c.mission_id:false);if(idx<0)idx=0;
   body.innerHTML='<label>Dossier ou mission<select id="hc-doc-context">'+contexts.map((c,i)=>'<option value="'+i+'">'+esc(c.reference)+(c.type_mission==='demande'?' · Dossier client':' · '+esc(c.type_mission||'Mission'))+'</option>').join('')+'</select></label><div id="hc-doc-zone"></div>';
   const select=body.querySelector('select');select.value=idx;select.onchange=()=>paint(contexts[Number(select.value)]);await paint(contexts[idx]);
   async function paint(c){
    const ticket=++version,zone=body.querySelector('#hc-doc-zone');zone.textContent='Chargement des pièces…';
    try{const [docs,controls]=await Promise.all([pieces(c),c.mission_id&&currentRole!=='client'?sbFetchToutePage('controles_fin_mission?mission_id=eq.'+c.mission_id+'&order=created_at.desc&limit=1'):[]]);if(ticket!==version||!d.open)return;
     zone.innerHTML=(currentRole==='admin'&&c.mission_id?button('Retour au suivi','data-back-control'):'' )+(controls[0]?.decision==='a_corriger'?'<p class="hc-correction"><strong>Correction demandée par HelixCar</strong><br>'+esc(controls[0].commentaire)+'</p>':'')+'<p>PDF, JPG, PNG ou WebP · 10 Mo maximum. Chaque envoi conserve son auteur et sa date.</p><form class="hc-doc-upload">'+(currentRole!=='client'&&c.mission_id?'<label>Type de document<select name="category"><option value="document">Document complémentaire</option>'+(c.type_mission==='convoyage'?'<option value="lettre_signee">Lettre de voiture signée (fin de mission)</option>':'')+'</select></label>':'')+'<label>Ajouter un document<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required></label>'+(currentRole==='admin'?'<label><input type="checkbox" name="partner"> Partager avec le partenaire affecté à cette mission</label><label><input type="checkbox" name="client"> Partager avec le client</label><label><input type="checkbox" name="required"> Document à contrôler avant validation finale</label>':'<p>Votre document est envoyé à HelixCar.</p>')+'<button class="btn btn-primary" type="submit">Envoyer</button><p role="status"></p></form><div class="hc-doc-list">'+(docs.length?docs.map(p=>'<article><strong>'+esc(p.nom)+'</strong><p>'+esc(p.auteur_role)+' · '+esc(new Date(p.created_at).toLocaleString('fr-FR'))+' · '+etats[p.etat]+(p.obligatoire?' · À contrôler':'')+'</p>'+(p.commentaire?'<p class="hc-correction">'+esc(p.commentaire)+'</p>':'')+'<div class="hc-suivi-actions">'+button('Consulter','data-piece-open="'+p.id+'"')+(currentRole==='admin'?button(p.partage_partenaire?'Retirer le partage partenaire':'Partager au partenaire','data-piece-share="'+p.id+'"')+button(p.partage_client?'Retirer le partage client':'Partager au client','data-piece-client="'+p.id+'"')+button('Valider','data-piece-state="valide" data-piece-id="'+p.id+'"')+button('À corriger','data-piece-state="a_corriger" data-piece-id="'+p.id+'"')+(!c.mission_id?button('Rattacher à une mission','data-piece-link="'+p.id+'"'):''):'')+'</div></article>').join(''):'<p>Aucun document ajouté.</p>')+'</div>';
     zone.querySelector('[data-back-control]')?.addEventListener('click',()=>control(c.mission_id));
     const form=zone.querySelector('form');form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('button'),status=form.querySelector('[role=status]');submit.disabled=true;select.disabled=true;
      let path,stored=false;
      try{const f=form.querySelector('[type=file]').files[0];if(!f||f.size>10485760||!['application/pdf','image/jpeg','image/png','image/webp'].includes(f.type))throw Error('Choisissez un PDF ou une image de 10 Mo maximum.');
       const uid=(await sbAuth.auth.getUser()).data.user?.id;if(!uid)throw Error('Session expirée');
       path=c.client_id+'/'+uid+'/'+crypto.randomUUID()+'.'+({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[f.type]);
       const upload=await sbAuth.storage.from('pieces-missions').upload(path,f,{upsert:false,contentType:f.type});if(upload.error)throw upload.error;stored=true;
       const r=await sbAuth.from('pieces_mission').insert({client_id:c.client_id,mission_id:c.mission_id,nom:f.name.slice(0,180),chemin:path,auteur_role:currentRole,categorie:form.elements.category?.value||'document',partage_partenaire:!!form.elements.partner?.checked,partage_client:!!form.elements.client?.checked,obligatoire:!!form.elements.required?.checked});if(r.error)throw r.error;stored=false;select.disabled=false;await paint(c);refreshCounts();
      }catch(err){if(stored)await sbAuth.storage.from('pieces-missions').remove([path]);status.textContent=err.message||'Envoi impossible';submit.disabled=false;select.disabled=false;}
     };
     zone.querySelector('.hc-doc-list').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.pieceOpen||b.dataset.pieceShare||b.dataset.pieceClient||b.dataset.pieceId||b.dataset.pieceLink,p=docs.find(x=>x.id===id);if(!p)return;b.disabled=true;
      try{if(b.dataset.pieceOpen){const r=await sbAuth.storage.from('pieces-missions').createSignedUrl(p.chemin,120);if(r.error)throw r.error;const a=document.createElement('a');a.href=r.data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Ouvrir le document';b.after(a);b.remove();return;}
       let change;if(b.dataset.pieceShare){if(!p.mission_id)throw Error('Rattachez d’abord le document à une mission.');change={partage_partenaire:!p.partage_partenaire};}
       else if(b.dataset.pieceClient)change={partage_client:!p.partage_client};
       else if(b.dataset.pieceLink){const choices=contexts.filter(x=>x.mission_id&&x.client_id===c.client_id);if(!choices.length)throw Error('Aucune mission créée pour ce dossier.');const picker=document.createElement('select');choices.forEach(x=>picker.add(new Option(x.reference,x.mission_id)));b.after(picker);const ok=document.createElement('button');ok.className='btn btn-primary';ok.textContent='Rattacher';picker.after(ok);ok.onclick=async()=>{ok.disabled=true;try{const r=await sbAuth.from('pieces_mission').update({mission_id:picker.value}).eq('id',p.id);if(r.error)throw r.error;await paint(c);}catch(err){alert(err.message);ok.disabled=false;}};return;}
       else {const comment=b.dataset.pieceState==='a_corriger'?prompt('Quelle correction est attendue ?'):null;if(b.dataset.pieceState==='a_corriger'&&!comment?.trim()){b.disabled=false;return;}change={etat:b.dataset.pieceState,commentaire:comment};}
       const r=await sbAuth.from('pieces_mission').update(change).eq('id',p.id);if(r.error)throw r.error;await paint(c);
      }catch(err){alert(err.message);b.disabled=false;}
     };
    }catch(err){zone.textContent=err.message;}
   }
  }catch(err){body.textContent=err.message;}
 }
 async function control(mid){
  const d=create('Contrôle de la mission'),body=d.querySelector('.hc-suivi-content');
  try{
   const [mr,edl,history,docs,invoices]=await Promise.all([sbAuth.from('missions').select('*').eq('id',mid).single(),sbFetchToutePage('etats_des_lieux?mission_id=eq.'+mid+'&order=created_at'),sbFetchToutePage('controles_fin_mission?mission_id=eq.'+mid+'&order=created_at.desc'),sbFetchToutePage('pieces_mission?mission_id=eq.'+mid),sbFetchToutePage('factures_convoyeur?mission_ids=cs.'+encodeURIComponent(JSON.stringify([mid]))) ]);
   if(mr.error)throw mr.error;if(!d.open)return;const m=mr.data,transport=(m.type_mission||'convoyage')==='convoyage';
   const required=transport?(m.restitution?Object.keys(phases):['depart','arrivee']):[];
   const missing=required.filter(p=>!edl.some(e=>e.phase===p&&e.signature_url));
   const can=['edl_termine','fini','terminee'].includes(m.statut)&&!!m.convoyeur_id&&!m.validee_paiement;
   const blockers=[...missing.map(p=>'État des lieux '+phases[p]+' manquant'),...(transport&&!m.lettre_voiture_signee_url?['Lettre de voiture signée manquante']:[]),...docs.filter(x=>(x.obligatoire||x.categorie==='lettre_signee')&&x.etat==='a_corriger'&&(x.categorie!=='lettre_signee'||'pieces-missions/'+x.chemin===m.lettre_voiture_signee_url)).map(x=>'Document à corriger : '+x.nom),...(!(Number(m.remuneration_prevue)>0)?['Rémunération à vérifier']:[])];
   d.querySelector('h2').textContent=referenceMission(m)+' · Suivi';
   body.innerHTML='<p>'+esc([m.marque_modele,m.immatriculation].filter(Boolean).join(' · '))+'</p><div class="hc-suivi-etapes">'+required.map(p=>{const done=edl.find(e=>e.phase===p);return '<article class="'+(done?'done':'')+'"><strong>'+phases[p]+'</strong><p>'+(done?'État des lieux reçu':'En attente')+'</p>'+(done?'<small>'+esc(new Date(done.created_at).toLocaleString('fr-FR'))+'</small>':'')+'</article>';}).join('')+'</div>'+(window.HCKm?.detail(mid)||'')+'<section><h3>Documents et états des lieux</h3><div class="hc-suivi-actions">'+(transport?button('États des lieux','data-edl')+(_lienLettreSignee(m)||'<span class="badge badge-pending">Lettre de voiture à fournir</span>'):'')+button('Documents ('+docs.length+')','data-docs')+'</div></section><section><h3>Validation finale</h3><p>'+(m.validee_paiement?'Mission validée · '+(invoices.length?'Facturation '+esc(invoices[0].reference):'Disponible à facturer'):can?'Réalisation reçue · contrôle HelixCar attendu':'Réalisation en attente. Les documents restent consultables.')+'</p>'+blockers.map(t=>'<p class="hc-correction">'+esc(t)+'</p>').join('')+(can?'<form id="hc-control-form"><label><input type="checkbox" required> J’ai contrôlé les documents, les états des lieux et les éventuelles anomalies.</label><label>Commentaire<textarea name="comment" placeholder="Observation ou correction attendue"></textarea></label><div class="hc-suivi-actions"><button type="submit" class="btn btn-primary" '+(blockers.length?'disabled':'')+'>Valider la mission</button>'+button('Demander une correction','data-correction')+'</div><p>La validation permet au partenaire de sélectionner cette mission dans sa facturation. Aucun paiement n’est déclenché.</p><p role="status"></p></form>':'')+(invoices.length?button('Voir la facture','data-invoice="'+invoices[0].id+'"'):'')+'</section><section><h3>Historique des contrôles</h3>'+(history.length?history.map(h=>'<p><strong>'+ (h.decision==='validee'?'Validée':'Correction demandée')+'</strong> · '+esc(new Date(h.created_at).toLocaleString('fr-FR'))+'<br>'+esc(h.commentaire||'')+'</p>').join(''):'<p>Aucun contrôle final enregistré.</p>')+'</section>';
   body.querySelector('[data-edl]')?.addEventListener('click',()=>voirEtatsDesLieuxTest(mid));
   body.querySelector('[data-docs]').onclick=()=>openDocuments(mid,m.client_id);
   body.querySelector('[data-invoice]')?.addEventListener('click',()=>{d.close();showPage('admin-facturation');loadFacturationAdmin().then(()=>document.getElementById('facture-'+invoices[0].id)?.scrollIntoView({block:'center'}));});
   const f=body.querySelector('form');if(f){const decide=async decision=>{const status=f.querySelector('[role=status]'),comment=f.elements.comment.value;if(decision==='a_corriger'&&comment.trim().length<3){status.textContent='Précisez la correction attendue.';return;}
    f.querySelectorAll('button').forEach(b=>b.disabled=true);try{await rpc('controler_fin_mission',{mid,decision,commentaire:comment});await control(mid);window.chargerMissionsUnifiees?.();}catch(err){status.textContent=err.message;f.querySelector('[data-correction]').disabled=false;f.querySelector('[type=submit]').disabled=!!blockers.length;}};
    f.onsubmit=e=>{e.preventDefault();decide('validee');};f.querySelector('[data-correction]').onclick=()=>decide('a_corriger');}
  }catch(err){body.textContent=err.message;}
 }
 async function invoiceCorrection(id){const c=prompt('Précisez ce que le partenaire doit corriger ou clarifier :');if(!c?.trim())return;const r=await sbAuth.from('factures_convoyeur').update({statut:'a_corriger',correction_commentaire:c}).eq('id',id);if(r.error)alert(r.error.message);else loadFacturationAdmin();}
 async function resubmit(id){if(!confirm('Soumettre à nouveau cette facturation après avoir traité la demande HelixCar ?'))return;const r=await sbAuth.from('factures_convoyeur').update({statut:'en_attente'}).eq('id',id);if(r.error)alert(r.error.message);else loadFacturationConvoyeur();}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-suivi-mission],[data-suivi-docs],[data-facture-correction],[data-facture-resubmit],[data-private-letter]');if(!b)return;
  if(b.dataset.privateLetter){sbAuth.storage.from('pieces-missions').createSignedUrl(b.dataset.privateLetter,120).then(r=>{if(r.error){alert(r.error.message);return;}const a=document.createElement('a');a.href=r.data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Ouvrir la lettre signée';b.after(a);b.remove();});}
  if(b.hasAttribute('data-suivi-mission')){e.preventDefault();control(b.dataset.suiviMission);}
  if(b.hasAttribute('data-suivi-docs'))openDocuments(b.dataset.suiviDocs||null,b.dataset.suiviClient||null);
  if(b.dataset.factureCorrection)invoiceCorrection(b.dataset.factureCorrection);
  if(b.dataset.factureResubmit)resubmit(b.dataset.factureResubmit);
 });
 async function priorities(){
  if(currentRole!=='admin')return;const cycle=window.HCSync?.capture();
  try{const rows=await sbFetchToutePage('factures_convoyeur?select=statut');if(currentRole!=='admin'||cycle&&!window.HCSync.safe(cycle))return;
   let zone=document.getElementById('hc-finance-priorities');if(!zone){zone=document.createElement('div');zone.id='hc-finance-priorities';zone.className='card';document.getElementById('hm-priorites')?.after(zone);}
   zone.innerHTML='<h3>À traiter · Facturation</h3><div class="hc-suivi-actions">'+button('Facturations à vérifier · '+rows.filter(x=>x.statut==='en_attente').length,'data-finance-view="fc-admin-attente"')+button('Facturations à payer · '+rows.filter(x=>x.statut==='validee').length,'data-finance-view="fc-admin-a-payer"')+'</div>';
   zone.onclick=e=>{const b=e.target.closest('[data-finance-view]');if(b){showPage('admin-facturation');document.getElementById(b.dataset.financeView)?.scrollIntoView({block:'center'});}};
  }catch(e){console.warn('Compteurs de facturation indisponibles');}
 }
 window.HCSuivi={control,documents:openDocuments,priorities,refreshCounts};
 HC_ACTIONS.controlerMission=control;
 window.addEventListener('hc-session-fermee',()=>{version++;countVersion++;active?.close();document.getElementById('hc-finance-priorities')?.remove();});
 // Accès permanent pour les documents reçus avant la création d’une mission.
 for(const id of ['page-convoyeur-missions']){const page=document.getElementById(id);if(page){const bar=document.createElement('div');bar.className='hc-doc-entry';bar.innerHTML=button('Mes documents','data-suivi-docs=""');page.prepend(bar);}}
})();
