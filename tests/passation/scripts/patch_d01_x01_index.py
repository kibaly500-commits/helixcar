#!/usr/bin/env python3
# Lots D01 (mode intégré, complétion par véhicule) et X01 (vitrine) — index.html
import io, os, sys
CHEMIN = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'index.html'))
src = io.open(CHEMIN, encoding='utf-8').read()

def rep(old, new, n=1):
    global src
    c = src.count(old)
    if c != n:
        print('ECHEC (%d occurrence(s), attendu %d) :\n%s' % (c, n, old[:220])); sys.exit(1)
    src = src.replace(old, new)

def tranche(debut, fin, new):
    global src
    if src.count(debut) != 1 or src.count(fin) != 1:
        print('ECHEC tranche : %d / %d\n%s\n%s' % (src.count(debut), src.count(fin), debut[:120], fin[:120])); sys.exit(1)
    a = src.index(debut); b = src.index(fin); assert a < b
    src = src[:a] + new + src[b:]

# ══════════════════════════════════════════════════════════════
# D01 — LE FORMULAIRE INTÉGRÉ RESTE DANS LE SHELL, SANS IDENTITÉ
# ══════════════════════════════════════════════════════════════

# 1. Garde précoce dans <head> : en mode intégré, la vitrine n'est jamais
#    peinte (D01-004), avant même que le corps ne soit analysé.
rep("""</head>""", """<!-- LOT D01 — garde précoce du mode intégré (?integre=1 dans un cadre) :
     la vitrine ne doit jamais apparaître, même un instant, dans l'espace
     client. La classe est posée avant l'analyse du corps ; le reste du
     mode intégré (body.hc-integre) prend le relais au chargement. -->
<style>
  html.hc-integre-tot body > *:not(.modal-overlay) { display: none !important; }
  html.hc-integre-tot body { background: #fff; }
</style>
<script>
(function () {
  try {
    var p = new URLSearchParams(window.location.search || '');
    if (p.get('integre') === '1' && window.parent !== window) {
      document.documentElement.classList.add('hc-integre-tot');
    }
  } catch (e) {}
})();
</script>
</head>""")

# 2. Le titre « Devenir client » et son sous-titre portent un identifiant :
#    ils disparaissent quand l'identité est déjà connue.
rep("""      <h2>Devenir client</h2>""", """      <h2 id="client-modal-titre">Devenir client</h2>""")
rep("""      <p style="color:#666;font-size:.88rem;margin-bottom:20px">Créez votre compte HelixCar en quelques étapes.</p>""",
    """      <p style="color:#666;font-size:.88rem;margin-bottom:20px" id="client-modal-sous-titre">Créez votre compte HelixCar en quelques étapes.</p>""")

# 3. CSS du mode intégré : même traitement pour l'écran de complétion,
#    titre/sous-titre masqués, bouton Continuer à sa taille, retour visible.
rep("""  body.hc-integre #modal-client .modal-close { display: none; }
  @media (max-width: 640px) {
    body.hc-integre #modal-client .modal { padding: 20px 16px 28px; }
  }""", """  body.hc-integre #modal-client .modal-close { display: none; }
  @media (max-width: 640px) {
    body.hc-integre #modal-client .modal { padding: 20px 16px 28px; }
  }
  /* LOT D01 — l'écran « Compléter mes informations » vit lui aussi dans
     l'espace client : même mise en page intégrée que le formulaire. */
  body.hc-integre #modal-completer.modal-overlay {
    position: static; display: block; background: transparent;
    backdrop-filter: none; -webkit-backdrop-filter: none;
    padding: 0; overflow: visible; opacity: 1; visibility: visible;
  }
  body.hc-integre #modal-completer .modal {
    max-width: 100%; width: 100%; min-height: 0; margin: 0;
    border-radius: 0; border: 0; box-shadow: none; padding: 26px 30px 34px;
  }
  body.hc-integre #modal-completer .modal::before { display: none; }
  body.hc-integre #modal-completer .modal-close { display: none; }
  #completer-retour { display: none; }
  body.hc-integre #completer-retour { display: inline-flex; }
  /* Identité déjà connue (D01-005..007) : ni « Devenir client », ni
     « Créez votre compte », ni pastille d'identité. */
  body.hc-integre #client-modal-titre, body.hc-integre #client-modal-sous-titre,
  body.hc-sans-identite #client-modal-titre, body.hc-sans-identite #client-modal-sous-titre { display: none !important; }
  /* D01-008 — dans l'espace client, « Continuer » n'occupe plus toute la
     largeur du bloc : la grande barre rouge sous le formulaire, c'était lui. */
  body.hc-integre #client-step-nav .btn-step-next { flex: 0 0 auto; min-width: 220px; margin-left: auto; }
  /* Regroupement par véhicule dans l'écran de complétion. */
  .completer-groupe { margin: 14px 0 6px; padding-top: 10px; border-top: 1px solid #eee; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .completer-groupe strong { font-size: .9rem; }
  .completer-etat { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 3px 9px; border-radius: 100px; background: #F3F4F6; color: #555; }
  .completer-etat--complet { background: rgba(31,122,77,.12); color: #1F7A4D; }""")

