# -*- coding: utf-8 -*-
# Sous-lot 1 (F01-023..029) : déplacement du bloc professionnel vers l'étape 3.
import io, re, sys
P = '/home/user/helixcar/.claude/worktrees/agent-ae96be50198b3cd8d/index.html'
src = io.open(P, encoding='utf-8').read()

def remplacer(old, new, n=1):
    global src
    c = src.count(old)
    assert c == n, ('occurrences inattendues (%d) pour : %r' % (c, old[:90]))
    src = src.replace(old, new)

# ── 1. DÉPLACEMENT DU BLOC HTML (sans en modifier une seule ligne) ──
debut = src.index('      <div id="bloc-socle-professionnel" style="display:none">')
fin = src.index('      <div id="bloc-stockage" style="display:none;')
bloc = src[debut:fin]
# On retire le bloc de l'étape 2 (en gardant une seule ligne vide).
src = src[:debut] + src[fin:]
bloc_strip = bloc.rstrip('\n') + '\n'
ancre3 = '      <div class="form-step" data-step="3">\n\n        <!-- SECTION LIVRAISON -->'
assert src.count(ancre3) == 1
commentaire = (
"      <div class=\"form-step\" data-step=\"3\">\n\n"
"        <!-- LOT F01 (F01-023..029) — TROUVER UN PROFESSIONNEL : ÉTAPE DÉDIÉE.\n"
"             Les quatre rubriques « Votre besoin », « Lieu d'intervention »,\n"
"             « Période et horaires » et « Mission » vivaient sous la liste des\n"
"             services, à l'étape 2. Elles sont DÉPLACÉES telles quelles dans\n"
"             cette étape 3 : aucun libellé, aucun champ, aucune validation,\n"
"             aucun payload ni brouillon n'est modifié — seul l'emplacement.\n"
"             Le bloc « Prise en charge » ci-dessous est masqué pour ce service\n"
"             (attribut data-service-professionnel sur la modale), jamais\n"
"             supprimé : il réapparaît tel quel pour Convoyage / Stockage. -->\n"
+ bloc_strip +
"\n        <!-- SECTION LIVRAISON -->")
src = src.replace(ancre3, commentaire)

# ── 2. CSS : l'étape 3 ne montre QUE les quatre rubriques pour ce service ──
remplacer(
"#modal-client[data-service-nettoyage=\"1\"] .form-step[data-step=\"4\"] > *:not(#bloc-nettoyage-orga) {\n  display: none !important;\n}\n",
"#modal-client[data-service-nettoyage=\"1\"] .form-step[data-step=\"4\"] > *:not(#bloc-nettoyage-orga) {\n  display: none !important;\n}\n"
"\n/* LOT F01 — Trouver un professionnel : l'étape 3 ne montre QUE les quatre\n"
"   rubriques métier. Même principe que le nettoyage ci-dessus : le bloc\n"
"   « Prise en charge » est masqué, jamais supprimé. */\n"
"#modal-client[data-service-professionnel=\"1\"] .form-step[data-step=\"3\"] > *:not(#bloc-socle-professionnel) {\n  display: none !important;\n}\n")

# ── 3. Applicabilité de l'étape 3 ──
remplacer(
"function _estEtapeApplicable(n) {\n  if (n === 1 || n === 2 || n === 5) return true;\n"
"  // Trouver un professionnel : tout le parcours tient dans l'étape 2.\n"
"  // « Continuer » mène donc directement au récapitulatif habituel,\n"
"  // sans créer ni traverser aucune étape supplémentaire.\n"
"  if (n === 4) return !_avecProfessionnel();\n"
"  if (n === 3) return !!_blocsGlobauxActifs().pc;   // prise en charge globale\n",
"function _estEtapeApplicable(n) {\n  if (n === 1 || n === 2 || n === 5) return true;\n"
"  // Trouver un professionnel : l'étape 2 ne porte que le choix du\n"
"  // service ; les quatre rubriques métier vivent dans l'étape 3\n"
"  // (LOT F01). L'étape 4 (véhicules) ne lui est pas applicable :\n"
"  // « Continuer » depuis l'étape 3 mène au récapitulatif habituel.\n"
"  if (n === 4) return !_avecProfessionnel();\n"
"  if (n === 3) return _avecProfessionnel() || !!_blocsGlobauxActifs().pc;   // rubriques métier ou prise en charge globale\n")

