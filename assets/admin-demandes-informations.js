/* États opérationnels des informations : indépendants du devis et du paiement. */
var _etatsInfosDemandes = Object.create(null), _etatsInfosGeneration = 0;
function _resumerInfosDemande(lignes, meta, confirme) {
  if (!Array.isArray(lignes) || !lignes.length) return [{cle:'indisponible',texte:'État non disponible',ton:'neutre'}];
  var n={manquantes:0,a_corriger:0,nouvelles:0,modifications:0,corrections:0};
  for (var l of lignes) {
    var m=meta[l.cle]||{};
    if(l.statut==='attendue')n.manquantes++;
    else if(l.statut==='a_corriger')n.a_corriger++;
    else if(l.statut==='transmise') {
      if(m.correction_recue)n.corrections++;
      else if(m.ancienne_valeur!=null && String(m.ancienne_valeur).trim()!=='')n.modifications++;
      else n.nouvelles++;
    } else if(!['fournie','validee'].includes(l.statut))return [{cle:'indisponible',texte:'État non disponible',ton:'neutre'}];
  }
  var labels={corrections:['Corrections reçues · à vérifier','violet'],modifications:['Informations modifiées · à vérifier','violet'],nouvelles:['Informations reçues · à vérifier','bleu'],a_corriger:['Corrections demandées · attente client','orange'],manquantes:['Champs manquants · attente client','orange']};
  var resultat=Object.keys(labels).filter(k=>n[k]).map(k=>({cle:k,texte:labels[k][0]+' ('+n[k]+')',ton:labels[k][1]}));
  if(!resultat.length)resultat.push(confirme?{cle:'complet',texte:'Dossier complet',ton:'vert'}:{cle:'confirmation',texte:'Champs complets · confirmation client attendue',ton:'neutre'});
  return resultat;
}
function _badgesInfosDemande(id) {
  var etats=_etatsInfosDemandes[String(id)]||[{cle:'chargement',texte:'Vérification…',ton:'neutre'}];
  return '<div class="hc-etats-infos">'+etats.map(e=>'<span class="hc-etat-info hc-etat-info--'+e.ton+'">'+_escapeHtml(e.texte)+'</span>').join('')+'</div>';
}
function _filtreInfosDemande(c,choix) {
  if(!choix)return true;
  var etats=_etatsInfosDemandes[String(c.id)]||[];
  return etats.some(e=>choix==='a_verifier'?['nouvelles','modifications','corrections'].includes(e.cle):choix==='attente_client'?['manquantes','a_corriger','confirmation'].includes(e.cle):e.cle===choix);
}
var _etatsInfosLecture = null, _etatsInfosRelancer = false;
function _chargerEtatsInformationsDemandes() {
  if (_etatsInfosLecture) { _etatsInfosRelancer = true; return _etatsInfosLecture; }
  _etatsInfosLecture = _lireEtatsInformationsDemandes().finally(function(){
    _etatsInfosLecture=null;
    if(_etatsInfosRelancer){_etatsInfosRelancer=false;_chargerEtatsInformationsDemandes();}
  });
  return _etatsInfosLecture;
}
async function _lireEtatsInformationsDemandes() {
  if(currentRole!=='admin'||!_sbAuthPret())return;
  var generation=++_etatsInfosGeneration, liste=(_demandesDevisListe||[]).slice();
  var meta=Object.create(null), confirmations=Object.create(null);
  try {
    var sources=await Promise.all([
      sbFetchToutePage('demande_informations_manquantes?select=client_id,cle,ancienne_valeur,correction_recue&statut=eq.transmise'),
      sbFetchToutePage('clients?select=id,informations_confirmees_le')
    ]);
    sources[1].forEach(c=>{confirmations[String(c.id)]=!!c.informations_confirmees_le;});
    var lignes=sources[0];
    lignes.forEach(l=>{(meta[String(l.client_id)]||(meta[String(l.client_id)]=Object.create(null)))[l.cle]=l;});
  }catch(e){if(generation!==_etatsInfosGeneration)return;liste.forEach(c=>{_etatsInfosDemandes[String(c.id)]=[{cle:'indisponible',texte:'Chargement impossible · actualiser',ton:'neutre'}];});filtrerDemandesDevis((document.getElementById('recherche-devis')||{}).value);return;}
  for(var i=0;i<liste.length;i+=4) {
    var resultats=await Promise.all(liste.slice(i,i+4).map(async c=>{
      try{return [String(c.id),_resumerInfosDemande(await chargerInfosDemandeAdmin(c.id),meta[String(c.id)]||{},confirmations[String(c.id)])];}
      catch(e){return [String(c.id),[{cle:'indisponible',texte:'Chargement impossible · actualiser',ton:'neutre'}]];}
    }));
    if(generation!==_etatsInfosGeneration)return;
    resultats.forEach(([id,etat])=>{_etatsInfosDemandes[id]=etat;});
    filtrerDemandesDevis((document.getElementById('recherche-devis')||{}).value);
  }
}
setInterval(function(){var p=document.getElementById('page-admin-devis');if(p&&p.classList.contains('active')&&!document.hidden)_chargerEtatsInformationsDemandes();},30000);