# 4. Démarrage depuis l'espace client : l'identité connue retire l'étape 1.
rep("""  _formStepState.client = 2;
  if (typeof _etapeMax !== 'undefined') _etapeMax = Math.max(_etapeMax || 1, 2);
  if (typeof _renderFormStep === 'function') _renderFormStep('client');
  return true;
}
""", """  // LOT D01 — l'identité est connue : l'étape 1 n'existe plus pour ce
  // parcours (pastille retirée, retour impossible en dessous de l'étape 2).
  document.body.classList.add('hc-sans-identite');
  _formStepState.client = 2;
  if (typeof _etapeMax !== 'undefined') _etapeMax = Math.max(_etapeMax || 1, 2);
  if (typeof _renderFormStep === 'function') _renderFormStep('client');
  return true;
}

// LOT D01 — sans identité à redemander (D01-005..009). Ces enveloppes
// n'altèrent aucune règle du formulaire : elles retirent la pastille
// d'identité de l'étapeur, empêchent d'y revenir, et renumérotent les
// intitulés « Aller à l'étape N » sur le rang réellement visible.
(function () {
  var rendreOrig = _renderFormStep;
  _renderFormStep = function (type) {
    rendreOrig(type);
    if (type !== 'client' || !document.body.classList.contains('hc-sans-identite')) return;
    var item1 = document.querySelector('#client-step-indicator .step-indicator-item[data-step-item="1"]');
    if (item1) {
      item1.classList.add('hc-step-hidden');
      item1.classList.remove('done', 'active', 'atteinte');
      item1.dataset.cliquable = '0';
      item1.style.cursor = '';
      item1.removeAttribute('title');
    }
    var nav = document.getElementById('client-step-nav');
    if (nav) nav.classList.toggle('step-first', _formStepState.client <= 2);
    var rang = 0;
    document.querySelectorAll('#client-step-indicator .step-indicator-item').forEach(function (el) {
      if (el.classList.contains('hc-step-hidden') || el.classList.contains('inapplicable')) return;
      rang++;
      if (el.dataset.cliquable === '1') el.setAttribute('title', 'Aller à l\\'étape ' + rang);
    });
  };
  var precedentOrig = clientStepPrev;
  clientStepPrev = function () {
    if (document.body.classList.contains('hc-sans-identite') && _formStepState.client <= 2) return;
    precedentOrig();
  };
  var peutOrig = _peutNaviguerVersEtape;
  _peutNaviguerVersEtape = function (n) {
    if (n === 1 && document.body.classList.contains('hc-sans-identite')) return false;
    return peutOrig(n);
  };
})();
""")

# 5. L'écran de complétion : regroupement par véhicule, libellés complets,
#    enregistrement progressif, dialogue avec l'espace client.
rep("""    <button type="button" id="completer-envoyer" class="btn btn-primary"
            style="width:100%;justify-content:center;font-size:.92rem"
            onclick="envoyerInformationsCompletees()">Enregistrer mes informations</button>
  </div>
</div>""", """    <button type="button" id="completer-envoyer" class="btn btn-primary"
            style="width:100%;justify-content:center;font-size:.92rem"
            onclick="envoyerInformationsCompletees()">Enregistrer mes informations</button>
    <button type="button" id="completer-retour" class="btn"
            style="width:100%;justify-content:center;font-size:.92rem;margin-top:10px"
            onclick="_hcFermerCompletion()">← Retour à mes informations</button>
  </div>
</div>""")