# ── 4. Validation de l'étape 2 : le choix du service suffit ──
remplacer(
"    // Trouver un professionnel : validation dédiée puis sortie\n"
"    // immédiate, exactement comme le Nettoyage. Aucune règle\n"
"    // Convoyage/Stockage plus bas ne doit s'appliquer.\n"
"    if (typeService === 'professionnel') {\n"
"      var rP2 = _validateProfessionnelEtape2();\n"
"      if (!rP2.ok) {\n"
"        ok = false;\n"
"        if (!firstInvalid) firstInvalid = document.getElementById(rP2.first);\n"
"      }\n"
"      if (firstInvalid) {\n"
"        try { firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}\n"
"      }\n"
"      return ok;\n"
"    }\n",
"    // Trouver un professionnel : à l'étape 2, seul le choix du service\n"
"    // est exigé — sélectionner ce service active immédiatement\n"
"    // « Continuer ». Les quatre rubriques métier sont validées à\n"
"    // l'ÉTAPE 3 (LOT F01), avec exactement les mêmes règles qu'avant\n"
"    // (_validateProfessionnelEtape2, inchangée). Aucune règle\n"
"    // Convoyage/Stockage plus bas ne doit s'appliquer.\n"
"    if (typeService === 'professionnel') {\n"
"      if (firstInvalid) {\n"
"        try { firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}\n"
"      }\n"
"      return ok;\n"
"    }\n")

# ── 5. Validation de l'étape 3 : les quatre rubriques ──
remplacer(
"  if (n === 3 && _blocsGlobauxActifs().pc) {\n"
"    mark(_checkRequiredText('client-from-rue', null, true), 'client-from-rue');\n",
"  // LOT F01 — Trouver un professionnel : l'étape 3 porte les quatre\n"
"  // rubriques métier. Validation dédiée puis sortie immédiate : le bloc\n"
"  // « Prise en charge » ci-dessous n'est jamais évalué pour ce service.\n"
"  if (n === 3 && _avecProfessionnel()) {\n"
"    var rP3 = _validateProfessionnelEtape2();\n"
"    if (!rP3.ok) {\n"
"      ok = false;\n"
"      if (!firstInvalid) firstInvalid = document.getElementById(rP3.first);\n"
"    }\n"
"    if (firstInvalid) {\n"
"      try { firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}\n"
"    }\n"
"    return ok;\n"
"  }\n\n"
"  if (n === 3 && _blocsGlobauxActifs().pc) {\n"
"    mark(_checkRequiredText('client-from-rue', null, true), 'client-from-rue');\n")

# ── 6. Plafond de navigation : l'étape 3, plus l'étape 2 ──
remplacer(
"  if (!_proPeutContinuerEtape2()) {\n"
"    _etapeMax = Math.min(_etapeMax, 2);\n"
"    if (_formStepState.client > 2) _formStepState.client = 2;\n"
"  }\n}\n",
"  // LOT F01 — les rubriques vivent à l'étape 3 : c'est elle, et non\n"
"  // plus l'étape 2, qui borne la progression tant qu'elles sont\n"
"  // incomplètes.\n"
"  if (!_proPeutContinuerEtape2()) {\n"
"    _etapeMax = Math.min(_etapeMax, 3);\n"
"    if (_formStepState.client > 3) _formStepState.client = 3;\n"
"  }\n}\n")

