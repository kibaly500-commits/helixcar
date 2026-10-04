/* Calendriers : repères indépendants des choix autorisés, bornes réciproques
   et contrôles date/heure partagés par le formulaire public et son iframe. */
(function () {
  'use strict';
  var value = function (id) { return (document.getElementById(id) || {}).value || ''; };
  function operation(ctx, prefix) {
    var veh = ctx.type === 'vehicule', b = veh ? 'veh-' + ctx.i + '-' + prefix : 'client-' + prefix;
    var date = veh ? b + '-date' : 'client-date-' + (prefix === 'liv' ? 'livraison' : prefix);
    var range = veh ? _typeHoraire(ctx.i, prefix) === 'creneau' : _typeHoraireGlobal(prefix) === 'creneau';
    var h = veh ? b + '-heure' : _idHeureGlobale(prefix);
    return {date:date, start:range ? b + '-cdeb' : h, end:range ? b + '-cfin' : h,
      label:prefix === 'pc' ? 'prise en charge' : prefix === 'liv' ? 'livraison' : 'restitution'};
  }
  function operations(ctx) {
    if (!ctx || !/^(vehicule|mono)$/.test(ctx.type) || !/^(pc|liv|restit)$/.test(ctx.prefixe)) return [];
    var sc = _scenarioTrajet(), result = [];
    if (sc.pc) result.push(operation(ctx, 'pc'));
    else if (_avecStockage()) result.push({date:'stock-debut',label:'début du stockage'});
    if (sc.liv && (ctx.type !== 'vehicule' || !_avecStockage() || _vehiculeLivraisonApresStockage(ctx.i))) result.push(operation(ctx,'liv'));
    if (ctx.type === 'vehicule' ? _vehiculeARestitutionSpecifique(ctx.i) : !!(document.getElementById('client-restit') || {}).checked) result.push(operation(ctx,'restit'));
    return result;
  }
  function pairs(id) {
    var ctx = _hcContexteChamp(id), ops = operations(ctx), result = [];
    for (var i=1;i<ops.length;i++) result.push({a:ops[i-1],b:ops[i],gap:15});
    var p = _hcPeriodeDeuxBornes(id);
    if (p) {
      var a={date:p.debut,label:'début'}, b={date:p.fin,label:'fin'};
      if (p.debut === 'nett-date') {a.start=a.end='nett-creneau-debut';b.start=b.end='nett-creneau-fin';}
      if (p.debut === 'pro-date-debut') {a.start=a.end='pro-horaire-cdeb';b.start=b.end='pro-horaire-cfin';}
      result.push({a:a,b:b,gap:15});
    }
    return result;
  }
  // Le plancher prise en charge est déjà expliqué par les jours grisés.
  function silentLowerBound(pair, id) {
    return pair.b.date === id && (pair.a.label === 'prise en charge' || pair.a.label === 'début du stockage');
  }
  function message(pair, id, time) {
    var preceding = pair.a.date === id, other = preceding ? pair.b : pair.a;
    return (preceding ? 'Pour choisir une date après ' : 'Pour choisir une date avant ') +
      'le ' + _formaterDateFr(value(other.date)) + ', modifiez d’abord la date de ' + other.label + '.' +
      (time ? ' Le même jour, prévoyez au moins '+pair.gap+' minutes entre les horaires (fin du créneau comprise).' : '');
  }
  function issue(id, candidate, overrides) {
    function read(key) {return overrides && Object.prototype.hasOwnProperty.call(overrides,key) ? overrides[key] : key === id ? candidate : value(key);}
    var list=pairs(id);
    for (var i=0;i<list.length;i++) {
      var p=list[i], a=read(p.a.date), b=read(p.b.date);
      if (!a || !b) continue;
      if (b<a) return message(p,id,false);
      var ah=read(p.a.end), bh=read(p.b.start);
      if (ah && bh && new Date(b+'T'+bh).getTime() < new Date(a+'T'+ah).getTime()+p.gap*60000)
        return 'Horaires incompatibles : la '+p.b.label+' doit commencer au moins '+p.gap+' minutes après la fin de '+p.a.label+'. Modifiez d’abord l’autre horaire ou choisissez une autre date.';
    }
    return '';
  }
  function note(parent, id, text, before) {
    var el=document.getElementById(id);
    if (!el) {el=document.createElement('p');el.id=id;el.className='hc-chrono-note';el.setAttribute('aria-live','polite');parent.insertBefore(el,before || null);}
    el.textContent=text;el.hidden=!text;
  }
  function calendarId() {return _hcCalPeriode ? _hcCalPeriode[_hcCalSousEtapePeriode] : _hcCalChampActif;}
  function calendarNote(text) {
    if (!_hcCalOverlay) return;
    if (_hcCalPeriode && _hcCalPeriode.debut === 'stock-debut') text = '';
    note(_hcCalOverlay.querySelector('.hc-cal'),'hc-cal-chrono-note',text,_hcCalOverlay.querySelector('#hc-cal-actions'));
  }
  var oldMin=_hcDateMinimaleChamp, oldMax=_hcDateMaximaleChamp;
  window._hcDateMinimaleChamp=function(id) {
    var dates=[oldMin(id)];pairs(id).forEach(function(p){if(p.b.date===id)dates.push(_hcParserYMD(value(p.a.date)));});
    return dates.filter(Boolean).sort(function(a,b){return b-a;})[0] || null;
  };
  window._hcDateMaximaleChamp=function(id) {
    var dates=[oldMax(id)];pairs(id).forEach(function(p){if(p.a.date===id)dates.push(_hcParserYMD(value(p.b.date)));});
    return dates.filter(Boolean).sort(function(a,b){return a-b;})[0] || null;
  };
  var allowed=_hcJourAutorise;
  window._hcJourAutorise=function(date) {
    return allowed(date) && !issue(calendarId(),_hcFormaterYMD(date));
  };
  var render=_hcRendreCalendrier;
  window._hcRendreCalendrier=function() {
    render();if (!_hcCalOverlay || !_hcCalChampActif) return;
    _hcCalOverlay.querySelectorAll('[data-jour]').forEach(function(b){
      if (/hc-cal-jour--(p[12]-|double|triple|transition)/.test(b.className)) b.setAttribute('data-hc-repere','true');
    });
    calendarNote('');
    // Un jour interdit reste non sélectionnable. Son conteneur reçoit
    // uniquement la tentative, pour expliquer le blocage à ce moment-là.
    if (!_hcCalPeriode) _hcCalOverlay.querySelectorAll('[data-jour]').forEach(function(button) {
      if (!button.disabled) return;
      var day=Number(button.dataset.jour), date=new Date(_hcCalAnneeAffichee,_hcCalMoisAffiche,day);
      var id=calendarId(), candidate=_hcFormaterYMD(date);
      if(date<_hcAujourdhui() || !issue(id,candidate) || pairs(id).some(function(p){return silentLowerBound(p,id) && value(p.a.date) && candidate<value(p.a.date);})) return;
      var hit=document.createElement('span');
      hit.style.display='grid';hit.style.minWidth='0';
      hit.setAttribute('role','button');hit.setAttribute('tabindex','0');
      hit.setAttribute('aria-disabled','true');
      hit.setAttribute('aria-label',_formaterDateFr(candidate)+' : date indisponible, afficher la raison');
      button.setAttribute('aria-hidden','true');
      button.parentNode.insertBefore(hit,button);hit.appendChild(button);
      hit.addEventListener('click',function(){_hcSelectionnerJour(day);});
      hit.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();_hcSelectionnerJour(day);}});
    });
  };
  var select=_hcSelectionnerJour;
  window._hcSelectionnerJour=function(j) {
    var id=calendarId();
    if (Number.isInteger(j) && j>0 && j<=new Date(_hcCalAnneeAffichee,_hcCalMoisAffiche+1,0).getDate()) {
      var candidate=_hcFormaterYMD(new Date(_hcCalAnneeAffichee,_hcCalMoisAffiche,j));
      if(pairs(id).some(function(p){return silentLowerBound(p,id) && value(p.a.date) && candidate<value(p.a.date);})) return;
      var why=issue(id,candidate);
      if (why) {calendarNote(why);return;}
    }
    return select(j);
  };
  // Défense à la validation : les dates restent contrôlées même sans horaires
  // (ancien brouillon / valeur restaurée hors du calendrier).
  ['verifierChronologieVehicule','_chronologieVehiculeOk','verifierChronologieGlobale'].forEach(function(name){
    var original=window[name];
    window[name]=function(i) {
      var id=name==='verifierChronologieGlobale' ? 'client-date-livraison' : 'veh-'+i+'-liv-date';
      var why=issue(id,value(id)), ok=original.apply(this,arguments);
      if(why && name!=='_chronologieVehiculeOk') _showFieldError(id,why);
      return ok && !why;
    };
  });
  // Les flèches d'heure prévisualisent une saisie. Refuser une transaction
  // incohérente et restaurer uniquement les champs de ce sélecteur.
  function dateForTime(id) {
    var m=/^(veh-\d+-(?:pc|liv|restit))-(?:heure|cdeb|cfin)$/.exec(id);
    if(m)return m[1]+'-date';
    m=/^client-(?:(pc|liv|restit)-(?:cdeb|cfin)|heure-(pc|liv|restit))$/.exec(id);
    if(m)return 'client-date-'+((m[1]||m[2])==='liv'?'livraison':(m[1]||m[2]));
    if(/^nett-creneau-/.test(id))return id.endsWith('debut')?'nett-date':'nett-date-fin';
    if(/^pro-horaire-/.test(id))return id.endsWith('cdeb')?'pro-date-debut':'pro-date-fin';
    return null;
  }
  function hourTransaction(original,args) {
    var ctx=_hpContexteActif;if(!ctx)return original.apply(window,args);
    var ids=ctx.mode==='simple'?[ctx.idSimple]:[ctx.idDebut,ctx.idFin], before={};
    ids.forEach(function(id){before[id]=value(id);});
    // Capture the picker close until the candidate has passed validation.
    var close=window._hpFermerPicker, emit=window._hpDeclencherEvenements, closing=false, pending=[];
    window._hpFermerPicker=function(){closing=true;};
    window._hpDeclencherEvenements=function(el){if(pending.indexOf(el)<0)pending.push(el);};
    try {original.apply(window,args);} catch(error) {
      ids.forEach(function(id){document.getElementById(id).value=before[id];});
      throw error;
    } finally {window._hpFermerPicker=close;window._hpDeclencherEvenements=emit;}
    var why='';ids.some(function(id){var date=dateForTime(id);why=date?issue(date,value(date)):'';return !!why;});
    if(why){
      ids.forEach(function(id){document.getElementById(id).value=before[id];});
      _hpRendrePicker();
    } else {pending.forEach(emit);if(closing)close();}
    if(_hpOverlay)note(_hpOverlay.querySelector('#hp-picker'),'hp-chrono-note',why,_hpOverlay.querySelector('.hp-actions'));
  }
  function minutes(v) {var m=/^(\d{2}):(\d{2})$/.exec(v||'');return m?Number(m[1])*60+Number(m[2]):null;}
  function clock(n) {return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
  function plannedTime(op, fallback) {
    var start=minutes(value(op.start)), end=minutes(value(op.end));
    if(op.start!==op.end && start!==null && end!==null)
      return op.label+' prévue entre '+clock(start)+' et '+clock(end);
    return op.label+' prévue à '+clock(fallback);
  }
  function limits(id, basic) {
    var date=dateForTime(id), result={min:0,max:1439,reference:'',label:'',active:false};
    var ctx=date && _hcContexteChamp(date);
    if(!ctx || !/^(vehicule|mono)$/.test(ctx.type))return result;
    pairs(date).forEach(function(p){
      if(!value(p.a.date)||value(p.a.date)!==value(p.b.date))return;
      if(p.b.date===date){var end=minutes(value(p.a.end));if(end!==null){result.min=Math.max(result.min,end+p.gap);result.reference=plannedTime(p.a,end);result.label=p.b.label;result.active=true;}}
      if(p.a.date===date){var begin=minutes(value(p.b.start));if(begin!==null){result.max=Math.min(result.max,begin-p.gap);result.upper=plannedTime(p.b,begin);result.active=true;}}
    });
    if(!basic && result.active && _hpContexteActif && _hpContexteActif.mode==='creneau'){
      if(id===_hpContexteActif.idDebut)result.max-=15;
      if(id===_hpContexteActif.idFin){
        var first=limits(_hpContexteActif.idDebut,true), start=minutes(value(_hpContexteActif.idDebut));
        if(start===null)start=first.min>0?first.min:870;
        start=Math.max(first.min,Math.min(first.max-15,start));
        result.min=Math.max(result.min,start+15);
      }
    }
    return result;
  }
  var readHour=window._hpLireHeureMinute;
  window._hpLireHeureMinute=function(id){
    var raw=readHour(id), bound=limits(id);
    if(!bound.active || bound.min>bound.max)return raw;
    var n=raw.h===null?Math.max(870,bound.min):raw.h*60+raw.min;
    // A blank dependent time starts at the earliest allowed time.
    if(raw.h===null && bound.min>0)n=bound.min;
    n=Math.max(bound.min,Math.min(bound.max,n));
    if(_hpContexteActif && _hpContexteActif.mode==='creneau' && id===_hpContexteActif.idFin){
      var first=window._hpLireHeureMinute(_hpContexteActif.idDebut);
      if(first.h!==null)n=Math.max(n,first.h*60+first.min+15);
    }
    return {h:Math.floor(n/60),min:n%60};
  };
  function candidate(id,type,delta){var hm=_hpLireHeureMinute(id), n=hm.h===null?870:hm.h*60+hm.min;return type==='h'?n+delta*60:(delta>0?Math.floor(n/15)+1:Math.ceil(n/15)-1)*15;}
  function pickerGuidance(){
    if(!_hpContexteActif||!_hpOverlay)return;
    var id=_hpContexteActif.idSimple||_hpContexteActif.idDebut,bound=limits(id), text='';
    if(bound.active){
      if(bound.min>bound.max)text='Aucun horaire compatible ce jour-là. Choisissez une autre date.';
      else if(bound.reference)text=bound.reference.charAt(0).toUpperCase()+bound.reference.slice(1)+'. '+bound.label.charAt(0).toUpperCase()+bound.label.slice(1)+' possible à partir de '+clock(bound.min)+'.';
      else if(bound.upper)text=bound.upper.charAt(0).toUpperCase()+bound.upper.slice(1)+'. Horaire possible jusqu’à '+clock(bound.max)+'.';
    }
    note(_hpOverlay.querySelector('#hp-picker'),'hp-chrono-note',text,_hpOverlay.querySelector('.hp-actions'));
    _hpOverlay.querySelectorAll('.hp-step-btn').forEach(function(b){
      var lim=limits(b.dataset.hpId), n=candidate(b.dataset.hpId,b.dataset.hpType,Number(b.dataset.hpDelta));
      b.disabled=lim.active && (lim.min>lim.max || n<lim.min || n>lim.max);
    });
    _hpOverlay.querySelector('#hp-ok').textContent=bound.min>bound.max?'Fermer':'OK';
  }
  var renderHour=window._hpRendrePicker;
  window._hpRendrePicker=function(){renderHour.apply(this,arguments);pickerGuidance();};
  var openHour=window._hpOuvrirPicker;
  window._hpOuvrirPicker=function(){openHour.apply(this,arguments);pickerGuidance();};
  var adjustHour=window._hpAjuster;
  window._hpAjuster=function(id,type,delta){
    var bound=limits(id), n=candidate(id,type,delta);
    if(bound.active && (bound.min>bound.max||n<bound.min||n>bound.max)){pickerGuidance();return;}
    var args=arguments;
    hourTransaction(function(){
      // Existing range controls read raw values: seed their displayed valid
      // suggestions inside the transaction, never while merely opening.
      if(_hpContexteActif && _hpContexteActif.mode==='creneau')[_hpContexteActif.idDebut,_hpContexteActif.idFin].forEach(function(key){if(limits(key).active){var hm=_hpLireHeureMinute(key);document.getElementById(key).value=clock(hm.h*60+hm.min);}});
      adjustHour.apply(window,args);
    },[]);
    pickerGuidance();
  };
  var validateHour=window._hpValiderPicker;
  window._hpValiderPicker=function(){
    if(!_hpContexteActif)return validateHour();
    var ids=_hpContexteActif.mode==='simple'?[_hpContexteActif.idSimple]:[_hpContexteActif.idDebut,_hpContexteActif.idFin];
    if(ids.some(function(id){var b=limits(id);return b.min>b.max;})){_hpFermerPicker();return;}
    hourTransaction(function(){ids.forEach(function(id){if(limits(id).active){var hm=_hpLireHeureMinute(id);document.getElementById(id).value=clock(hm.h*60+hm.min);}});validateHour();},[]);
  };
})();