tranche("function _completerRendre(lignes) {", "async function ouvrirCompleterInformations(demandeId) {", """// LOT D01 — regroupement par véhicule (D01-012/013) et états « Complet »
// (D01-016). Les clés vehicule_<n>_… viennent du serveur (migration 101) ;
// l'identité disponible (marque/modèle, immatriculation) titre le groupe.
function _completerGrouper(lignes) {
  var groupes = {}, ordre = [];
  lignes.forEach(function (l) {
    var m = /^vehicule_(\\d+)_/.exec(l.cle || '');
    var cle = m ? 'vehicule_' + m[1] : 'general';
    if (!groupes[cle]) {
      groupes[cle] = { cle: cle, rang: m ? Number(m[1]) : 0, titre: m ? 'Véhicule ' + m[1] : 'Informations générales', lignes: [], identite: '' };
      ordre.push(cle);
    }
    groupes[cle].lignes.push(l);
    if (m && /_(marque_modele|immatriculation)$/.test(l.cle) && l.valeur && !groupes[cle].identite) groupes[cle].identite = l.valeur;
  });
  return ordre.map(function (k) { return groupes[k]; }).sort(function (a, b) { return a.rang - b.rang; });
}
function _completerEstRestante(l) { return l.statut === 'attendue' || l.statut === 'a_corriger'; }
function _completerLibelle(l) {
  var base = String(l.libelle || l.cle || '');
  return l.statut === 'a_corriger' ? base + ' — à corriger' : base + ' manquante';
}

// Rend les rubriques par groupe : seules les manquantes ou à corriger
// ont un champ, avec les mêmes composants que le formulaire
// (.modal-form-group, label, champ). Une rubrique validée n'apparaît
// jamais comme champ ; son groupe la compte comme renseignée.
function _completerRendre(lignes) {
  var zone = document.getElementById('completer-rubriques');
  var prog = document.getElementById('completer-progression');
  if (!zone) return;
  zone.innerHTML = '';

  var total = lignes.length;
  var fournies = lignes.filter(function (l) { return !_completerEstRestante(l); }).length;
  if (prog) {
    prog.style.display = 'block';
    prog.textContent = fournies + ' information' + (fournies > 1 ? 's' : '')
      + ' sur ' + total + ' déjà ' + (fournies > 1 ? 'renseignées' : 'renseignée') + '.';
  }

  var aCompleter = lignes.filter(_completerEstRestante);
  _completerRubriques = aCompleter;

  if (!aCompleter.length) {
    zone.innerHTML = '<p style="font-size:.85rem;color:#4B5563" id="completer-complet">'
      + 'Aucune information ne manque pour cette demande. Merci !</p>';
    var b = document.getElementById('completer-envoyer');
    if (b) b.style.display = 'none';
    return;
  }
  var bouton = document.getElementById('completer-envoyer');
  if (bouton) bouton.style.display = '';

  var groupes = _completerGrouper(lignes);
  var plusieurs = groupes.length > 1;
  groupes.forEach(function (g) {
    var restantes = g.lignes.filter(_completerEstRestante);
    if (plusieurs) {
      var entete = document.createElement('div');
      entete.className = 'completer-groupe';
      entete.setAttribute('data-groupe', g.cle);
      var titre = document.createElement('strong');
      titre.textContent = g.titre + (g.identite ? ' · ' + g.identite : '');
      var etat = document.createElement('span');
      etat.className = 'completer-etat' + (restantes.length ? '' : ' completer-etat--complet');
      etat.textContent = restantes.length ? restantes.length + ' à compléter' : 'Complet';
      entete.appendChild(titre); entete.appendChild(etat);
      zone.appendChild(entete);
    }
    restantes.forEach(function (l) {
      var groupe = document.createElement('div');
      groupe.className = 'modal-form-group';
      groupe.setAttribute('data-cle', l.cle);

      var label = document.createElement('label');
      label.textContent = _completerLibelle(l);
      var etoile = document.createElement('span');
      etoile.className = 'field-required';
      etoile.textContent = '*';
      label.appendChild(document.createTextNode(' '));
      label.appendChild(etoile);
      groupe.appendChild(label);

      if (l.statut === 'a_corriger' && l.commentaire) {
        var motif = document.createElement('div');
        motif.style.cssText = 'background:#FFFBEB;border:1.5px solid #FCD34D;border-radius:2px;'
          + 'padding:8px 10px;margin-bottom:8px;font-size:.78rem;color:#92400E';
        motif.textContent = 'À corriger : ' + l.commentaire;
        groupe.appendChild(motif);
      }

      var champ = document.createElement('input');
      champ.type = (l.cle.indexOf('date') !== -1) ? 'date'
                 : (l.cle.indexOf('tel') !== -1) ? 'tel' : 'text';
      champ.id = _completerChampId(l.cle);
      champ.value = l.valeur || '';
      groupe.appendChild(champ);
      zone.appendChild(groupe);
    });
  });
}

// Fermeture : dans l'espace client, on prévient le cadre parent ; sur
// le site, on ferme simplement la fenêtre.
function _hcFermerCompletion() {
  if (_hcModeIntegre()) {
    try { window.parent.postMessage({ type: 'hc-completion-fermee' }, window.location.origin); } catch (e) {}
    return;
  }
  if (typeof closeModal === 'function') closeModal('completer');
}

""")