# ── 7. Garde-fou final à la soumission : l'étape 3 est rejouée ──
remplacer(
"  // Meme garde-fou final pour Trouver un professionnel : tout le\n"
"  // parcours tenant dans l'etape 2, seules les etapes 1 et 2 sont\n"
"  // rejouees, avec les MEMES validateurs que la navigation.\n"
"  if (_avecProfessionnel()) {\n"
"    var _etapeKOPro = null;\n"
"    if (!_validateClientStep(1)) _etapeKOPro = 1;\n"
"    if (!_etapeKOPro && !_validateClientStep(2)) _etapeKOPro = 2;\n",
"  // Meme garde-fou final pour Trouver un professionnel : les etapes 1,\n"
"  // 2 et 3 (les quatre rubriques metier, LOT F01) sont rejouees, avec\n"
"  // les MEMES validateurs que la navigation.\n"
"  if (_avecProfessionnel()) {\n"
"    var _etapeKOPro = null;\n"
"    if (!_validateClientStep(1)) _etapeKOPro = 1;\n"
"    if (!_etapeKOPro && !_validateClientStep(2)) _etapeKOPro = 2;\n"
"    if (!_etapeKOPro && !_validateClientStep(3)) _etapeKOPro = 3;\n")

# ── 8. onChoixService : marqueur de service sur la modale ──
remplacer(
"  var _modalCli = document.getElementById('modal-client');\n"
"  if (_modalCli) _modalCli.setAttribute('data-service-nettoyage', nett ? '1' : '0');\n",
"  var _modalCli = document.getElementById('modal-client');\n"
"  if (_modalCli) _modalCli.setAttribute('data-service-nettoyage', nett ? '1' : '0');\n"
"  // LOT F01 — meme mecanisme pour Trouver un professionnel : l'etape 3\n"
"  // ne montre que ses quatre rubriques, le bloc Prise en charge y est\n"
"  // masque (CSS), jamais supprime.\n"
"  if (_modalCli) _modalCli.setAttribute('data-service-professionnel', pro ? '1' : '0');\n")

# ── 9. resetClientForm : le marqueur repart à zéro ──
remplacer(
"  if (_mc) _mc.setAttribute('data-service-nettoyage', '0');\n",
"  if (_mc) _mc.setAttribute('data-service-nettoyage', '0');\n"
"  if (_mc) _mc.setAttribute('data-service-professionnel', '0');\n")

