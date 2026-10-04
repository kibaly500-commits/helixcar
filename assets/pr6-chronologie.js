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
    var id=calendarId(), instructions=[];
    pairs(id).forEach(function(p){if(!silentLowerBound(p,id) && (value(p.a.date)&&id===p.b.date || value(p.b.date)&&id===p.a.date))instructions.push(message(p,id,false));});
    calendarNote(instructions.join(' '));
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
  var openHour=window._hpOuvrirPicker;
  window._hpOuvrirPicker=function(){openHour.apply(this,arguments);var n=document.getElementById('hp-chrono-note');if(n){n.textContent='';n.hidden=true;}};
  ['_hpAjuster','_hpValiderPicker'].forEach(function(name){var original=window[name];window[name]=function(){return hourTransaction(original,arguments);};});
})();