rep("""  var reponses = {};
  var manquant = null;
  _completerRubriques.forEach(function (l) {
    var el = document.getElementById(_completerChampId(l.cle));
    var v = el ? String(el.value || '').trim() : '';
    if (!v) { if (!manquant) manquant = l.libelle; return; }
    reponses[l.cle] = v;
  });
  if (manquant) {
    _completerAfficherMessage('Renseignez « ' + manquant +' » avant d\\'enregistrer.');
    return;
  }
""", """  // LOT D01 — enregistrement PROGRESSIF (D01-016) : ce qui est saisi
  // part maintenant, le reste peut attendre. Le serveur ignore les
  // rubriques absentes et n'écrase jamais une rubrique validée.
  var reponses = {};
  var nbSaisies = 0;
  _completerRubriques.forEach(function (l) {
    var el = document.getElementById(_completerChampId(l.cle));
    var v = el ? String(el.value || '').trim() : '';
    if (!v) return;
    reponses[l.cle] = v;
    nbSaisies++;
  });
  if (!nbSaisies) {
    _completerAfficherMessage('Renseignez au moins une information avant d\\'enregistrer.');
    return;
  }
""")
rep("""    if (r && r.error) throw new Error(r.error.message);
    _completerAfficherMessage('Vos informations ont bien été enregistrées.', 'ok');
    // On relit l'état RÉEL depuis le serveur : après un F5 ou une
    // reprise, l'écran montre toujours ce que la base contient.
    var relu = await _sb.rpc('informations_demande', { p_client_id: _completerDemandeId });
    if (relu && !relu.error) _completerRendre(relu.data || []);
""", """    if (r && r.error) throw new Error(r.error.message);
    // On relit l'état RÉEL depuis le serveur : après un F5 ou une
    // reprise, l'écran montre toujours ce que la base contient.
    var relu = await _sb.rpc('informations_demande', { p_client_id: _completerDemandeId });
    var lignesRelues = (relu && !relu.error) ? (relu.data || []) : null;
    if (lignesRelues) _completerRendre(lignesRelues);
    var restantes = lignesRelues ? lignesRelues.filter(_completerEstRestante).length : null;
    _completerAfficherMessage('Vos informations ont bien été enregistrées.'
      + (restantes ? ' Il reste ' + restantes + ' information' + (restantes > 1 ? 's' : '') + ' à renseigner : maintenant ou plus tard, rien n\\'est perdu.' : ''), 'ok');
    // L'espace client relit son onglet depuis le serveur, jamais depuis ce message.
    if (_hcModeIntegre()) {
      try { window.parent.postMessage({ type: 'hc-completion-enregistree' }, window.location.origin); } catch (e) {}
    }
""")
rep("""async function _hcOuvrirCompletionDepuisUrl() {
  var params = new URLSearchParams(window.location.search || '');
  var id = params.get('completer');
  if (!id) return false;
  await ouvrirCompleterInformations(id);
  return true;
}""", """async function _hcOuvrirCompletionDepuisUrl() {
  var params = new URLSearchParams(window.location.search || '');
  var id = params.get('completer');
  if (!id) return false;
  // LOT D01 — dans l'espace client (cadre intégré), la vitrine s'efface
  // et l'écran de complétion occupe le bloc.
  _hcActiverModeIntegre();
  await ouvrirCompleterInformations(id);
  return true;
}""")

# ══════════════════════════════════════════════════════════════
# X01 — LA VITRINE NE MENT PLUS
# ══════════════════════════════════════════════════════════════