# ── 10. Étapeur : l'étape 4 inapplicable est masquée (jamais grisée à tort),
#        et l'étape 3 du professionnel porte un stylo (édition) ──
remplacer(
"    if(kind==='after') return '<svg '+common+'><path d=\"M20 12H6M11 7l-5 5 5 5\"/><circle cx=\"19\" cy=\"12\" r=\"2\"/></svg>';\n"
"    return '<svg '+common+'><circle cx=\"12\" cy=\"12\" r=\"8\"/></svg>';\n",
"    if(kind==='after') return '<svg '+common+'><path d=\"M20 12H6M11 7l-5 5 5 5\"/><circle cx=\"19\" cy=\"12\" r=\"2\"/></svg>';\n"
"    // LOT F01 — stylo discret : l'étape métier du parcours « Trouver un professionnel ».\n"
"    if(kind==='edit') return '<svg '+common+'><path d=\"M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z\"/><path d=\"M13.5 6.5l3 3\"/></svg>';\n"
"    return '<svg '+common+'><circle cx=\"12\" cy=\"12\" r=\"8\"/></svg>';\n")
remplacer(
"    if(item3){item3.classList.toggle('hc-step-hidden',!applicable);if(lineBefore&&lineBefore.classList.contains('step-indicator-line'))lineBefore.classList.toggle('hc-step-hidden',!applicable);}\n"
"    ind.querySelectorAll('.step-indicator-item').forEach(function(item){\n"
"      var actual=parseInt(item.getAttribute('data-step-item'),10), meta=stepMeta[actual], n=item.querySelector('.step-indicator-num');\n",
"    if(item3){item3.classList.toggle('hc-step-hidden',!applicable);if(lineBefore&&lineBefore.classList.contains('step-indicator-line'))lineBefore.classList.toggle('hc-step-hidden',!applicable);}\n"
"    // LOT F01 — l'étape 4 (véhicules) n'existe pas pour « Trouver un\n"
"    // professionnel » : elle sort de l'étapeur comme l'étape 3 sort de\n"
"    // celui du nettoyage — jamais une pastille grisée à tort, aucun trou.\n"
"    var item4=ind.querySelector('[data-step-item=\"4\"]'), lineBefore4=item4?item4.previousElementSibling:null;\n"
"    var applicable4=!!_estEtapeApplicable(4);\n"
"    if(item4){item4.classList.toggle('hc-step-hidden',!applicable4);if(lineBefore4&&lineBefore4.classList.contains('step-indicator-line'))lineBefore4.classList.toggle('hc-step-hidden',!applicable4);}\n"
"    var proActif=(typeof _avecProfessionnel==='function')&&_avecProfessionnel();\n"
"    ind.querySelectorAll('.step-indicator-item').forEach(function(item){\n"
"      var actual=parseInt(item.getAttribute('data-step-item'),10), meta=stepMeta[actual], n=item.querySelector('.step-indicator-num');\n"
"      if(actual===3&&proActif)meta={kind:'edit',label:'Votre mission'};\n")
remplacer(
"    if(kind==='clock')return '<svg '+c+'><circle cx=\"12\" cy=\"12\" r=\"7.5\"/><path d=\"M12 7.8V12l2.8 1.7\"/></svg>';\n"
"    return '<svg '+c+'><path d=\"m5 12 4 4 10-10\"/></svg>';\n"
"  }\n"
"  function lockStepper(){\n",
"    if(kind==='clock')return '<svg '+c+'><circle cx=\"12\" cy=\"12\" r=\"7.5\"/><path d=\"M12 7.8V12l2.8 1.7\"/></svg>';\n"
"    // LOT F01 - stylo discret : etape des rubriques metier du parcours\n"
"    // « Trouver un professionnel ». Jamais une voiture, jamais « Valider\n"
"    // un vehicule ».\n"
"    if(kind==='edit')return '<svg '+c+'><path d=\"M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z\"/><path d=\"M13.5 6.5l3 3\"/></svg>';\n"
"    return '<svg '+c+'><path d=\"m5 12 4 4 10-10\"/></svg>';\n"
"  }\n"
"  function lockStepper(){\n")
remplacer(
"    var _nettActif = (typeof _avecNettoyage === 'function') && _avecNettoyage();\n"
"    var kinds={1:'person',2:'request',3:'route',4:(_nettActif?'clock':'vehicle'),5:'check'};\n",
"    var _nettActif = (typeof _avecNettoyage === 'function') && _avecNettoyage();\n"
"    // LOT F01 - etape 3 : stylo pour Trouver un professionnel (ses quatre\n"
"    // rubriques metier), itineraire pour la prise en charge des autres.\n"
"    var _proActif = (typeof _avecProfessionnel === 'function') && _avecProfessionnel();\n"
"    var kinds={1:'person',2:'request',3:(_proActif?'edit':'route'),4:(_nettActif?'clock':'vehicle'),5:'check'};\n")

# ── 11. En-tête de la section professionnelle : le commentaire dit vrai ──
remplacer(
"// Parcours porte par l'ETAPE 2 existante : aucune nouvelle etape\n"
"// globale, \"Continuer\" mene directement au recapitulatif habituel\n"
"// (cf. _estEtapeApplicable, qui rend l'etape 4 inapplicable ici).\n",
"// LOT F01 — l'etape 2 ne porte que le choix du service ; les quatre\n"
"// rubriques metier vivent dans l'ETAPE 3 (bloc #bloc-socle-professionnel,\n"
"// deplace tel quel). \"Continuer\" depuis l'etape 3 mene directement au\n"
"// recapitulatif habituel (cf. _estEtapeApplicable, qui rend l'etape 4\n"
"// inapplicable ici).\n")

io.open(P, 'w', encoding='utf-8').write(src)
print('OK — index.html modifié')
