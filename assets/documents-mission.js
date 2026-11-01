/* Codes d’étape : repères de navigation, jamais des autorisations d’accès. */
(function(root){
  'use strict';
  const suffixes={depart:'DEP',arrivee:'ARR',restitution_depart:'RDEP',restitution_arrivee:'RARR'};
  function code(reference,phase){
    if(!suffixes[phase])throw new Error('Étape inconnue.');
    return String(reference||'').trim()+'/'+suffixes[phase];
  }
  function lireCode(value,phase){
    const texte=String(value||'').trim();
    const match=texte.match(/^(.*)\/(DEP|ARR|RDEP|RARR)$/i);
    const etape=match&&Object.keys(suffixes).find(k=>suffixes[k]===match[2].toUpperCase());
    if(phase&&!suffixes[phase])throw new Error('Étape inconnue.');
    if(etape&&phase&&etape!==phase)throw new Error('Ce code correspond à une autre étape de l’état des lieux.');
    const reference=(match?match[1]:texte).trim();
    if(!reference||reference.length>200||/[\/%*]/.test(reference))throw new Error('Code de mission invalide.');
    return {reference,phase:etape||phase||'depart'};
  }
  async function chercher(fetchRows,value,phase){
    const parsed=lireCode(value,phase);
    // Deux recherches séparées, sans filtre OR construit avec une saisie libre.
    const ref=parsed.reference.replace(/[\\_]/g,'\\$&');
    for(const champ of ['reference_courte','reference']){
      const rows=await fetchRows('missions?'+champ+'=ilike.'+encodeURIComponent(ref)+'&limit=2');
      if(rows&&rows.length>1)throw new Error('Référence ambiguë. Contactez HelixCar.');
      if(rows&&rows.length===1)return rows[0];
    }
    return null;
  }
  root.HCDocumentsMission={code,lireCode,chercher,suffixes};
  if(typeof module==='object')module.exports=root.HCDocumentsMission;
})(typeof window==='object'?window:globalThis);