# 6. Pied de page : plus de lien sans cible.
rep("""      <a href="#">Convoyage standard</a>""", """      <a href="#services">Convoyage standard</a>""")
rep("""      <a href="#">Véhicules de luxe</a>""", """      <a href="#services">Véhicules de luxe</a>""")
rep("""      <a href="#">Gestion de parc</a>""", """      <a href="#services">Gestion de parc</a>""")
rep("""      <a href="#">Stockage</a>""", """      <a href="#stockage-automobile">Stockage</a>""")
rep("""      <a href="#">Nettoyage</a>""", """      <a href="#services">Nettoyage</a>""")
rep("""      <a href="#">Formulaire contact</a>""", """      <a href="#recontact">Formulaire contact</a>""")
for mort in ['Blog', 'Mentions légales', 'Politique de confidentialité']:
    ligne = '      <a href="#">' + mort + '</a>'
    if src.count(ligne) != 1: print('ECHEC lien mort', mort); sys.exit(1)
    if mort == 'Blog':
        src = src.replace(ligne, '      <!-- LOT X01 — lien « Blog » retiré : aucune page ne le porte dans le dépôt. -->')
    else:
        src = src.replace(ligne, '      <span role="link" aria-disabled="true" style="display:block;color:#999">' + mort + (' — indisponibles' if mort == 'Mentions légales' else ' — indisponible') + '</span>')

# 7. Le chiffre sans source du bandeau d'accueil.
rep("""          <div class="hero2-panel-stat-num">98%</div>
          <div class="hero2-panel-stat-label">Satisfaction client</div>""",
    """          <div class="hero2-panel-stat-num">Devis</div>
          <div class="hero2-panel-stat-label">Personnalisé</div>""")

# 8. Les témoignages signés de noms inventés.
tranche('<section class="testimonials" id="avis">', '<!-- FAQ -->', """<!-- LOT X01 — la section « Ce qu'ils en disent » (quatre témoignages
     signés de noms inventés, sans source) est retirée : aucun avis réel
     n'existe dans le dépôt. Elle reviendra avec des avis authentiques. -->
""")

# 9. « Être recontacté » : le succès n'est affiché qu'après l'écriture
#    réelle, et aucune donnée personnelle ne va dans la console.
rep("""  var message = form ? (form.querySelector('textarea') ? form.querySelector('textarea').value.trim() : '') : '';

  console.log('RC submit:', prenom, nom, tel, email, motif, profil);

  if (!tel && !email) {
    _hcNote('rc-message-zone', 'Renseignez au moins votre téléphone ou votre adresse e-mail.', 'erreur');
    return;
  }

  supabaseInsert('recontacts', {
    prenom: prenom,
    nom: nom,
    telephone: tel || 'non renseigné',
    email: email,
    motif: motif,
    profil: profil,
    message: message
  }).then(r => console.log('Recontact saved:', r));

  document.getElementById('recontact-form').style.display = 'none';
  document.getElementById('recontact-success').style.display = 'block';
""", """  var message = form ? (form.querySelector('textarea') ? form.querySelector('textarea').value.trim() : '') : '';
  if (!tel && !email) {
    _hcNote('rc-message-zone', 'Renseignez au moins votre téléphone ou votre adresse e-mail.', 'erreur');
    return;
  }
  // LOT X01 — le succès n'est annoncé qu'après l'écriture RÉELLE : un
  // refus du serveur laisse le formulaire en place, avec une phrase
  // compréhensible. Aucune donnée personnelle n'est journalisée.
  if (window._hcRecontactEnCours) return;
  window._hcRecontactEnCours = true;
  _hcNote('rc-message-zone', 'Envoi en cours…', 'info');
  var resultat = null;
  try {
    resultat = await supabaseInsert('recontacts', {
      prenom: prenom,
      nom: nom,
      telephone: tel || 'non renseigné',
      email: email,
      motif: motif,
      profil: profil,
      message: message
    });
  } catch (e) { resultat = { error: String(e && e.message) }; }
  window._hcRecontactEnCours = false;
  if (!resultat || resultat.error) {
    _hcNote('rc-message-zone', 'Votre demande n\\'a pas pu être envoyée. Réessayez dans quelques instants, ou appelez-nous directement.', 'erreur');
    return;
  }
  _hcNote('rc-message-zone', '');
  document.getElementById('recontact-form').style.display = 'none';
  document.getElementById('recontact-success').style.display = 'block';
""")
rep("""function submitRecontact() {""", """async function submitRecontact() {""")

io.open(CHEMIN, 'w', encoding='utf-8').write(src)
print('index.html : D01 / X01 appliqués')
