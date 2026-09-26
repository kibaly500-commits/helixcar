/* Délai opérationnel commun à toutes les nouvelles demandes. */
(function () {
  'use strict';
  function value(id) { return (document.getElementById(id) || {}).value || ''; }
  function paris(ms) {
    var parts=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
    var p={};parts.forEach(function(x){p[x.type]=x.value;});
    return {date:p.year+'-'+p.month+'-'+p.day,minutes:Number(p.hour)*60+Number(p.minute)};
  }
  function mins(v) { var m=/^(\d{2}):(\d{2})$/.exec(v);return m ? +m[1]*60+(+m[2]) : null; }
  function hm(n) { return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'); }
  function dateId(id) {
    var m=/^(veh-\d+)-(pc|liv|restit)-(heure|cdeb|cfin)$/.exec(id);
    if(m)return m[1]+'-'+m[2]+'-date';
    if(/^veh-\d+-recup-heure$/.test(id))return 'stock-fin';
    var map={'stock-heure-entree':'stock-debut','stock-heure-sortie':'stock-fin','nett-creneau-debut':'nett-date','nett-creneau-fin':'nett-date',
      'pro-horaire-cdeb':'pro-date-debut','pro-horaire-cfin':'pro-date-fin',
      'client-heure-pc':'client-date-pc','client-heure-liv':'client-date-livraison','client-heure-restit':'client-date-restit'};
    m=/^client-(pc|liv|restit)-(cdeb|cfin)$/.exec(id);
    return map[id] || (m ? {pc:'client-date-pc',liv:'client-date-livraison',restit:'client-date-restit'}[m[1]] : null);
  }
  window._hcMinimumHoraireMission = function(id,now) {
    var date=value(dateId(id));if(!date)return 0;
    // Arrondi supérieur à la minute : 14:30:20 autorise 15:01, pas 15:00.
    var limit=paris(Math.ceil(((now===undefined?Date.now():now)+30*60000)/60000)*60000);
    return date < limit.date ? 1440 : date===limit.date ? limit.minutes : 0;
  };
  function message(min) { return min>=1440 ? 'Le délai minimum de 30 minutes impose de choisir une date ultérieure.' : 'Prévoyez au moins 30 minutes : horaire possible à partir de '+hm(min)+'.'; }
  function check(id) {
    var el=document.getElementById(id);if(!el)return true;
    var n=mins(el.value),min=_hcMinimumHoraireMission(id);
    if(n!==null && n<min){_showFieldError(id,message(min));el.dataset.hcDelaiError='1';return false;}
    if(el.dataset.hcDelaiError){_clearFieldError(id);delete el.dataset.hcDelaiError;}
    return true;
  }
  function starts() {
    var service=_typeServiceChoisi(),ids=[];
    if(service==='professionnel')return ['pro-horaire-cdeb'];
    if(service==='nettoyage')return ['nett-creneau-debut'];
    if(!['convoyage','stockage','convoyage_stockage'].includes(service))return ids;
    if(_avecStockage()){
      if(_acheminementStockage()==='depot_client')ids.push('stock-heure-entree');
      if(_sortieStockage()==='recuperation_client')ids.push('stock-heure-sortie');
    }
    var sc=_scenarioTrajet();
    for(var i=0;i<_nbVehicules();i++){
      ['pc','liv','restit'].forEach(function(p){
        var active=p==='pc'?sc.pc:p==='liv'?(sc.liv && _vehiculeLivraisonApresStockage(i)!==false):_vehiculeARestitutionSpecifique(i);
        if(active)ids.push('veh-'+i+'-'+p+(_typeHoraire(i,p)==='creneau'?'-cdeb':'-heure'));
      });
      if(_avecStockage() && _vehiculeLivraisonApresStockage(i)===false)ids.push('veh-'+i+'-recup-heure');
    }
    ['pc','liv','restit'].forEach(function(p){if(_operationApplicableGlobale(p))ids.push(_typeHoraireGlobal(p)==='creneau'?'client-'+p+'-cdeb':_idHeureGlobale(p));});
    return ids;
  }
  window._hcVerifierDelaiMission = function() {
    var ok=true;starts().forEach(function(id){if(!check(id))ok=false;});return ok;
  };
  var validate=window._validateClientStep;
  window._validateClientStep=function(n){var ok=validate.apply(this,arguments);return (n>=2?_hcVerifierDelaiMission():true)&&ok;};
  var submit=window.submitClientForm;
  window.submitClientForm=function(){
    if(!_hcVerifierDelaiMission()){
      _hcAfficherBandeauErreur('Un horaire est trop proche ou dépassé. Prévoyez au moins 30 minutes avant le début de la prestation et corrigez votre demande.');return;
    }
    return submit.apply(this,arguments);
  };
  document.addEventListener('change',function(e){if(e.target && (dateId(e.target.id) || e.target.type==='date'))_hcVerifierDelaiMission();});
  var open=window._hpOuvrirPicker;
  window._hpOuvrirPicker=function(champ){
    var min=_hcMinimumHoraireMission(champ.id);
    if(min>=1440){_showFieldError(champ.id,message(min));return;}
    var ctx=_hpContexteChamp(champ.id);
    if(ctx.mode==='creneau' && _hcMinimumHoraireMission(ctx.idDebut)>1424){
      _showFieldError(ctx.idDebut,'Aucun créneau de 15 minutes ne respecte le délai de 30 minutes à cette date. Choisissez une date ultérieure.');return;
    }
    open.apply(this,arguments);
  };
  var render=window._hpRendreGroupeSimple;
  window._hpRendreGroupeSimple=function(id){
    var el=document.getElementById(id),min=_hcMinimumHoraireMission(id);
    if(el && !el.value && min>0 && min<1440){
      el.value=hm(Math.max(min,870));
      try{return render.apply(this,arguments);}finally{el.value='';}
    }
    return render.apply(this,arguments);
  };
  var adjust=window._hpAjuster;
  window._hpAjuster=function(id){
    adjust.apply(this,arguments);
    var el=document.getElementById(id),min=_hcMinimumHoraireMission(id);
    if(el && min<1440 && mins(el.value)<min){el.value=hm(min);_hpDeclencherEvenements(el);_hpRendrePicker();}
  };
  var confirm=window._hpValiderPicker;
  window._hpValiderPicker=function(){
    if(_hpContexteActif){
      var id=_hpContexteActif.idDebut||_hpContexteActif.idSimple;
      var el=document.getElementById(id),min=_hcMinimumHoraireMission(id);
      if(min>=1440){_showFieldError(id,message(min));return;}
      if(_hpContexteActif.mode==='creneau' && min>1424){
        _showFieldError(id,'Choisissez une date ultérieure pour conserver le délai de 30 minutes et un créneau de 15 minutes.');return;
      }
      if(el && !el.value){var proposed=Math.max(min,870);_hpEcrireHeure(id,Math.floor(proposed/60),proposed%60);}
      if(!check(id)){
        var title=document.getElementById('hp-titre');if(title)title.textContent=message(_hcMinimumHoraireMission(id));return;
      }
    }
    confirm.apply(this,arguments);
  };
})();
