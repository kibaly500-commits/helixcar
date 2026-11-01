/* Réglages et parcours liés à la session courante, sans données d'un autre compte. */
(function(){
 'use strict';
 let uid=null,prefs={theme:'systeme',nouveautes_lues:{}},generation=0;
 const esc=v=>escapeHtml(String(v??''));
 const el=id=>document.getElementById(id);
 function page(id,title){let p=el('page-'+id);if(p)return p;p=document.createElement('div');p.id='page-'+id;p.className='page';p.innerHTML='<div class="card"><h2>'+title+'</h2><div data-parcours-contenu></div></div>';el('page-client-profil').parentNode.append(p);return p;}
 page('client-devis','Mes devis');page('convoyeur-challenge','Challenge trimestriel');page('admin-challenge','Challenge partenaires');
 page('client-parametres','Paramètres');page('convoyeur-parametres','Paramètres');
 const zone=id=>page(id,'').querySelector('[data-parcours-contenu]');
 async function session(){const r=await sbAuth.auth.getSession();if(r.error||!r.data.session)throw Error('Session absente');const next=r.data.session.user.id;if(uid!==next){uid=next;prefs={theme:'systeme',nouveautes_lues:{}};const q=await sbAuth.from('preferences_compte').select('*').eq('auth_user_id',uid).maybeSingle();if(q.error)throw q.error;if(q.data)prefs=q.data;}return uid;}
 function theme(){const sombre=prefs.theme==='sombre'||prefs.theme==='systeme'&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('hc-mode-sombre',sombre&&currentRole!=='admin');}
 async function sauver(){const id=await session();const r=await sbAuth.from('preferences_compte').upsert({auth_user_id:id,theme:prefs.theme,nouveautes_lues:prefs.nouveautes_lues});if(r.error)throw r.error;}
 async function parametres(id){await session();theme();const z=zone(id);z.innerHTML='<label for="hc-theme-'+id+'">Apparence</label><select id="hc-theme-'+id+'"><option value="systeme">Selon mon appareil</option><option value="clair">Clair</option><option value="sombre">Sombre</option></select><p role="status" data-message></p><p>Vos coordonnées et documents se trouvent dans Mon profil.</p><div data-suppression></div>';
 suppression(z.querySelector('[data-suppression]'));
 const select=z.querySelector('select');select.value=prefs.theme;select.onchange=async()=>{const ancien=prefs.theme;select.disabled=true;prefs.theme=select.value;try{await sauver();theme();z.querySelector('[data-message]').textContent='Préférence enregistrée.';}catch{prefs.theme=ancien;select.value=ancien;z.querySelector('[data-message]').textContent='Enregistrement impossible. Réessayez.';}finally{select.disabled=false;}};
 }
 function suppression(z){
  z.innerHTML='<details><summary>Supprimer mon compte</summary><p>Vous perdrez l’accès à votre espace. Les dossiers et documents historiques restent conservés par HelixCar. Une nouvelle inscription avec la même adresse e-mail sera possible, sans récupérer cet ancien espace.</p><form><label>Motif de votre départ<textarea required maxlength="1000" name="motif"></textarea></label><label>Écrivez SUPPRIMER pour confirmer<input required name="confirmation" autocomplete="off" pattern="SUPPRIMER"></label><button type="submit" class="btn btn-primary">Supprimer définitivement mon accès</button><p role="status"></p></form></details>';
  const form=z.querySelector('form');form.onsubmit=async(e)=>{e.preventDefault();if(!form.reportValidity())return;const btn=form.querySelector('button'),msg=form.querySelector('[role=status]');btn.disabled=true;try{const r=await sbAuth.functions.invoke('supprimer-compte',{body:{motif:form.elements.motif.value,confirmation:form.elements.confirmation.value}});if(r.error||!r.data?.ok)throw Error(r.data?.error||'Suppression non confirmée. Réessayez.');await sbAuth.auth.signOut();location.href='index.html';}catch(e){msg.textContent=e.message;btn.disabled=false;}};
 }
 async function devis(){const z=zone('client-devis');z.textContent='Chargement…';const rows=await chargerDevisClient();if(currentRole!=='client')return;z.innerHTML='<label for="hc-filtre-devis">Afficher</label><select id="hc-filtre-devis"><option value="attente">En attente de réponse</option><option value="accepte">Devis acceptés</option><option value="refuse">Devis refusés</option><option value="tous">Tous les devis</option></select><div data-devis></div>';const render=()=>{const f=z.querySelector('select').value;const selection=rows.filter(d=>f==='tous'||f==='attente'&&['envoye','consulte'].includes(d.statut)||d.statut===f);z.querySelector('[data-devis]').innerHTML=selection.map(d=>'<article class="hc-devis-item"><strong>'+esc(d.reference)+'</strong><span>'+esc(_etatDevisClient(d)?.texte||d.statut)+'</span><a class="btn btn-outline" href="devis.html?id='+encodeURIComponent(d.id)+'">Consulter le devis</a></article>').join('')||'<p>Aucun devis dans cette rubrique.</p>';};z.querySelector('select').onchange=render;render();afficherCompteurMenu('client-devis',rows.filter(d=>['envoye','consulte'].includes(d.statut)).length,'devis en attente de réponse');}
 function contenuChallenge(d,admin){
  const dateFr=s=>new Date(s+'T12:00:00').toLocaleDateString('fr-FR');
  const lignes=admin?d.classement:d.classement.filter(c=>c.moi);
  let html='<p>Du '+esc(dateFr(d.debut))+' au '+esc(new Date(Date.parse(d.fin+'T12:00:00')-86400000).toLocaleDateString('fr-FR'))+'</p>';
  if(admin)html+='<div class="hc-podium"><div>1re place<strong>150 €</strong></div><div>2e place<strong>100 €</strong></div><div>3e place<strong>50 €</strong></div></div>';
  html+='<p>Missions terminées et validées par HelixCar pendant le trimestre. Remise à zéro chaque trimestre.</p>';
  if(admin){
   html+=lignes.length?'<div style="overflow-x:auto"><table><thead><tr><th>Place</th><th>Partenaire</th><th>Missions</th><th>Prime '+(d.termine?'du trimestre':'prévisionnelle')+'</th></tr></thead><tbody>'+lignes.map(c=>'<tr><td>'+esc(c.rang)+'</td><td>'+esc(c.numero)+'</td><td>'+esc(c.missions)+'</td><td>'+esc(c.recompense)+' €</td></tr>').join('')+'</tbody></table></div>':'<p>Aucune mission comptabilisée pour ce trimestre.</p>';
  }else{
   const moi=lignes[0];
   html+=moi?'<div class="hc-podium"><div>Votre position<strong>'+esc(moi.rang)+(moi.rang===1?'er':'e')+'</strong></div><div>Vos missions validées<strong>'+esc(moi.missions)+'</strong></div><div>'+ (d.termine?'Prime du trimestre':'Prime prévisionnelle')+'<strong>'+esc(moi.recompense)+' €</strong></div></div>':'<p>Vous n’avez pas encore de mission comptabilisée pour ce trimestre.</p>';
  }
  html+='<small>🏁 Même nombre de missions ? La place revient à celui ou celle qui a atteint ce total en premier. À vous de jouer !</small>';
  if(admin)html+='<p role="status" style="margin-top:20px;padding:14px;border:1px solid var(--accent);border-radius:8px;color:var(--ink)"><strong>'+(d.termine?'Trimestre clos — règlement des primes à vérifier.':'Rappel de règlement')+'</strong><br>Les primes sont à régler après la clôture du trimestre, à partir du '+esc(dateFr(d.fin))+'.'+(d.termine?' Vérifiez les versements déjà effectués avant tout règlement.':' Le classement reste provisoire jusque-là.')+'</p>';
  else if(!d.termine)html+='<p>Votre position et votre prime restent provisoires jusqu’à la clôture du trimestre.</p>';
  return html;
 }
 async function challenge(id='convoyeur-challenge',precedent=false){
  const role=currentRole,z=zone(id);z.textContent='Chargement…';
  const paris=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const date=new Date(paris+'T12:00:00');date.setMonth(Math.floor(date.getMonth()/3)*3-(precedent?3:0),1);
  const trimestre=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-01';
  const r=await sbAuth.rpc('challenge_partenaire',{p_trimestre:trimestre});if(r.error)throw r.error;
  if(currentRole!==role||!['convoyeur','admin'].includes(role))return;
  z.innerHTML=contenuChallenge(r.data,role==='admin');
  const bouton=document.createElement('button');bouton.type='button';bouton.className='btn btn-outline';
  bouton.textContent=precedent?'Voir le trimestre actuel':'Voir le trimestre précédent';
  bouton.onclick=()=>challenge(id,!precedent).catch(()=>{z.textContent='Challenge indisponible. Réessayez.';});z.prepend(bouton);
 }
 let avatarGeneration=0;
 async function portraitMenu(){
  const tour=++avatarGeneration,avatar=el('sb-avatar'),carte=avatar?.closest('.sidebar-user');
  if(!avatar||!carte)return;
  const partenaire=currentRole==='convoyeur';carte.classList.toggle('hc-profil-partenaire',partenaire);
  const initiales=()=>{avatar.textContent=(el('sb-name')?.textContent||'P').trim().split(/\s+/).map(s=>s[0]).slice(0,2).join('');};
  initiales();if(!partenaire)return;
  try{
   const session=await sbAuth.auth.getSession(),user=session.data?.session?.user?.id;
   if(!user)return;
   const r=await sbAuth.from('convoyeurs').select('photo_profil_chemin').eq('auth_user_id',user).maybeSingle();
   if(r.error||!r.data?.photo_profil_chemin)return;
   const signed=await sbAuth.storage.from('portraits-partenaires').createSignedUrl(r.data.photo_profil_chemin,300);
   if(signed.error||tour!==avatarGeneration||currentRole!=='convoyeur')return;
   const img=document.createElement('img');img.alt='Votre photo professionnelle';img.src=signed.data.signedUrl;
   img.onerror=()=>{if(tour===avatarGeneration)initiales();};avatar.replaceChildren(img);
  }catch{/* Les initiales restent visibles si la photo est indisponible. */}
 }
 async function portrait(){
  await session();const profil=el('page-convoyeur-profil');let box=el('hc-portrait');if(!box){box=document.createElement('div');box.className='card';box.id='hc-portrait';profil.prepend(box);}
  box.innerHTML='<h3>Photo de profil professionnelle</h3><p>Un portrait net et récent, visage visible. JPG ou PNG, 5 Mo maximum.</p><img hidden alt="Votre photo de profil" width="100" height="100"><input type="file" accept="image/jpeg,image/png" aria-label="Photo de profil professionnelle"><p role="status"></p>';
  const r=await sbAuth.from('convoyeurs').select('photo_profil_chemin').eq('auth_user_id',uid).maybeSingle();
  async function afficher(path){if(!path)return;const signed=await sbAuth.storage.from('portraits-partenaires').createSignedUrl(path,300);if(signed.error)throw signed.error;const img=box.querySelector('img');img.src=signed.data.signedUrl;img.hidden=false;}
  if(!r.error)await afficher(r.data?.photo_profil_chemin);
  const input=box.querySelector('input'),msg=box.querySelector('[role=status]');input.onchange=async()=>{const f=input.files[0];if(!f)return;if(!['image/jpeg','image/png'].includes(f.type)||f.size>5242880){msg.textContent='Choisissez une image JPG ou PNG de 5 Mo maximum.';return;}input.disabled=true;try{const bitmap=await createImageBitmap(f);if(bitmap.width<100||bitmap.height<100)throw Error('Photo trop petite');bitmap.close();const path=uid+'/'+crypto.randomUUID()+'.'+(f.type==='image/png'?'png':'jpg');const u=await sbAuth.storage.from('portraits-partenaires').upload(path,f,{contentType:f.type,upsert:false});if(u.error)throw u.error;const save=await sbAuth.rpc('enregistrer_portrait',{p_chemin:path});if(save.error)throw save.error;await afficher(path);await portraitMenu();msg.textContent='Photo enregistrée.';}catch{msg.textContent='Photo non enregistrée. Vérifiez le fichier puis réessayez.';}finally{input.disabled=false;}};
 }
 async function compteurs(){
  const role=currentRole;
  if(role==='client'){
   const ds=await chargerDevisClient();if(currentRole!==role)return;
   afficherCompteurMenu('client-devis',ds.filter(d=>['envoye','consulte'].includes(d.statut)).length,'devis à consulter');
   const demandes=await chargerDemandesClient();let n=0;
   for(const d of demandes){if(ds.find(v=>v.client_id===d.id)?.statut==='refuse')continue;const lignes=await chargerInformationsDemande(d.id);n+=lignes.filter(_estRestante).length;}
   if(currentRole===role)afficherCompteurMenu('client-infos',n,'informations à compléter');
   const missions=await chargerMissionsClient();if(currentRole===role)afficherCompteurMenu('client-missions',missions.filter(m=>!['terminee','annulee','fini'].includes(m.statut)).length,'missions à suivre');
   const r=await sbAuth.from('fidelite_recompenses').select('id').in('statut',['a_preparer','prete']);if(!r.error&&currentRole===role)afficherCompteurMenu('client-fidelite',r.data.length,'récompenses débloquées');
  }else if(role==='convoyeur'){
   const r=await sbAuth.rpc('missions_du_partenaire');if(!r.error&&currentRole===role)afficherCompteurMenu('convoyeur-missions',(r.data||[]).filter(m=>!['fini','terminee','annulee'].includes(m.statut)).length,'missions actuelles');
   const f=await sbAuth.from('factures_convoyeur').select('id').in('statut',['en_attente','validee']);if(!f.error&&currentRole===role)afficherCompteurMenu('convoyeur-facturation',f.data.length,'factures en attente');
  }
 }
 async function ouvrir(id){portraitMenu();const n=++generation;try{if(id==='convoyeur-profil')await portrait();if(id==='client-devis')await devis();if(['convoyeur-challenge','admin-challenge'].includes(id))await challenge(id);if(['client-parametres','convoyeur-parametres'].includes(id))await parametres(id);if(currentRole==='admin'){document.documentElement.classList.remove('hc-mode-sombre');return;}await session();if(n!==generation)return;theme();marquerNouveaux();compteurs().catch(()=>{});}catch{const z=el('page-'+id)?.querySelector('[data-parcours-contenu]');if(z&&n===generation)z.textContent='Chargement impossible. Réouvrez cette rubrique pour réessayer.';}}
 function marquerNouveaux(){if(!uid||currentRole!=='client')return;document.querySelectorAll('#client-demandes-liste [data-demande]').forEach(card=>{if(card.parentElement.firstElementChild!==card||card.dataset.etatDemande==='cloture')return;const key=card.dataset.demande+':'+card.dataset.etatDemande;if(prefs.nouveautes_lues[key]||card.querySelector('.hc-nouveau'))return;const badge=document.createElement('span');badge.className='hc-nouveau';badge.textContent='Nouveau';card.querySelector('.hc-demande-summary')?.append(badge);const details=card.querySelector('.hc-demande-details');details?.addEventListener('toggle',async()=>{if(!details.open)return;prefs.nouveautes_lues[key]=true;try{await sauver();badge.remove();}catch{delete prefs.nouveautes_lues[key];}},{once:true});});}
 new MutationObserver(()=>marquerNouveaux()).observe(el('client-demandes-liste'),{childList:true});
 window.addEventListener('hc-session-fermee',()=>{uid=null;generation++;avatarGeneration++;el('sb-avatar')?.replaceChildren();el('sb-avatar')?.closest('.sidebar-user')?.classList.remove('hc-profil-partenaire');prefs={theme:'systeme',nouveautes_lues:{}};document.documentElement.classList.remove('hc-mode-sombre');});
 matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(uid)theme();});
 window.HCParcours={ouvrir,portraitAdmin:async function(c){if(!c.photo_profil_chemin)return;const cible=document.getElementById('hc-portrait-admin');if(!cible)return;try{const r=await sbAuth.storage.from('portraits-partenaires').createSignedUrl(c.photo_profil_chemin,300);if(r.error||document.getElementById('hc-portrait-admin')!==cible)return;const img=document.createElement('img');img.src=r.data.signedUrl;img.alt='Photo professionnelle du partenaire';img.width=100;img.height=100;cible.append(img);}catch{cible.textContent='Photo momentanément indisponible';}}};
})();
