// GÉNÉRÉ par tests/construire-pdf-serveur.cjs. Ne pas modifier à la main.
// Source : moteur PDF du Dashboard ; rendu identique, données relues serveur.
export function construirePdfServeur(jsPDF, dossier, devis) {
  const window = { jspdf: { jsPDF } };
function _nettPeriodeTexte(nd, formateurDate) {
  if (!nd || !nd.date_souhaitee) return '';
  var f = formateurDate || function (x) { return x; };
  if (nd.date_fin && nd.date_fin !== nd.date_souhaitee) {
    return 'du ' + f(nd.date_souhaitee) + ' au ' + f(nd.date_fin);
  }
  return f(nd.date_souhaitee);
}

function _nettHoraireTexte(nd) {
  if (!nd) return '';
  var plage = [nd.creneau_debut, nd.creneau_fin].filter(Boolean).join(' – ');
  if (plage) return plage;
  // Ancien dossier : conserver une heure réellement saisie, jamais
  // inventer un horaire ni réintroduire l'ancien choix « Flexible ».
  return nd.heure_precise || '';
}

function _nettAdresseTexte(nd) {
  if (!nd) return '';
  return [nd.adresse_rue, [nd.adresse_cp, nd.adresse_ville].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

var NETT_LIB_CAT = {
  citadine: 'Citadine', berline_break: 'Berline / Break', suv_4x4: 'SUV / 4x4',
  monospace: 'Monospace', utilitaire_fourgon: 'Utilitaire / Fourgon',
  prestige: 'Véhicule de prestige', autre: 'Autre'
};

var PRO_LIB_CATEGORIE = {
  technicien: 'Technicien automobile',
  renfort:    'Renfort automobile sur site'
};

var PRO_LIB_SPECIALITE = {
  mecanique: 'Mécanique', carrosserie: 'Carrosserie', diagnostic: 'Diagnostic',
  autre: 'Autre spécialité', conseil: 'Client à conseiller'
};

var PRO_LIB_MISSION = {
  jockey: 'Jockey automobile',
  // Renommé : « Accueil et préparation des véhicules » devient
  // « Accueil en concession ». La CLÉ accueil_preparation est
  // conservée pour que les demandes déjà enregistrées continuent de
  // s'afficher correctement.
  accueil_preparation: 'Accueil en concession',
  soutien_administratif: 'Soutien administratif',
  autre: 'Autre mission', conseil: 'Client à conseiller'
};

function _proLibelleMetier(d) {
  if (!d) return '';
  if (d.conseil) return 'Client à conseiller';
  if (d.categorie === 'technicien') return PRO_LIB_SPECIALITE[d.specialite] || d.specialite || '';
  if (d.categorie === 'renfort') return PRO_LIB_MISSION[d.mission] || d.mission || '';
  return '';
}

function _proDureeTexte(d) {
  if (!d || !d.duree_jours) return '';
  return d.duree_jours + (d.duree_jours > 1 ? ' jours' : ' jour');
}

function _proAdresseTexte(d) {
  if (!d) return '';
  return [d.adresse_rue, [d.adresse_cp, d.adresse_ville].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

function _contactSurPlaceTexte(cs) {
  if (!cs || typeof cs !== 'object') return '';
  if (!cs.nom || !cs.telephone) return '';
  return cs.nom + ' — ' + cs.telephone;
}

function _proPeriodeTexte(d) {
  if (!d || !d.date_debut) return '';
  var deb = _dvDate(d.date_debut);
  if (!d.date_fin || d.date_fin === d.date_debut) return 'Le ' + deb;
  return 'Du ' + deb + ' au ' + _dvDate(d.date_fin);
}

function _proHorairesTexte(d) {
  if (!d) return '';
  return [d.heure_debut, d.heure_fin].filter(Boolean).join(' – ');
}

var PRO_LIB_TYPE_VEHICULE = {
  citadine: 'Citadine', berline: 'Berline', break: 'Break',
  suv: 'SUV / Crossover', monospace: 'Monospace',
  'utilitaire-leger': 'Utilitaire léger / camionnette', fourgon: 'Fourgon',
  'grand-fourgon': 'Grand fourgon / utilitaire jusqu’à 20 m³',
  'autre-vl': 'Autre véhicule léger'
};

function _heureEntreeApplicableDash(c) {
  return _aStockage(c) && c.stockage_acheminement !== 'helixcar' && !!c.stockage_heure_entree;
}

function _heureSortieApplicableDash(c) {
  return _aStockage(c) && c.stockage_sortie !== 'helixcar' && !!c.stockage_heure_sortie;
}

function _rueCourteTrajet(rue) {
  var r = _rueSeule(rue);
  if (!r) return '';
  var virgule = r.indexOf(',');
  if (virgule === -1) return r;
  return r.slice(0, virgule).trim();
}

function _villeDepuisAdresse(adresse) {
  if (!adresse) return '—';
  var s = String(adresse).trim();
  var m = s.match(/(\d{5})\s+([^,;]+)/);
  if (m) return m[2].trim().toUpperCase() + ' (' + m[1] + ')';
  return s.split(',')[0].trim().toUpperCase();
}

function _villeCP(ville, cp, ancienChamp) {
  var v = (ville || '').trim();
  var p = (cp || '').trim();
  if (v) return v.toUpperCase() + (p ? ' (' + p + ')' : '');
  return _villeDepuisAdresse(ancienChamp);
}

var LIBELLES_TRAJET_RETOUR = {
  'retour-depart':      'Retour au lieu de départ',
  'adresse-differente': 'Livraison à une adresse différente'
};

function _libelleTrajetRetour(v) {
  if (!v) return '';
  return LIBELLES_TRAJET_RETOUR[v] || String(v);
}

function _horaireCompactTrajetPdf(horaireBrut) {
  // HOTFIX V50.5G.2 — cette fonction est définie au niveau supérieur,
  // hors de la fermeture de _construirePdfDevis() : elle n'a jamais eu
  // accès à la fonction estVide() qui y est déclarée localement (portée
  // lexicale). D'où le ReferenceError bloquant totalement la génération
  // PDF. Vérification désormais locale et autonome, aucune dépendance
  // externe — comportement équivalent à l'intention d'origine (null,
  // undefined, chaîne vide ou ne contenant que des espaces → renvoyés
  // tels quels).
  if (horaireBrut === null || horaireBrut === undefined || String(horaireBrut).trim() === '') return horaireBrut;
  if (horaireBrut.indexOf(' – ') !== -1) {
    var p = horaireBrut.split(' – ');
    return _formaterHeureFr(p[0]) + '–' + _formaterHeureFr(p[1]);
  }
  return _formaterHeureFr(horaireBrut);
}

function _vehiculesDuDossier(c) {
  if (c._vehicules && c._vehicules.length) return c._vehicules;
  if (c.flotte_a_detailler) return [];
  if (c.marque_modele || c.immatriculation || c.type_vehicule) {
    return [{
      position: 1,
      type_vehicule: c.type_vehicule,
      marque_modele: c.marque_modele,
      immatriculation: c.immatriculation,
      vin: c.vin,
      mode_transport: c.mode_transport,
      _depuisDossier: true
    }];
  }
  return [];
}

function _nbVehiculesDossier(c) {
  if (_estDemandeNettoyage(c)) {
    var nd = _nettDetails(c) || {};
    return nd.nombre_vehicules_approx || 1;
  }
  if (_estDemandeProfessionnel(c)) {
    // LOT D4 — un besoin de professionnel porte sur des PERSONNES et
    // sur une periode, jamais sur un parc. On ne se replie plus sur 1 :
    // afficher « 1 vehicule » la ou le client n'en a declare aucun
    // serait inventer une donnee. Un ancien dossier qui en porte encore
    // garde la sienne.
    var pd = _proDetails(c) || {};
    return pd.nombre_vehicules || 0;
  }
  return c.nb_vehicules || (_vehiculesDuDossier(c) || []).length || 1;
}

var LIBELLES_TYPE_VEHICULE = {
  'citadine': 'Citadine',
  'berline': 'Berline',
  'break': 'Break',
  'suv': 'SUV / Crossover',
  'monospace': 'Monospace',
  'utilitaire-leger': 'Utilitaire léger / camionnette',
  'fourgon': 'Fourgon',
  'grand-fourgon': 'Grand fourgon / utilitaire jusqu\u2019\u00e0 20 m\u00b3',
  'autre-vl': 'Autre véhicule léger',
  'standard':         'Voiture standard',
  'luxe':             'Véhicule de luxe',
  'non-fonctionnel':  'Véhicule non roulant',
  'moto':             'Moto',
  'camping-car':      'Camping-car'
};

function _libelleTypeVehicule(v) {
  if (!v) return '—';
  return LIBELLES_TYPE_VEHICULE[v] || String(v);
}

function _libelleModeTransport(mt) {
  if (mt === 'plateau') return 'Transport sur plateau';
  if (mt) return 'Convoyage par la route';
  return null;
}

function _finStockageEffectiveDossier(c) {
  var finPrevue = c.stockage_date_fin || '';
  if (!finPrevue || !_operationDossier(c, 'liv')) return finPrevue;
  var livDate = c.date_livraison || '';
  return livDate || finPrevue;
}

function _finStockageEffectiveVehiculeDash(c, v) {
  var finPrevue = (c && c.stockage_date_fin) || '';
  var livDate = (v && v.date_livraison) || '';
  if (!finPrevue) return finPrevue;
  return livDate || finPrevue;
}

function _joursEntreDatesDash(d1, d2) {
  if (!d1 || !d2) return null;
  var a = new Date(d1 + 'T00:00:00'), b = new Date(d2 + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return null;
  var j = Math.round((b - a) / 86400000);
  if (j < 0) return -1;
  return j === 0 ? 1 : j;
}

function _dvDate(v) {
  if (!v) return '—';
  try {
    // Une date civile n'est pas un instant UTC : 2026-09-21 doit rester
    // le 21 septembre, même si le navigateur se trouve hors de France.
    var civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    if (civil) return civil[3] + '/' + civil[2] + '/' + civil[1];
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  } catch (e) { return String(v); }
}

function _preCasserMotsLongsPdf(doc, texte, largeurMax, taille, style) {
  if (taille) { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(taille); }
  var mots = String(texte).split(' ');
  return mots.map(function (mot) {
    if (!mot || doc.getTextWidth(mot) <= largeurMax) return mot;
    var morceaux = [], courant = '';
    for (var k = 0; k < mot.length; k++) {
      var essai = courant + mot[k];
      if (doc.getTextWidth(essai) > largeurMax && courant) {
        morceaux.push(courant);
        courant = mot[k];
      } else {
        courant = essai;
      }
    }
    if (courant) morceaux.push(courant);
    return morceaux.join(' ');
  }).join(' ');
}

function _rueSeule(rue) {
  var r = (rue || '').trim();
  return r || '';
}

function estVideGlobal(v) { return v === null || v === undefined || v === '' || v === '—'; }

function _dv(v) { return (v === null || v === undefined || v === '') ? '—' : String(v); }

function _adresseCompleteOuVille(rue, cp, ville) {
  var r = _rueSeule(rue);
  if (r && !estVideGlobal(ville)) return r + ', ' + (cp ? cp + ' ' : '') + ville;
  if (r) return r;
  return _dv(ville);
}

function _formaterHeureFr(hhmm) {
  if (!hhmm) return null;
  var m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  return m[1] + 'h' + m[2];
}

function _phraseHoraireFr(horaireBrut) {
  if (!horaireBrut) return null;
  var sep = horaireBrut.indexOf(' – ');
  if (sep !== -1) {
    var debut = horaireBrut.slice(0, sep);
    var fin = horaireBrut.slice(sep + 3);
    return 'entre ' + _formaterHeureFr(debut) + ' et ' + _formaterHeureFr(fin);
  }
  return 'à ' + _formaterHeureFr(horaireBrut);
}

function _horaireDossier(c, prefixe) {
  if (c[prefixe + '_heure_type'] === 'creneau') {
    var d = c[prefixe + '_creneau_debut'], f = c[prefixe + '_creneau_fin'];
    return (d && f) ? (d + ' – ' + f) : (d || f || null);
  }
  var champ = (prefixe === 'pc') ? 'heure_prise_en_charge'
            : (prefixe === 'liv') ? 'heure_livraison' : 'heure_restitution';
  return c[champ] || null;
}

function _horaireVehicule(v, prefixe) {
  if (!v) return null;
  if (v[prefixe + '_heure_type'] === 'creneau') {
    var deb = v[prefixe + '_creneau_debut'], fin = v[prefixe + '_creneau_fin'];
    return (deb && fin) ? (deb + ' – ' + fin) : (deb || fin || null);
  }
  var map = { pc: 'heure_prise_en_charge', liv: 'heure_livraison', restit: 'restit_heure' };
  return v[map[prefixe]] || null;
}

function _estDemandeNettoyage(c) { return _typeServiceDemande(c) === 'nettoyage'; }

function _nettDetails(c) {
  var d = c && c.nettoyage_details;
  if (!d) return null;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return null; } }
  return (d && typeof d === 'object') ? d : null;
}

var NETT_LIB_TYPE = {
  interieur: 'Nettoyage intérieur', exterieur: 'Nettoyage extérieur',
  interieur_exterieur: 'Nettoyage intérieur et extérieur',
  preparation_complete: 'Préparation complète', conseil: 'Client à conseiller'
};

function _estDemandeProfessionnel(c) { return _typeServiceDemande(c) === 'professionnel'; }

function _proPrestationTexte(d) {
  if (!d) return '';
  var n = d.nombre_professionnels;
  if (d.categorie === 'technicien') {
    if (!n || n === 1) return 'Mise à disposition d\'un technicien automobile';
    return 'Mise à disposition de ' + n + ' techniciens automobiles';
  }
  if (d.categorie === 'renfort') {
    if (!n || n === 1) return 'Mise à disposition d\'un renfort automobile sur site';
    return 'Mise à disposition de ' + n + ' renforts automobiles sur site';
  }
  return '';
}

function _proDetails(c) {
  var d = c && c.professionnel_details;
  if (!d) return null;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return null; } }
  return (d && typeof d === 'object') ? d : null;
}

function _aStockage(c) {
  var t = _typeServiceDemande(c);
  return t === 'stockage' || t === 'convoyage_stockage';
}

function _operationAssureeParHelixCar(c, prefixe) {
  var t = _typeServiceDemande(c);
  if (t === 'convoyage' || t === 'convoyage_stockage') return true;
  if (t === 'stockage') {
    return (prefixe === 'pc') ? c.stockage_acheminement === 'helixcar'
                               : c.stockage_sortie === 'helixcar';
  }
  return false;
}

function _operationDossier(c, prefixe) {
  if (!_operationAssureeParHelixCar(c, prefixe)) return false;

  // V50.4A — CORRECTIF Objectif 8 : `trajet_commun` vaut NULL non seulement
  // pour les anciennes demandes/mono (cas d'origine de ce commentaire), mais
  // aussi pour TOUTE demande multi actuelle : le choix commun/individuel a
  // été retiré de l'interface (V50.2G, resté masqué en display:none dans le
  // DOM) et n'est donc plus jamais coché — `trajet_commun` est envoyé `null`
  // pour toute demande multi avec convoyage. L'ancien test `=== false` ne
  // correspondait donc plus jamais, et TOUTE demande multi affichait un bloc
  // dossier « Prise en charge »/« Livraison » global rempli de tirets, alors
  // que l'organisation est réellement individuelle par véhicule. On exige
  // désormais une confirmation EXPLICITE (`=== true`) pour traiter une
  // demande multi comme un trajet dossier commun.
  var nb = c.nb_vehicules || (c._vehicules ? c._vehicules.length : 0) || 1;
  if (nb >= 2 && c.trajet_commun !== true) return false;
  return true;
}

function _typeServiceDemande(c) {
  return c.type_service || 'convoyage';
}

function _aConvoyage(c) {
  var t = _typeServiceDemande(c);
  return t === 'convoyage' || t === 'convoyage_stockage';
}

var ANTHRACITE = [16, 24, 32];

var ROUGE = [229, 72, 77];

function _formaterMontantEuros(montant) {
  var s = Number(montant).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  s = s.replace(/[\u202F\u00A0\u2009]/g, ' ');
  return s + ' \u20AC';
}

var HELIXCAR_MENTIONS_LEGALES = [];

var HELIXCAR_MENTION_TVA = 'TVA non applicable, art. 293 B du CGI';

function _construirePdfDevis(c, d) {
  // V50.24 — passe typographique homogène + identité véhicule gauche/centre/droite.
  // V50.23 — passe de lisibilité VISIBLE : opérations véhicule + prestations + pied de page réellement agrandis, pagination basse plus exploitée.
  // V50.12 — FINITION PREMIUM : respiration multi + pagination intelligente des cartes + séparateur stockage.
  // Couche jsPDF uniquement : aucune logique métier ni aucun écran Dashboard modifié.
  // Géométrie recalée bloc par bloc sur la maquette A4 de référence.
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF non chargé');

  var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  var M = 16, L = 210 - M, LARGEUR = L - M;
  var IVOIRE = [247, 246, 243];
  // ══ V50.6 PREMIUM — PALETTE ══════════════════════════════════
  // Palette volontairement COURTE (4 valeurs + le ROUGE existant),
  // comme demandé — aucune multiplication de nuances.
  //   GRIS_CARTE   : fond de carte, gris très clair et froid (au lieu
  //                  de l'ivoire beige actuel) — rendu plus moderne.
  //   GRIS_FILET   : filets et séparateurs très fins.
  //   GRIS_LABEL   : labels, gris moyen resté parfaitement lisible.
  //   ANTHRACITE_V6: valeurs, très légèrement moins dur que le noir
  //                  actuel (16,24,32) pour un rendu plus premium.
  // ROUGE reste STRICTEMENT la constante existante — jamais redéfinie.
  // V50.6.1 — Objectif 8 : les grandes zones (Stockage, Convoyage,
  // Véhicule) étaient encore perçues comme de gros rectangles gris.
  // Fond éclairci de [248,249,250] à [252,252,253] — quasi-blanc : il
  // n'est plus qu'une séparation subtile, et le contraste passe à la
  // typographie, aux filets et au rouge d'accent, comme demandé.
  // Le filet est très légèrement renforcé ([230,232,235] ->
  // [226,229,233]) pour que la carte reste nettement délimitée malgré
  // ce fond plus clair — y compris à l'impression noir et blanc.
  var GRIS_CARTE = [243, 243, 243]; // V50.17 — gris neutre premium, sans dominante bleue
  // V50.18 — nouveau logo officiel HelixCar (Services automobiles), intégré au PDF.
  var HELIXCAR_LOGO_PDF = 'data:image/jpeg;base64,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';
  var GRIS_FILET = [240, 241, 243];
  var GRIS_LABEL = [138, 144, 152];
  var ANTHRACITE_V6 = [28, 33, 40];
  // V50.6.1 — séparateurs internes (colonnes Stockage, axe central
  // Convoyage, ligne identité/opérations des cartes véhicule) :
  // volontairement plus clairs que le contour, pour structurer sans
  // jamais découper visuellement la carte.
  var GRIS_SEPARATEUR = [238, 240, 242];
  var y = M;

  function T(s, x, yy, opt) { doc.text(String(s === null || s === undefined ? '' : s), x, yy, opt); }
  function estVide(v) { return v === null || v === undefined || v === '' || v === '—'; }

  // V50.4G — Objectif 2 : REÉQUILIBRAGE — V50.4F avait des libellés (8.5)
  // trop dominants par rapport aux valeurs (7.8), inversant l'effet
  // recherché. Compromis explicitement demandé entre V50.4D (libellé 6.8 /
  // valeur 9.5) et V50.4E/F (libellé 8.5 / valeur 7.8) : libellé légèrement
  // plus PETIT (7.5, milieu de la fourchette 7.3–7.6 demandée), valeur
  // légèrement plus GRANDE (8.5, milieu de 8.3–8.8) — la valeur redevient
  // l'information visuellement dominante, le libellé structure sans
  // écraser. Toujours un 4e paramètre optionnel pour les libellés vedettes
  // (Prise en charge / Livraison, Objectif 5), désormais moins imposant
  // qu'en V50.4E/F (9.3, fourchette 9–9.5) — visibles sans dominer.
  function etiquette(t, x, yy, tailleLabel) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(tailleLabel || 7.5);
    // V50.6 — gris label plus doux (rendu premium). TAILLE par défaut
    // (7.5) INCHANGÉE : aucune hauteur ni largeur mesurée n'est affectée.
    // NOTE STABILITÉ : un interlettrage (charSpace) avait été envisagé
    // ici pour une signature typographique plus premium, mais REJETÉ —
    // etiquetteAdaptative() ci-dessous est un chemin de rendu SÉPARÉ qui
    // mesure sans charSpace ; l'ajouter ici aurait produit à la fois une
    // incohérence visuelle entre les deux chemins et un risque de
    // débordement non mesuré sur les libellés non adaptatifs.
    doc.setTextColor(GRIS_LABEL[0], GRIS_LABEL[1], GRIS_LABEL[2]);
    T(String(t).toUpperCase(), x, yy);
  }
  function valeur(t, x, yy, taille, gras) {
    doc.setFont('helvetica', gras === false ? 'normal' : 'bold');
    doc.setFontSize(taille || 9.8);
    // V50.6 — anthracite très légèrement adouci (rendu moins « encre
    // administrative »). Taille par défaut INCHANGÉE.
    doc.setTextColor(ANTHRACITE_V6[0], ANTHRACITE_V6[1], ANTHRACITE_V6[2]);
    T(t, x, yy);
  }

  // V50.4F — Objectif 4/5/14 : CAUSE EXACTE des collisions confirmée par
  // mesure (doc.getTextWidth()), pas supposée : à 8.5 gras majuscules,
  // « STOCKAGE PRIS EN COMPTE JUSQU'AU » et « DATE DE PRISE EN CHARGE »
  // dépassent la largeur de colonne qui leur était allouée en V50.4E,
  // débordant sur la colonne voisine. Solution appliquée dans l'ordre de
  // priorité demandé : (1) la taille V50.4E des libellés est conservée
  // partout — jamais réduite globalement ; (2) la largeur des colonnes
  // concernées est redistribuée selon le contenu réel (cf. sites d'appel
  // plus bas) ; (3) cette fonction reste un FILET DE SÉCURITÉ générique :
  // elle mesure le libellé à sa police réelle et ne le fait passer à la
  // ligne QUE s'il ne tient toujours pas, quelle que soit la largeur de
  // colonne fournie — jamais de réduction de taille automatique (le
  // paramètre `tailleLabel` reste un recours local explicite, non déclenché
  // ici). Le nombre de lignes réellement utilisées est retourné pour que
  // l'appelant décale sa valeur et sa hauteur de bloc en conséquence.
  function etiquetteAdaptative(t, x, yy, largeurCol, tailleLabel, dess) {
    var taille = tailleLabel || 8.2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(taille);
    var texte = String(t).toUpperCase();
    var marge = 3; // marge de sécurité horizontale avant la colonne suivante
    var largeurDispo = Math.max(10, largeurCol - marge);
    if (doc.getTextWidth(texte) <= largeurDispo) {
      if (dess) { doc.setTextColor(GRIS_LABEL[0], GRIS_LABEL[1], GRIS_LABEL[2]); T(texte, x, yy); }
      return 1;
    }
    var lignes = doc.splitTextToSize(texte, largeurDispo);
    if (dess) { doc.setTextColor(GRIS_LABEL[0], GRIS_LABEL[1], GRIS_LABEL[2]); doc.text(lignes, x, yy); }
    return lignes.length;
  }

  // V50.32 — libellés adaptatifs premium : on vise une taille plus lisible,
  // puis on réduit légèrement si la largeur disponible ne permet pas de
  // conserver une ligne propre. Le retour à la ligne n'intervient qu'en
  // dernier recours. Utilisé pour TRAJET et STOCKAGE.
  function etiquetteAdaptativeLisible(t, x, yy, largeurCol, tailleCible, tailleMini, dess) {
    var texte = String(t).toUpperCase();
    var marge = 3;
    var largeurDispo = Math.max(10, largeurCol - marge);
    var taille = tailleCible || 9.4;
    var mini = tailleMini || 8.6;
    doc.setFont('helvetica', 'bold');
    while (taille > mini) {
      doc.setFontSize(taille);
      if (doc.getTextWidth(texte) <= largeurDispo) break;
      taille = Math.max(mini, taille - 0.2);
    }
    doc.setFontSize(taille);
    if (doc.getTextWidth(texte) <= largeurDispo) {
      if (dess) { doc.setTextColor(GRIS_LABEL[0], GRIS_LABEL[1], GRIS_LABEL[2]); T(texte, x, yy); }
      return 1;
    }
    var lignes = doc.splitTextToSize(texte, largeurDispo);
    if (dess) { doc.setTextColor(GRIS_LABEL[0], GRIS_LABEL[1], GRIS_LABEL[2]); doc.text(lignes, x, yy); }
    return lignes.length;
  }

  // ══ EN-TÊTE ══
  // V50.18 — remplacement du logo typographique reconstruit par le nouveau
  // logo officiel fourni par HelixCar, avec la signature SERVICES AUTOMOBILES.
  // La zone reste contenue à gauche pour ne jamais empiéter sur les références du devis.
  try {
    doc.addImage(HELIXCAR_LOGO_PDF, 'JPEG', M, y - 0.2, 58, 13.0, undefined, 'FAST');
  } catch (eLogoPdf) {
    // Fallback discret si un moteur PDF ancien refuse l'image : marque texte uniquement.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
    doc.setTextColor(ANTHRACITE[0], ANTHRACITE[1], ANTHRACITE[2]);
    T('HELIXCAR', M, y + 5);
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.setTextColor(ROUGE[0], ROUGE[1], ROUGE[2]);
  T('DEVIS N° ' + d.reference, L, y + 3, { align: 'right' });

  // V50.36 — métadonnées d'en-tête plus lisibles, sans concurrencer le numéro de devis.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6);
  doc.setTextColor(112, 112, 112);
  T("Date d'émission : " + _dvDate(d.date_generation), L, y + 8.5, { align: 'right' });
  T('Référence client : ' + _dv(c.numero_client), L, y + 12.5, { align: 'right' });

  // ══ V50.6 PREMIUM ══ En-tête plus respirant : le trait rouge passe de
  // 1mm à 0.6mm (plus fin, plus élégant, cohérent avec les filets fins
  // du reste du document) et gagne un peu d'air avant et après. Gain
  // total volontairement MODESTE (+2.5mm) pour améliorer la respiration
  // sans risquer de faire basculer un document d'une page à deux.
  y += 18.5;
  doc.setDrawColor(ROUGE[0], ROUGE[1], ROUGE[2]); doc.setLineWidth(0.6);
  doc.line(M, y, L, y);
  y += 9.5;

  function sectionTitre(t) {
    // ══ V50.6 PREMIUM ══ Le titre passe du tout-rouge à l'anthracite,
    // précédé d'un petit accent rouge vertical : le rouge devient un
    // ACCENT ponctuel au lieu de porter tout le texte. Filet de
    // soulignement plus fin (0.15 au lieu de 0.2) et plus clair.
    // HAUTEURS STRICTEMENT INCHANGÉES (2.3 puis 1.5) : la pagination,
    // qui réserve 5.8mm par titre, n'est en rien affectée.
    doc.setFillColor(ROUGE[0], ROUGE[1], ROUGE[2]);
    doc.rect(M, y - 2.2, 1.25, 4.6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.4);
    doc.setTextColor(20, 23, 27);
    T(t.toUpperCase(), M + 4.0, y);
    y += 3.2;
    doc.setDrawColor(GRIS_FILET[0], GRIS_FILET[1], GRIS_FILET[2]); doc.setLineWidth(0.12);
    doc.line(M + 4.0, y, L, y);
    // V50.4I — Objectif N/O : le titre appartient à la section qui SUIT,
    // pas au bloc précédent — l'espace qui le SÉPARAIT de son propre bloc
    // (6.2mm) était bien plus généreux que celui qui le séparait du bloc
    // PRÉCÉDENT, donnant l'impression inverse de ce qui était voulu.
    // Réduit à 1.5mm (fourchette demandée : 1 à 2mm). Le supplément
    // d'espace AVANT le titre est géré séparément par AVANT_TITRE, au
    // niveau des points de transition (Objectifs N/O).
    y += 4.0;
  }

  function blocIvoire(contenu) {
    var y0 = y;
    var h = contenu(false);
    // ══ V50.6 PREMIUM ══ Carte gris très clair et froid (au lieu de
    // l'ivoire beige), avec un contour subtil qui la détache du blanc
    // sans aplat lourd. L'accent rouge vertical est affiné (1.2 -> 0.9mm)
    // : présent comme signature, jamais dominant. GÉOMÉTRIE IDENTIQUE
    // (M, y0, LARGEUR, h) — la hauteur mesurée et la pagination ne sont
    // en rien affectées.
    // V50.7 — reproduction exacte de la référence fournie : le texte du
    // ticket ne mentionne la barre rouge verticale QUE pour la carte
    // VÉHICULE À STOCKER, jamais pour Stockage/Convoyage/Prestations, qui
    // partagent cette même fonction. Retirée ici. GÉOMÉTRIE DU FOND
    // IDENTIQUE (M, y0, LARGEUR, h) — hauteur mesurée et pagination non
    // affectées.
    doc.setFillColor(GRIS_CARTE[0], GRIS_CARTE[1], GRIS_CARTE[2]);
    doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'F');
    doc.setDrawColor(GRIS_FILET[0], GRIS_FILET[1], GRIS_FILET[2]); doc.setLineWidth(0.15);
    doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'S');
    y = y0; contenu(true); y = y0 + h;
  }

  // V50.4D — Objectifs 1/2/3 : mécanisme GÉNÉRIQUE de contrôle de l'espace
  // disponible, réutilisé par toutes les sections (Stockage, Convoyage,
  // chaque carte véhicule, Prestations). `blocIvoire` mesure déjà sa
  // hauteur exacte via une passe à blanc (contenu(false)) avant de
  // dessiner : il suffisait de comparer cette hauteur à l'espace restant
  // AVANT de dessiner quoi que ce soit, et de basculer de page si besoin —
  // c'est tout le mécanisme manquant qui causait les cartes tronquées.
  // BAS_PAGE reprend exactement le seuil déjà utilisé pour le bandeau
  // MONTANT (270mm), seul seuil « sûr avant pied de page » déjà validé
  // dans ce fichier.
  var BAS_PAGE = 286; // V50.32 — exploite davantage la hauteur utile avant saut de page
  // V50.12 — Les pages intermédiaires d'un devis multi n'ont pas encore le pied de page final.
  // On peut donc utiliser davantage de hauteur pour les CARTES VÉHICULES uniquement,
  // sans les tasser ni les couper. Cela évite les grandes zones blanches comme sur les
  // cas 3 véhicules où V3 partait trop tôt sur la page suivante. Les sections suivantes
  // (Prestations/Tarif) gardent leurs seuils propres et basculent sur une nouvelle page
  // si nécessaire. Marge basse conservée : 11 mm sur une page A4 de 297 mm.
  var BAS_PAGE_CARTE_MULTI = 294; // V50.32 — limite physique multi plus basse, sans couper les cartes // V50.23 — exploite davantage les pages intermédiaires sans couper les cartes
  function blocIvoirePagine(contenu) {
    var h = contenu(false);
    if (y + h > BAS_PAGE) { doc.addPage(); y = M; }
    var y0 = y;
    // ══ V50.6 PREMIUM ══ Carte gris très clair et froid (au lieu de
    // l'ivoire beige), avec un contour subtil qui la détache du blanc
    // sans aplat lourd. L'accent rouge vertical est affiné (1.2 -> 0.9mm)
    // : présent comme signature, jamais dominant. GÉOMÉTRIE IDENTIQUE
    // (M, y0, LARGEUR, h) — la hauteur mesurée et la pagination ne sont
    // en rien affectées.
    // V50.7 — reproduction exacte de la référence fournie : le texte du
    // ticket ne mentionne la barre rouge verticale QUE pour la carte
    // VÉHICULE À STOCKER, jamais pour Stockage/Convoyage/Prestations, qui
    // partagent cette même fonction. Retirée ici. GÉOMÉTRIE DU FOND
    // IDENTIQUE (M, y0, LARGEUR, h) — hauteur mesurée et pagination non
    // affectées.
    doc.setFillColor(GRIS_CARTE[0], GRIS_CARTE[1], GRIS_CARTE[2]);
    doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'F');
    doc.setDrawColor(GRIS_FILET[0], GRIS_FILET[1], GRIS_FILET[2]); doc.setLineWidth(0.15);
    doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'S');
    y = y0; contenu(true); y = y0 + h;
    return h;
  }
  // Titre de section + bloc : la même décision de pagination couvre les
  // DEUX ensemble, pour ne jamais laisser un titre seul en bas de page
  // (cf. Objectif 2 : « éviter titre de section seul en bas d'une page »).
  // V50.4J — Objectif 1 : léger supplément d'aération AVANT chaque titre
  // rouge (CLIENT, TRAJET, STOCKAGE AUTOMOBILE, CONVOYAGE HELIXCAR, PRISE
  // EN CHARGE, VÉHICULES, VÉHICULES À STOCKER, PRESTATIONS), homogène —
  // appliqué UNE FOIS ici pour tous les titres passant par sectionAvecBloc
  // (remplace le supplément sélectif de V50.4I qui ne couvrait que 3
  // titres et uniquement en mono). Volontairement modeste (2mm) : « légère
  // et homogène », jamais de nouvelle page à cause de cette seule
  // correction.
  var _nbVehPdfRespiration = Number(c.nb_vehicules || (c._vehicules && c._vehicules.length) || 1);
  var _pdfMultiRespiration = _nbVehPdfRespiration > 1;
  var ESPACE_AVANT_TITRE_GLOBAL = _pdfMultiRespiration ? 3.4 : 3.2;

  // AÉRATION LOCALE DE QUELQUES TITRES.
  //
  // Le design du devis n'est pas retouché : ni la charte, ni les
  // contenus, ni les alignements. Seuls quelques titres arrivaient trop
  // près de la carte grise qui les précède, ce qui les faisait paraître
  // collés. Ils reçoivent 2,6 mm de respiration supplémentaire — et eux
  // seuls.
  //
  // La valeur est utilisée AUSSI pour mesurer la place nécessaire avant
  // un saut de page : sans cela, la pagination se déciderait sur une
  // hauteur qui n'est plus la bonne.
  var TITRES_A_AERER = [
    'Mission sur site', 'Intervention',
    'Informations complémentaires',
    'Prestation', 'Prestations',
    "Lieu d'intervention", 'Véhicules à nettoyer',
    // LOT F1/F2 — la carte de periode et d'horaires du nettoyage suit
    // immediatement le bandeau : sans cette respiration, son titre
    // touche la zone grise qui le precede.
    'Période et horaires'
  ];
  function _espaceAvantTitre(titre) {
    return ESPACE_AVANT_TITRE_GLOBAL
      + (TITRES_A_AERER.indexOf(String(titre)) !== -1 ? 2.6 : 0);
  }
  // Hauteur totale titre = 2 (avant, Objectif 1) + 2.3 (soulignement) + 1.5
  // (après, V50.4I) = 5.8mm — jamais dessiner avant de mesurer, jamais
  // mesurer avec une valeur obsolète.
  var HAUTEUR_TITRE_SECTION = ESPACE_AVANT_TITRE_GLOBAL + 7.2;
  function sectionAvecBloc(titre, contenu) {
    var h = contenu(false);
    var espace = _espaceAvantTitre(titre);
    if (y + (espace + 7.2) + h > BAS_PAGE) { doc.addPage(); y = M; }
    y += espace;
    sectionTitre(titre);
    var y0 = y;
    // ══ V50.6 PREMIUM ══ Carte gris très clair et froid (au lieu de
    // l'ivoire beige), avec un contour subtil qui la détache du blanc
    // sans aplat lourd. L'accent rouge vertical est affiné (1.2 -> 0.9mm)
    // : présent comme signature, jamais dominant. GÉOMÉTRIE IDENTIQUE
    // (M, y0, LARGEUR, h) — la hauteur mesurée et la pagination ne sont
    // en rien affectées.
    // V50.7 — reproduction exacte de la référence fournie : le texte du
    // ticket ne mentionne la barre rouge verticale QUE pour la carte
    // VÉHICULE À STOCKER, jamais pour Stockage/Convoyage/Prestations, qui
    // partagent cette même fonction. Retirée ici. GÉOMÉTRIE DU FOND
    // IDENTIQUE (M, y0, LARGEUR, h) — hauteur mesurée et pagination non
    // affectées.
    doc.setFillColor(GRIS_CARTE[0], GRIS_CARTE[1], GRIS_CARTE[2]);
    doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'F');
    doc.setDrawColor(GRIS_FILET[0], GRIS_FILET[1], GRIS_FILET[2]); doc.setLineWidth(0.15);
    doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'S');
    y = y0; contenu(true); y = y0 + h;
  }

  var aRestit = (c.restitution === 'Oui');
  var estPro = (c.type_client === 'pro');
  var xG = M + 7;

  // V50.4K — Objectif 13 (audit section 3) : CAUSE EXACTE du tassement
  // variable identifiée — ces trois constantes étaient conditionnées par
  // `_monoDoc` (mono = 1.5mm partout, multi = 3/4/5mm). Un dossier mono
  // (comme la plupart des devis simples) était donc systématiquement
  // tassé, tandis qu'un dossier multi (tel HC-2026-8740, la référence
  // visuelle) bénéficiait d'une respiration généreuse — non pas parce que
  // HC-2026-8740 était mieux réglé, mais uniquement parce qu'il comptait
  // plusieurs véhicules. Corrigé en supprimant toute dépendance au nombre
  // de véhicules : les mêmes valeurs (celles, généreuses, qui donnaient le
  // bon rythme sur HC-2026-8740) s'appliquent désormais à TOUS les
  // dossiers, mono ou multi. C'est la pagination existante
  // (blocIvoirePagine/sectionAvecBloc, non modifiées) qui absorbe la
  // variation de contenu résultante — jamais l'espacement qui se réduit
  // pour tenter de tout faire tenir (Objectif 13/16 : « une deuxième page
  // propre vaut mieux qu'une première page tassée »).
  var ESPACE_APRES_CLIENT = _pdfMultiRespiration ? 3.0 : 2.5;
  var ESPACE_SECTION = _pdfMultiRespiration ? 3.8 : 2.5;
  var ESPACE_AVANT_PRESTATIONS = _pdfMultiRespiration ? 7.5 : 7.0; // V50.20 — +2 à 2.5mm de respiration entre PRESTATIONS et TARIF

  // ══ CLIENT — s'adapte au type de client, champs vides ignorés ══
  y += ESPACE_AVANT_TITRE_GLOBAL;
  sectionTitre('Client');
  // V50.4J — Objectif 2 : CAUSE DU TRAIT QUI TRAVERSE NOM/EMAIL — le bloc
  // CLIENT est le seul à ne PAS passer par blocIvoire (pas de padding
  // interne de 6.5mm comme Stockage/Trajet/Véhicules) ; il enchaînait donc
  // directement sur le trait de soulignement du titre, réduit à 1.5mm en
  // V50.4I (Objectif N/O de cette version, correct pour les blocs en
  // ivoire mais insuffisant ici). Espace dédié ajouté pour dégager
  // clairement NOM et EMAIL du trait, sans toucher à sectionTitre() ni à
  // aucun autre bloc.
  y += 1.5;
  var champsClient = [];
  var nomPersonne = ((c.prenom || '') + ' ' + (c.nom || '')).trim();
  if (estPro) {
    if (!estVide(c.societe))   champsClient.push(['Nom de la société', c.societe]);
    if (!estVide(c.siret))     champsClient.push(['N° SIRET', c.siret]);
    if (nomPersonne)           champsClient.push(['Contact', nomPersonne]);
    if (!estVide(c.email))     champsClient.push(['Email', c.email]);
    if (!estVide(c.telephone)) champsClient.push(['Téléphone', c.telephone]);
  } else {
    if (nomPersonne)           champsClient.push(['Nom', nomPersonne]);
    if (!estVide(c.email))     champsClient.push(['Email', c.email]);
  }
  var nCol = champsClient.length > 2 ? 3 : 2;
  var wCol = LARGEUR / nCol;
  var ligneY = y;
  champsClient.forEach(function (ch, i) {
    var col = i % nCol, rang = Math.floor(i / nCol);
    // V50.22 — retrait visuel du contenu CLIENT : le titre de section reste
    // aligné sur la grille générale, mais NOM / EMAIL et leurs valeurs sont
    // légèrement rentrés pour ne plus paraître collés au bord gauche.
    var retraitClient = 4.0;
    var x = M + retraitClient + col * wCol;
    var yy = ligneY + rang * 11;
    etiquette(ch[0], x, yy);
    // V50.4I — même correctif : la mesure doit utiliser la police réelle de
    // dessin de la VALEUR (9, gras — via valeur() plus bas), pas celle
    // laissée par etiquette() (7.5) juste au-dessus.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.2);
    var lignes = doc.splitTextToSize(String(ch[1]), wCol - 9).slice(0, 1);
    valeur(lignes[0], x, yy + 5.0, 10.2);
  });
  y = ligneY + Math.ceil(champsClient.length / nCol) * 11 + ESPACE_APRES_CLIENT;

  // V50.4D — Objectif 5 : Stockage est désormais dessiné EN PREMIER quand
  // le dossier comprend stockage + convoyage (auparavant, Convoyage
  // passait avant Stockage). pcOk/livOk calculés ici, réutilisés par les
  // deux blocs ci-dessous ET par Prestations plus bas (inchangé).

  var pcOk = _operationDossier(c, 'pc');
  var livOk = _operationDossier(c, 'liv');

  // CORRECTION MÉTIER (Anomalie 1) — cause racine du bug « Dépôt au
  // stockage par le client » affiché à tort : _operationDossier()
  // retourne TOUJOURS false pour 'pc' ET 'liv' dès qu'un dossier est
  // multi-véhicules (nb >= 2) sans trajet_commun === true explicite —
  // c'est-à-dire pour la quasi-totalité des dossiers multi actuels,
  // PEU IMPORTE l'organisation réelle de chaque véhicule (le choix
  // commun/individuel a été retiré de l'interface, cf. commentaire
  // V50.4A sur _operationDossier ci-dessus). Le bloc dossier global
  // « Prise en charge »/« Livraison » ne peut donc jamais représenter
  // correctement un multi individuel — il ne doit alors afficher
  // AUCUNE généralisation (ni « Dépôt au stockage par le client », ni
  // rien d'autre) : les cartes véhicules individuelles restent déjà la
  // source exacte pour ce cas.
  var _nbVehiculesTrajet = c.nb_vehicules || (c._vehicules ? c._vehicules.length : 0) || 1;
  var _estMultiIndividuelTrajet = (_nbVehiculesTrajet >= 2 && c.trajet_commun !== true);

  // ══ SERVICES SUR SITE — Nettoyage / Trouver un professionnel ══
  // Ces deux services n'ont ni trajet, ni prise en charge, ni livraison,
  // ni restitution, ni fiche véhicule en base : les sections Stockage /
  // Trajet / Véhicules ci-dessous ne produisent donc déjà rien pour eux
  // (leurs propres conditions sont fausses). On n'ajoute ici que leurs
  // blocs métier, avec EXACTEMENT les mêmes primitives que le reste du
  // devis (titre rouge, carte grise, bandeau d'indicateurs, puces) :
  // aucun second modèle de devis n'est créé, aucune couleur ni
  // typographie nouvelle.

  // Ligne « Libellé : valeur » — la valeur est posée JUSTE APRÈS le
  // libellé, à partir de sa largeur réellement mesurée : petit
  // espacement, jamais une grande colonne vide.
  // LOT F2 — LE TEXTE NE DEBORDE PLUS DE SA CARTE.
  //
  // L'ancienne version posait la valeur juste apres le libelle, sans
  // aucune limite de largeur : un libelle long — « Horaire de debut sur
  // place » — additionne a une valeur longue depassait la carte grise,
  // touchait la marge, et pouvait chevaucher ce qui suit.
  //
  // La valeur est desormais decoupee sur la largeur REELLEMENT
  // disponible, et ses lignes suivantes sont alignees sous elle. La
  // hauteur est MESUREE avec exactement le meme calcul que le dessin :
  // aucune carte ne peut plus etre trop courte pour son contenu.
  var HAUTEUR_LIGNE_LV = 4.9;
  function _lignesValeurLV(label, valeur) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.6);
    var l = String(label) + ' :';
    var w = doc.getTextWidth(l);
    // Largeur restante dans la carte, marge interieure droite comprise.
    var dispo = (LARGEUR - 14) - w - 2.6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.8);
    // Un libelle si long qu'il ne laisse plus de place : la valeur
    // passe entierement a la ligne suivante plutot que d'etre ecrasee.
    if (dispo < 18) {
      return { w: w, dispo: LARGEUR - 14, sousLibelle: true,
               lignes: doc.splitTextToSize(String(valeur), LARGEUR - 14) };
    }
    return { w: w, dispo: dispo, sousLibelle: false,
             lignes: doc.splitTextToSize(String(valeur), dispo) };
  }
  function _hauteurLigneLV(label, valeur) {
    var m = _lignesValeurLV(label, valeur);
    return (m.lignes.length + (m.sousLibelle ? 1 : 0)) * HAUTEUR_LIGNE_LV + 1.6;
  }
  function ligneLV(label, valeur, x, yy, dess) {
    var m = _lignesValeurLV(label, valeur);
    if (dess) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.6);
      doc.setTextColor(GRIS_LABEL[0], GRIS_LABEL[1], GRIS_LABEL[2]);
      T(String(label) + ' :', x, yy);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.8);
      doc.setTextColor(ANTHRACITE_V6[0], ANTHRACITE_V6[1], ANTHRACITE_V6[2]);
      var yv = m.sousLibelle ? yy + HAUTEUR_LIGNE_LV : yy;
      var xv = m.sousLibelle ? x : x + m.w + 2.6;
      m.lignes.forEach(function (lg, i) { T(lg, xv, yv + i * HAUTEUR_LIGNE_LV); });
    }
    return (m.lignes.length + (m.sousLibelle ? 1 : 0)) * HAUTEUR_LIGNE_LV + 1.6;
  }

  // Carte de lignes « libellé : valeur ». Une ligne par donnée
  // RÉELLEMENT présente ; la carte entière disparaît si tout est vide.
  function carteLignes(titre, lignes) {
    var utiles = (lignes || []).filter(function (l) {
      return l && l[1] !== null && l[1] !== undefined && String(l[1]) !== '';
    });
    if (!utiles.length) return;
    sectionAvecBloc(titre, function (dess) {
      var y0 = y, cur = y0 + 7.4, dernier = 0;
      utiles.forEach(function (l) {
        dernier = _hauteurLigneLV(l[0], l[1]);
        ligneLV(l[0], l[1], xG, cur, dess);
        cur += Math.max(6.5, dernier);
      });
      // Meme calcul que le dessin : hauteur avancee, moins le dernier
      // interligne, plus la marge basse de la carte.
      return (cur - y0) - Math.max(6.5, dernier) + 7.4;
    });
  }

  // Carte de texte libre : le texte du client, et rien d'autre.
  function carteTexte(titre, texte) {
    if (!texte) return;
    sectionAvecBloc(titre, function (dess) {
      var y0 = y, cur = y0 + 7.4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.8);
      var lignes = doc.splitTextToSize(String(texte), LARGEUR - 14);
      if (dess) {
        doc.setTextColor(ANTHRACITE_V6[0], ANTHRACITE_V6[1], ANTHRACITE_V6[2]);
        lignes.forEach(function (lg, i) { T(lg, xG, cur + i * 4.7); });
      }
      cur += (lignes.length - 1) * 4.7;
      return (cur - y0) + 7.0;
    });
  }

  // Bandeau d'indicateurs — même rendu que la rangée d'indicateurs du
  // bloc Stockage : colonnes de largeur égale, libellé au-dessus de sa
  // valeur. Mesuré AVANT dessin, jamais supposé.
  function bandeauIndicateurs(items) {
    var utiles = (items || []).filter(function (it) {
      return it && it[1] !== null && it[1] !== undefined && String(it[1]) !== '';
    });
    if (!utiles.length) return;
    var n = utiles.length, w = (LARGEUR - 12) / n;
    var nlLabel = 1, nlVal = 1;
    utiles.forEach(function (it, i) {
      nlLabel = Math.max(nlLabel, etiquetteAdaptativeLisible(it[0], xG + i * w, 0, w, 10.4, 9.2, false));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.2);
      nlVal = Math.max(nlVal, doc.splitTextToSize(String(it[1]), w - 3).slice(0, 2).length);
    });
    var h = 6.5 + (nlLabel - 1) * 3.6 + 5.0 + nlVal * 4.4 + 2.5;
    if (y + h > BAS_PAGE) { doc.addPage(); y = M; }
    var y0 = y;
    doc.setFillColor(GRIS_CARTE[0], GRIS_CARTE[1], GRIS_CARTE[2]);
    doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'F');
    doc.setDrawColor(GRIS_FILET[0], GRIS_FILET[1], GRIS_FILET[2]); doc.setLineWidth(0.15);
    doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'S');
    var curLabel = y0 + 6.5;
    utiles.forEach(function (it, i) {
      etiquetteAdaptativeLisible(it[0], xG + i * w, curLabel, w, 10.4, 9.2, true);
    });
    var yVal = curLabel + (nlLabel - 1) * 3.6 + 5.6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.2);
    doc.setTextColor(ANTHRACITE_V6[0], ANTHRACITE_V6[1], ANTHRACITE_V6[2]);
    utiles.forEach(function (it, i) {
      doc.splitTextToSize(String(it[1]), w - 3).slice(0, 2).forEach(function (lg, k) {
        T(lg, xG + i * w, yVal + k * 4.4);
      });
    });
    y = y0 + h;
  }

  if (_estDemandeNettoyage(c)) {
    var ndPdf = _nettDetails(c) || {};
    y += ESPACE_AVANT_TITRE_GLOBAL;
    sectionTitre('Nettoyage automobile');
    bandeauIndicateurs([
      ['Véhicules', ndPdf.nombre_vehicules_approx || ''],
      ['Formule', NETT_LIB_TYPE[ndPdf.type_nettoyage] || ''],
      ['Période', _nettPeriodeTexte(ndPdf, _dvDate)],
      ['Horaire', _nettHoraireTexte(ndPdf)]
    ]);
    // LOT F2 — la periode et les DEUX horaires, avec exactement les
    // libelles du formulaire, dans une carte placee juste apres le
    // bandeau : le client retrouve mot pour mot ce qu'il a saisi.
    // La carte est mesuree avant d'etre dessinee (sectionAvecBloc) :
    // un titre ne peut pas rester seul en bas de page, et une valeur
    // longue passe a la ligne dans la carte au lieu d'en deborder.
    carteLignes('Période et horaires', [
      ['Date de début', ndPdf.date_souhaitee ? _dvDate(ndPdf.date_souhaitee) : ''],
      ['Date de fin', ndPdf.date_fin ? _dvDate(ndPdf.date_fin) : ''],
      ['Horaire de début sur place', ndPdf.creneau_debut || ''],
      ['Horaire de fin sur place', ndPdf.creneau_fin || '']
    ]);
    carteLignes("Lieu d'intervention", [
      ['Adresse', _nettAdresseTexte(ndPdf)],
      ['Contact sur place', _contactSurPlaceTexte(ndPdf.contact_sur_place)]
    ]);
    carteLignes('Véhicules à nettoyer',
      (ndPdf.repartition_categories || []).filter(function (r) { return r && r.quantite > 0; })
        .map(function (r) {
          var lib = NETT_LIB_CAT[r.categorie] || r.categorie;
          if (r.precision) lib += ' (' + r.precision + ')';
          return [lib, r.quantite + (r.quantite > 1 ? ' véhicules' : ' véhicule')];
        }));
  }

  if (_estDemandeProfessionnel(c)) {
    var pdPdf = _proDetails(c) || {};
    var estTechPdf = (pdPdf.categorie === 'technicien');
    y += ESPACE_AVANT_TITRE_GLOBAL;
    sectionTitre('Trouver un professionnel automobile');
    // LOT D4 — le devis d'un TECHNICIEN se lit sur la periode, la duree
    // et le nombre de professionnels. Plus aucun vehicule : ni compte
    // reel, ni vehicule fictif.
    bandeauIndicateurs(estTechPdf ? [
      ['Besoin', PRO_LIB_CATEGORIE[pdPdf.categorie] || ''],
      ['Spécialité', _proLibelleMetier(pdPdf)],
      ['Professionnels', pdPdf.nombre_professionnels || ''],
      ['Durée', _proDureeTexte(pdPdf)]
    ] : [
      ['Besoin', PRO_LIB_CATEGORIE[pdPdf.categorie] || ''],
      ['Mission', _proLibelleMetier(pdPdf)],
      ['Professionnels', pdPdf.nombre_professionnels || ''],
      ['Durée', _proDureeTexte(pdPdf)]
    ]);
    carteLignes(estTechPdf ? 'Intervention' : 'Mission sur site', [
      ['Lieu', _proAdresseTexte(pdPdf)],
      ['Contact sur place', _contactSurPlaceTexte(pdPdf.contact_sur_place)],
      ['Période', _proPeriodeTexte(pdPdf)],
      ['Horaires', _proHorairesTexte(pdPdf)],
      ['Précision', pdPdf.precision || ''],
      [estTechPdf ? 'Mission' : 'Type de mission', pdPdf.description || '']
    ]);
    if (estTechPdf && (pdPdf.vehicules || []).length) {
      carteLignes(pdPdf.vehicules.length > 1 ? 'Informations sur les véhicules' : 'Information sur le véhicule',
        pdPdf.vehicules.map(function (v, i) {
          return ['Véhicule ' + (i + 1),
            [PRO_LIB_TYPE_VEHICULE[v.type_vehicule] || v.type_vehicule, v.marque_modele]
              .filter(Boolean).join(' — ')];
        }));
    }
    // Uniquement le texte libre du client ; bloc entièrement absent s'il
    // est vide.
    carteTexte('Informations complémentaires', pdPdf.informations_complementaires);
  }

  // ══ STOCKAGE — mêmes codes graphiques que les autres blocs ══
  if (_aStockage(c)) {
    // V50.4A — Objectifs 5/6/11 : durée réelle MONO uniquement (jamais en
    // multi — chaque véhicule a la sienne, affichée plus bas dans la
    // section Véhicules).
    var _nbVehPdfStock = _nbVehiculesDossier(c);
    var _finEffPdfStock = _finStockageEffectiveDossier(c);
    // CORRECTION MÉTIER — la durée doit être recalculée dès que la fin
    // effective diffère de la fin prévue, dans LES DEUX SENS (sortie
    // anticipée désormais possible, pas seulement prolongation comme
    // avant). Même fonction _joursEntreDatesDash() inchangée, seule la
    // condition de déclenchement est corrigée (`!==` au lieu de `>`).
    var _prolongePdfStock = (_nbVehPdfStock < 2 && _finEffPdfStock && c.stockage_date_fin && _finEffPdfStock !== c.stockage_date_fin);
    // V50.4D — Objectif 6 : SIMPLIFICATION — plus de doublon Période/Durée
    // PUIS Stockage-pris-en-compte/Durée-réelle redondants. Une seule
    // lecture : la date « prise en compte » et la durée affichées sont
    // TOUJOURS la vue effective (= la prévue quand il n'y a pas de
    // prolongation, puisque _finEffPdfStock vaut alors stockage_date_fin).
    // AUCUN changement du calcul métier : _finStockageEffectiveDossier()
    // et _joursEntreDatesDash() sont inchangées, on simplifie uniquement
    // la présentation.
    // V50.4L — CORRECTIF : en MULTI, ce bloc dossier affichait jusqu'ici la
    // date PRÉVUE partagée par tous (c.stockage_date_fin), sans jamais
    // regarder la fin effective de chaque véhicule — incohérent dès qu'un
    // véhicule prolongeait réellement le stockage (livraison HelixCar
    // après la fin prévue), pourtant déjà correctement affichée dans SA
    // propre carte. Corrigé en réutilisant _finStockageEffectiveVehiculeDash()
    // — LA MÊME fonction déjà utilisée par chaque carte véhicule
    // individuelle (aucune nouvelle logique métier) — pour retenir la fin
    // effective la plus tardive parmi tous les véhicules du dossier. Un
    // véhicule récupéré directement par le client (sans date_livraison)
    // renvoie sa fin PRÉVUE inchangée par cette même fonction : aucune
    // prolongation fictive n'est jamais introduite.
    var _finAfficheeStock, _jAfficheStock;
    if (_nbVehPdfStock < 2) {
      _finAfficheeStock = _finEffPdfStock || c.stockage_date_fin;
      _jAfficheStock = _prolongePdfStock ? _joursEntreDatesDash(c.stockage_date_debut, _finEffPdfStock) : c.stockage_nb_jours;
    } else {
      // CORRECTION MÉTIER — ne jamais initialiser artificiellement le
      // maximum avec c.stockage_date_fin : chaque véhicule SANS
      // livraison HelixCar récupère déjà cette date via
      // _finStockageEffectiveVehiculeDash() elle-même (comportement
      // inchangé de cette fonction). Construire la liste des fins
      // effectives RÉELLES de tous les véhicules, puis prendre la plus
      // tardive de CETTE liste — jamais une borne plancher artificielle
      // qui empêcherait le résultat global d'être plus précoce que la
      // fin prévue lorsque tous les véhicules sont réellement sortis
      // plus tôt.
      var _finsEffectivesMultiStock = _vehiculesDuDossier(c).map(function (vStock) {
        return _finStockageEffectiveVehiculeDash(c, vStock);
      }).filter(Boolean);
      var _finGlobaleMultiStock = _finsEffectivesMultiStock.length
        ? _finsEffectivesMultiStock.reduce(function (maxF, f) { return (f > maxF) ? f : maxF; })
        : c.stockage_date_fin; // filet de sécurité si aucun véhicule (cas improbable)
      _finAfficheeStock = _finGlobaleMultiStock;
      // La durée globale correspond désormais TOUJOURS à
      // stockage_date_debut → _finAfficheeStock, dans les deux sens
      // (diminue si la fin globale réelle est plus précoce que la fin
      // prévue, augmente si elle est plus tardive) — plus de condition
      // limitant ce recalcul aux seules prolongations. Même fonction
      // _joursEntreDatesDash() inchangée.
      _jAfficheStock = _joursEntreDatesDash(c.stockage_date_debut, _finGlobaleMultiStock);
    }
    // V50.4D — Objectif 8 : logique V50.3H stricte, même règle métier que
    // le formulaire client (miroir de _heureEntreeStockageApplicable() /
    // _heureSortieStockageApplicable()) — jamais une heure devenue non
    // applicable, même si une valeur historique existe encore en base.
    var _entreeAppliDash = _heureEntreeApplicableDash(c);
    var _sortieAppliDash = _heureSortieApplicableDash(c);

    sectionAvecBloc('Stockage automobile', function (dess) {
      var y0 = y, cur = y0 + 6.5;
      // V50.4I — Objectifs G/H/I : RECOMPOSITION EN 2 LIGNES VISUELLES
      // PROPRES, demandée explicitement plutôt que de continuer à ajuster
      // des colonnes mal adaptées. LIGNE 1 (4 colonnes sur une même
      // rangée) : Nombre de véhicules, Début du stockage, Stockage pris en
      // compte jusqu'au, Durée — chaque libellé directement au-dessus de
      // sa valeur, jamais de chevauchement. LIGNE 2 (indépendante, sa
      // propre paire de colonnes) : les heures, quand applicables. Aucune
      // valeur réduite (Objectif I) : toujours 9pt, comme en V50.4H.
      // Largeurs en mm fixes (mesurées pour chaque libellé exact à 7.5pt
      // gras, marge de 3 à 4mm incluse) plutôt qu'un pourcentage uniforme :
      // un pourcentage identique pour 4 libellés de longueurs très
      // différentes forçait « NOMBRE DE VÉHICULES » et « DÉBUT DU
      // STOCKAGE » sur 2 lignes (filet de sécurité etiquetteAdaptative
      // correctement déclenché, mais résultat peu soigné) alors que
      // « STOCKAGE PRIS EN COMPTE JUSQU'AU » avait presque trop de place.
      // V50.14 — quatre rubriques de largeur égale : chaque séparateur
      // tombe exactement à la frontière médiane entre deux rubriques.
      // Aucun trait ne vient désormais frôler un libellé.
      var wStockCol = (LARGEUR - 12) / 4;
      var wNbVeh = wStockCol;
      var wDebutStock = wStockCol;
      var wJusquauStock = wStockCol;
      var wDureeStock = wStockCol;
      var xNbVeh = xG;
      var xDebutStock = xG + wStockCol;
      var xJusquauStock = xG + (wStockCol * 2);
      var xDureeStock = xG + (wStockCol * 3);

      // V50.4F — Objectif 14 : hauteur mesurée AVANT dessin (jamais
      // supposée) — si un libellé passe malgré tout sur 2 lignes, la
      // valeur en dessous décale d'autant, pour toute la ligne.
      var nLignesStock = 1;
      nLignesStock = Math.max(nLignesStock, etiquetteAdaptativeLisible('Nombre de véhicules', xNbVeh, cur, wNbVeh, 10.4, 9.2, dess));
      nLignesStock = Math.max(nLignesStock, etiquetteAdaptativeLisible('Début du stockage', xDebutStock, cur, wDebutStock, 10.4, 9.2, dess));
      nLignesStock = Math.max(nLignesStock, etiquetteAdaptativeLisible('Fin du stockage', xJusquauStock, cur, wJusquauStock, 10.4, 9.2, dess));
      nLignesStock = Math.max(nLignesStock, etiquetteAdaptativeLisible('Durée', xDureeStock, cur, wDureeStock, 10.4, 9.2, dess));
      cur += 3.8 + (nLignesStock - 1) * 3.6;
      if (dess) {
        // V50.9 — maquette Premium ChatGPT : trois séparateurs verticaux
        // très fins structurent les quatre indicateurs sans effet tableau lourd.
        doc.setDrawColor(GRIS_FILET[0], GRIS_FILET[1], GRIS_FILET[2]);
        doc.setLineWidth(0.15);
        var ySepStockHaut = y0 + 3.2;
        var ySepStockBas = cur + 3.2;
        // V50.14 — séparateurs centrés dans la respiration entre rubriques.
        // Les textes commencent avec un retrait interne ; le trait reste
        // visuellement à égale distance des contenus voisins.
        var retraitStock = 3.0;
        [xDebutStock - retraitStock, xJusquauStock - retraitStock, xDureeStock - retraitStock].forEach(function (xs) {
          doc.line(xs, ySepStockHaut, xs, ySepStockBas);
        });
        // V50.38 — deux micro-ajustements visuels uniquement :
        // nombre de véhicules légèrement plus bas ; durée légèrement plus haute.
        // Début/fin du stockage, tailles, colonnes, pagination et logique restent inchangés.
        valeur(c.stockage_nb_vehicules ? String(c.stockage_nb_vehicules) : '—', xNbVeh, cur + 1.4, 9.8);
        valeur(_dvDate(c.stockage_date_debut), xDebutStock, cur - 2.0, 9.8);
        valeur(_dvDate(_finAfficheeStock), xJusquauStock, cur - 2.0, 9.8);
        valeur(_jAfficheStock ? _jAfficheStock + (_jAfficheStock > 1 ? ' jours' : ' jour') : '—', xDureeStock, cur - 2.0, 9.8);
      }
      cur += 5.5;

      if (_entreeAppliDash || _sortieAppliDash) {
        // V50.4J — Objectifs 3/4 : « PRÉVUE » retiré des deux libellés
        // (aucune donnée changée, uniquement le texte affiché). Alignement
        // corrigé : HEURE D'ENTRÉE utilise désormais EXACTEMENT les mêmes
        // positions/largeurs que la colonne DÉBUT DU STOCKAGE juste
        // au-dessus, et HEURE DE RÉCUPÉRATION celles de STOCKAGE PRIS EN
        // COMPTE JUSQU'AU — correspondance visuelle garantie au pixel près
        // (mêmes variables xDebutStock/xJusquauStock/wDebutStock/
        // wJusquauStock que la ligne 1), plutôt qu'un empan indépendant
        // recalculé qui ne coïncidait avec aucune colonne du dessus.
        var nLignesHeures = 1;
        if (_entreeAppliDash) nLignesHeures = Math.max(nLignesHeures, etiquetteAdaptativeLisible('Heure d\'entrée', xDebutStock, cur, wDebutStock, 10.1, 9.0, dess));
        if (_sortieAppliDash) nLignesHeures = Math.max(nLignesHeures, etiquetteAdaptativeLisible('Heure de récupération', xJusquauStock, cur, wJusquauStock, 10.1, 9.0, dess));
        cur += 5 + (nLignesHeures - 1) * 3.6;
        if (dess) {
          if (_entreeAppliDash) valeur(c.stockage_heure_entree, xDebutStock, cur, 9.8);
          if (_sortieAppliDash) valeur(c.stockage_heure_sortie, xJusquauStock, cur, 9.8);
        }
        cur += 5.5;
      }

      return cur - y0;
    });
    y += ESPACE_SECTION;
  }

  // ══ TRAJET (+ restitution intégrée) — uniquement si convoyage ══
  // Client qui dépose lui-même : mention explicite plutôt qu'un bloc vide.
  if (_aStockage(c) && !pcOk && !livOk && !_estMultiIndividuelTrajet) {
    sectionAvecBloc('Prise en charge', function (dess) {
      var y0 = y, cur = y0 + 6.5;
      // V50.4D — Objectif 7 : mise en évidence typographique (gras) — le
      // paramètre gras=false explicite a été retiré, valeur() est en gras
      // par défaut. Simple ajustement de présentation.
      if (dess) valeur('Dépôt au stockage par le client', xG, cur, 9.5);
      cur += 5.5;
      return cur - y0;
    });
    y += ESPACE_SECTION;
  }

  if (pcOk || livOk) {
  var titreTrajet = _aStockage(c) ? 'Convoyage HelixCar' : 'Trajet';
  var xD = M + LARGEUR / 2 + 3;
  var wVille = LARGEUR / 2 - 16;
  // Ligne du dessous : la rue seule si les champs séparés existent,
  // sinon l'ancienne adresse complète (demandes antérieures).
  // V50.4A — Objectif 9 : côté non assuré par HelixCar (ex. stockage avec
  // dépôt/récupération client d'un seul côté) -> AUCUNE adresse/date/horaire
  // à tirets : simplement pas de sous-ligne, la phrase du dessus explique
  // déjà tout. Quand pcOk ET livOk (cas normal, très large majorité des
  // dossiers), le comportement est STRICTEMENT identique à avant.
  // V50.4M — version courte (numéro + nom de voie) réservée à ce bloc.
  var texteDep = pcOk ? (_rueCourteTrajet(c.adresse_depart_rue) || _dv(c.ville_depart)) : '';
  var texteArr = livOk ? (_rueCourteTrajet(c.adresse_arrivee_rue) || _dv(c.ville_arrivee)) : '';
  // V50.4I — même correctif que _preCasserMotsLongsPdf (Objectif B/C) :
  // ces mesures se faisaient hors de tout bloc dess=true/false, avec l'état
  // jsPDF résiduel du bloc précédent. La police réelle de dessin (8, normal
  // — cf. plus bas) est désormais fixée explicitement AVANT de mesurer.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.0);
  var aDep = pcOk ? doc.splitTextToSize(texteDep, wVille).slice(0, 2) : [];
  var aArr = livOk ? doc.splitTextToSize(texteArr, wVille).slice(0, 2) : [];
  var nA = Math.max(aDep.length, aArr.length);
  var adrRestit = [];
  if (aRestit) {
    var tR = _rueSeule(c.adresse_restit_rue)
          || (!estVide(c.adresse_restitution) ? c.adresse_restitution : _dv(c.ville_depart));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.3);
    adrRestit = doc.splitTextToSize(String(tR), wVille).slice(0, 2);
  }

  sectionAvecBloc(titreTrajet, function (dess) {
    var y0 = y, cur = y0 + 6.5;
    // V50.4E — Objectif 4 : « Prise en charge »/« Livraison » sont les deux
    // libellés vedettes du bloc — légèrement plus grands (10) que les
    // libellés standards (8.5) puisqu'ils introduisent tout le bloc.
    if (dess) { etiquette('Prise en charge', xG, cur, 10.5); etiquette('Livraison', xD, cur, 10.5); }
    cur += 5.4;
    if (dess) {
      if (pcOk) {
        // V50.4E — Objectif 3 : valeur vedette légèrement réduite (11 -> 9.5)
        // pour rester plus petite que son libellé (désormais 10), tout en
        // conservant le gras et une taille nettement supérieure aux champs
        // standards (7.8) — elle reste la valeur la plus visible du bloc.
        valeur(_villeCP(c.ville_depart, c.code_postal_depart, c.ville_depart), xG, cur, 9.8);
      } else {
        // V50.4D — Objectif 7 : gras.
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
        doc.setTextColor(95, 100, 105);
        T('Dépôt au stockage par le client', xG, cur);
      }
      if (livOk) {
        valeur(_villeCP(c.ville_arrivee, c.code_postal_arrivee, c.ville_arrivee), xD, cur, 9.8);
      } else {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
        doc.setTextColor(95, 100, 105);
        T('Récupération du véhicule par le client', xD, cur);
      }
      if (pcOk && livOk) {
        // V50.7 — la référence visuelle fournie ne montre aucun trait
        // vertical central ici, uniquement l'espace entre les deux
        // colonnes et le chevron rouge. Retrait de l'ajout V50.6.1 pour
        // reproduction fidèle.
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.setTextColor(ROUGE[0], ROUGE[1], ROUGE[2]);
        T('>', M + LARGEUR / 2 - 28, y0 + 6.5); // V50.32 — même X validé, Y remonté à hauteur de PRISE EN CHARGE / LIVRAISON
      }
    }
    cur += 4.6;
    if (dess) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.0);
      doc.setTextColor(95, 100, 105);
      if (pcOk) T(aDep, xG, cur);
      if (livOk) T(aArr, xD, cur);
    }
    cur += nA * 4.3 + 5;

    // V50.4F — Objectif 2/6 : CAUSE EXACTE confirmée par mesure —
    // « DATE DE PRISE EN CHARGE » (23 caractères) dépassait un quart de
    // colonne égal (40mm) à 8.5 gras, contrairement à « DATE DE
    // LIVRAISON » (18 caractères), plus courte — d'où la collision
    // signalée uniquement côté prise en charge.
    // V50.4I — Objectifs J/K/L/M : le resserrement V50.4G (42mm/18mm bout à
    // bout) supprimait la collision mais laissait une gouttière quasi
    // nulle entre la fin de la colonne HORAIRE (prise en charge) et le
    // début de la colonne DATE DE LIVRAISON — les deux valeurs se
    // touchaient visuellement dès qu'elles étaient un peu longues
    // (ex. « 08:00–10:00 » suivi immédiatement de « 22/10/2026 »).
    // Corrigé en considérant le bloc comme deux VRAIES moitiés (Prise en
    // charge / Livraison) séparées par une gouttière explicite d'au moins
    // 5mm — jamais 0,1mm. Libellés INCHANGÉS (etiquetteAdaptative, même
    // taille/graisse/contenu qu'avant) : seul le positionnement horizontal
    // change.
    var GOUTTIERE_TRAJET = 8;
    var largeurDemiTrajet = ((LARGEUR - 14) - GOUTTIERE_TRAJET) / 2;
    var wDateGr = largeurDemiTrajet * 0.68;
    var wHoraireGr = largeurDemiTrajet * 0.32;
    var xPcDate = xG;
    var xPcHoraire = xG + wDateGr;
    var xLivDate = xG + largeurDemiTrajet + GOUTTIERE_TRAJET;
    var xLivHoraire = xLivDate + wDateGr;

    // Objectif 3 (V50.5H) — libellé au singulier ou au pluriel selon que
    // l'opération porte une heure précise ou un créneau. Règle
    // INDÉPENDANTE pour chaque opération (prise en charge, livraison,
    // restitution peuvent différer). Réutilise _horaireDossier(), la
    // même source que les valeurs dessinées juste en dessous — le
    // séparateur ' – ' identifie un créneau, exactement comme dans
    // _horaireCompactTrajetPdf()/_phraseHoraireFr() déjà validées.
    // AUCUNE valeur affichée n'est modifiée, uniquement le libellé.
    function _libelleHoraireTrajet(prefixe) {
      var brut = _horaireDossier(c, prefixe);
      return (brut && String(brut).indexOf(' – ') !== -1) ? 'Horaires' : 'Horaire';
    }

    var nLignesDH = 1;
    if (pcOk) {
      nLignesDH = Math.max(nLignesDH, etiquetteAdaptativeLisible('Date de prise en charge', xPcDate, cur, wDateGr, 9.8, 8.8, dess));
      nLignesDH = Math.max(nLignesDH, etiquetteAdaptativeLisible(_libelleHoraireTrajet('pc'), xPcHoraire, cur, wHoraireGr, 9.8, 8.8, dess));
    }
    if (livOk) {
      nLignesDH = Math.max(nLignesDH, etiquetteAdaptativeLisible('Date de livraison', xLivDate, cur, wDateGr, 9.8, 8.8, dess));
      nLignesDH = Math.max(nLignesDH, etiquetteAdaptativeLisible(_libelleHoraireTrajet('liv'), xLivHoraire, cur, wHoraireGr, 9.8, 8.8, dess));
    }
    cur += 5 + (nLignesDH - 1) * 3.6;
    if (dess) {
      if (pcOk) {
        // V50.4E — Objectif 5 : symétrie stricte avec Livraison — mêmes
        // taille ET gras. Le `false` qui rendait Prise en charge non-gras
        // (alors que Livraison l'était depuis V50.4D) a été retiré.
        valeur(_dvDate(c.date_prise_en_charge), xPcDate, cur, 9.7);
        var _hPc = _horaireCompactTrajetPdf(_horaireDossier(c, 'pc'));
        valeur(estVide(_hPc) ? '—' : _hPc, xPcHoraire, cur, 9.7);
      }
      if (livOk) {
        // V50.4D — Objectif 9 : date + heure/créneau de LIVRAISON en gras
        // (valeur() est en gras par défaut dès que gras !== false).
        valeur(_dvDate(c.date_livraison), xLivDate, cur, 9.7);
        var _hLiv = _horaireCompactTrajetPdf(_horaireDossier(c, 'liv'));
        valeur(estVide(_hLiv) ? '—' : _hLiv, xLivHoraire, cur, 9.7);
      }
    }
    cur += 5.5;

    if (aRestit) {
      if (dess) {
        doc.setDrawColor(207, 207, 207); doc.setLineWidth(0.2);
        doc.setLineDashPattern([0.7, 0.7], 0);
        doc.line(xG, cur, L - 7, cur);
        doc.setLineDashPattern([], 0);
      }
      cur += 5.5;
      if (dess) {
        doc.setFillColor(ROUGE[0], ROUGE[1], ROUGE[2]);
        doc.circle(xG + 1.4, cur - 1.1, 1.4, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.setTextColor(ROUGE[0], ROUGE[1], ROUGE[2]);
        T('RESTITUTION', xG + 5, cur);
        valeur(_villeCP(c.ville_restit, c.code_postal_restit,
          !estVide(c.adresse_restitution) ? c.adresse_restitution : c.ville_depart), xD, cur, 10.5);
      }
      cur += 4.6;
      if (dess) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.3);
        doc.setTextColor(95, 100, 105);
        T(doc.splitTextToSize(_libelleTrajetRetour(c.type_trajet_retour), wVille - 5).slice(0, 1), xG + 5, cur);
        T(adrRestit, xD, cur);
      }
      cur += Math.max(1, adrRestit.length) * 4.3 + 5;
      if (dess) { etiquette('Date de restitution', xG + 5, cur); etiquette(_libelleHoraireTrajet('restit'), xD, cur); }
      cur += 5;
      if (dess) {
        valeur(_dvDate(c.date_restitution), xG + 5, cur, 9, false);
        var _hRestit = _horaireCompactTrajetPdf(_horaireDossier(c, 'restit'));
        valeur(estVide(_hRestit) ? '—' : _hRestit, xD, cur, 9, false);
      }
      cur += 5.5;
    }
    return cur - y0;
  });
  y += ESPACE_SECTION;
  } // fin bloc TRAJET

  // ══ VÉHICULE(S) — depuis la source de vérité, jamais un faux véhicule ══
  var vhPdf = _vehiculesDuDossier(c);
  var stockSeul = _aStockage(c) && !_aConvoyage(c);
  // V50.4B — Objectif 1 : CAUSE DU BUG — _vehiculesDuDossier() construit,
  // pour un dossier MONO, un objet véhicule SYNTHÉTIQUE (type/marque/
  // immat/vin uniquement) qui ne porte JAMAIS date_livraison : cette
  // donnée vit sur le DOSSIER (c.date_livraison), pas sur l'objet
  // véhicule. Le code V50.4A lisait v.date_livraison directement, donc
  // toujours vide en mono — même quand HelixCar livre réellement après
  // stockage — d'où le faux « Récupération du véhicule par le client ».
  // En multi (vraies lignes de la table vehicules), v.date_livraison
  // EXISTE et reste la bonne source (seul chemin qui la remplit côté
  // formulaire, cf. V50.3B). On calcule donc la bonne source UNE FOIS,
  // par dossier, puis on l'utilise systématiquement dans la boucle.
  var _nbVehPdf = _nbVehiculesDossier(c);
  var _monoPdf = _nbVehPdf < 2;
  var _livDossierApplicablePdf = _monoPdf && _operationDossier(c, 'liv') ? (c.date_livraison || null) : null;

  if (c.flotte_a_detailler) {
    sectionAvecBloc('Flotte', function (dess) {
      var y0 = y, cur = y0 + 6.5;
      var t2 = (LARGEUR - 14) / 2;
      if (dess) { etiquette('Nombre de véhicules', xG, cur); etiquette('Détail', xG + t2, cur); }
      cur += 5;
      if (dess) {
        valeur(c.nb_vehicules ? String(c.nb_vehicules) : '—', xG, cur, 9);
        valeur('À finaliser avec HelixCar', xG + t2, cur, 9, false);
      }
      cur += 5.5;
      return cur - y0;
    });
    y += ESPACE_SECTION;

  } else if (vhPdf.length) {
    var titreVeh = stockSeul
      ? (vhPdf.length === 1 ? 'Véhicule à stocker' : 'Véhicules à stocker')
      : (vhPdf.length === 1 ? 'Véhicule' : 'Véhicules');
    y += ESPACE_AVANT_TITRE_GLOBAL;
    // V50.4D — Objectif 1/2 : CAUSE DU BUG DE PAGINATION — tous les
    // véhicules étaient auparavant dessinés à l'intérieur d'un SEUL
    // blocIvoire couvrant tout le dossier. jsPDF ne casse jamais
    // automatiquement une page : au-delà de ~270mm, le contenu continuait
    // simplement à être dessiné hors-page, invisible (d'où V3 tronqué,
    // PRESTATIONS absente, montant déplacé). Chaque véhicule est
    // désormais SA PROPRE carte, mesurée puis paginée individuellement
    // (même mécanisme que sectionAvecBloc, cf. plus haut) : une carte qui
    // ne tient pas dans l'espace restant part intégralement sur une
    // nouvelle page, jamais coupée en deux.
    // V50.32 — étirement visuel adaptatif d'une carte, uniquement lorsqu'une page
    // multi ne peut pas accueillir la carte suivante. La hauteur supplémentaire
    // est mesurée ET dessinée, donc jamais de coupure ni de décalage fantôme.
    var _etirementCartePdf = 0;
    var _dessinerCarteVehicule = function (v, i, dess) {
      var y0 = y, cur = y0 + 8.0;
      if (dess) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.3);
        doc.setTextColor(ROUGE[0], ROUGE[1], ROUGE[2]);
        T('VÉHICULE ' + (v.position || i + 1), xG, cur);
      }
      cur += 6.0;
      // V50.9 VISUEL — Référence premium : identité véhicule en 3 colonnes
      // (TYPE / MARQUE-MODÈLE / IMMATRICULATION) sur une seule rangée.
      // Pure présentation : mêmes sources de données, aucune règle métier modifiée.
      var wColV = LARGEUR - 14;
      var LARGEUR_TIRET_OP = 2.5;
      var ESPACE_TIRET_TEXTE_OP = 1.8;
      var xTexteOp = xG + LARGEUR_TIRET_OP + ESPACE_TIRET_TEXTE_OP;
      var wColVOp = wColV - (LARGEUR_TIRET_OP + ESPACE_TIRET_TEXTE_OP);

      var wTypeV = wColV / 3;
      var wMarqueV = wColV / 3;
      var wImmatV = wColV - wTypeV - wMarqueV;
      // V50.32 — lisibilité finale trajet/identité : adresses 10pt, labels identité 10.5pt, chevron plus à gauche
      // V50.26 — véhicule à stocker : 3 colonnes nettes, libellé et valeur alignés à gauche + respiration renforcée
      // V50.25 — finition lisibilité globale + valeurs véhicule alignées à gauche dans leurs colonnes
      // V50.24 — identité véhicule sur trois vrais repères visuels :
      // gauche / centre / droite. TYPE conserve son ancrage gauche ;
      // MARQUE / MODÈLE est réellement centré dans la carte ;
      // IMMATRICULATION est ancrée à droite. Les trois zones gardent
      // chacune 1/3 de la largeur utile pour préserver les modèles longs.
      var xTypeV = xG;
      var xMarqueV = xG + wColV / 3;
      var xImmatV = xG + (2 * wColV / 3) + 4.0; // V50.29 — seule la colonne IMMATRICULATION est légèrement décalée à droite
      var xTitreTypeV = xTypeV;
      var xTitreMarqueV = xMarqueV;
      var xTitreImmatV = xImmatV;

      if (dess) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.setTextColor(GRIS_LABEL[0], GRIS_LABEL[1], GRIS_LABEL[2]);
        doc.text('TYPE', xTitreTypeV, cur);
        doc.text('MARQUE / MODÈLE', xTitreMarqueV, cur);
        if (v.immatriculation) doc.text('IMMATRICULATION', xTitreImmatV, cur);
      }
      cur += 5;

      // V50.24 — même corps pour toutes les valeurs d'identité : aucune
      // immatriculation/date/valeur visuellement plus petite qu'une autre.
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.8);
      var aTypeV = doc.splitTextToSize(
        _preCasserMotsLongsPdf(doc, String(_libelleTypeVehicule(v.type_vehicule) || '—'), wTypeV - 4, 10.8, 'bold'), wTypeV - 4
      ).slice(0, 2);
      var aMarqueV = doc.splitTextToSize(
        _preCasserMotsLongsPdf(doc, String(_dv(v.marque_modele)), wMarqueV - 4, 10.8, 'bold'), wMarqueV - 4
      ).slice(0, 2);
      var aImmatV = v.immatriculation ? doc.splitTextToSize(
        _preCasserMotsLongsPdf(doc, String(v.immatriculation), wImmatV - 6, 10.8, 'bold'), wImmatV - 6
      ).slice(0, 2) : [];

      if (dess) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.8);
        doc.setTextColor(ANTHRACITE_V6[0], ANTHRACITE_V6[1], ANTHRACITE_V6[2]);
        doc.text(aTypeV, xTypeV, cur);
        aMarqueV.forEach(function(ligne, idx) { doc.text(ligne, xMarqueV, cur + idx * 4.0); });
        if (aImmatV.length) aImmatV.forEach(function(ligne, idx) { doc.text(ligne, xImmatV, cur + idx * 4.0); });
      }
      var lignesIdentiteV = Math.max(aTypeV.length, aMarqueV.length, aImmatV.length || 1);
      // V50.17 — disposition de référence : le séparateur est placé au milieu
      // de la respiration entre l'identité et les opérations.
      // V50.19 — le filet est remonté encore : il se place visuellement au milieu
      // entre la dernière ligne d'identité et la première opération, sans coller à celle-ci.
      // Le budget vertical total reste inchangé pour préserver la pagination.
      cur += lignesIdentiteV * 4.0 - 0.4;

      // V50.6.1 — Objectif 4 : séparation visuelle légère entre les deux
      // sous-zones de la carte — A. IDENTITÉ (type / marque / immat) et
      // B. OPÉRATIONS (lignes à tiret rouge) — SANS ajouter de titre
      // « IDENTITÉ »/« OPÉRATIONS », comme demandé : une simple ligne
      // très fine suffit à structurer. Le filet ne couvre volontairement
      // que la moitié de la largeur : il structure sans découper la
      // carte. Coût vertical volontairement MINIMAL (2mm au total) pour
      // ne pas risquer de pousser le tarif en page 2 (Objectif 15).
      // Compté dans `cur` de façon identique en passe de MESURE et de
      // DESSIN — la hauteur de carte reste donc exacte.
      // V50.15 — référence visuelle validée : séparateur horizontal très subtil
      // entre l'identité du véhicule et les opérations. Il reste strictement
      // à l'intérieur de la carte et ne touche jamais la barre rouge latérale.
      if (dess) {
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.16);
        doc.line(xG, cur, xG + wColV, cur);
      }
      // V50.26 — respiration véhicule : la première opération descend nettement
      // sous l'identité, sans modifier l'interligne interne des opérations.
      cur += 9.2 + (_etirementCartePdf * 0.58);

      // V50.4H — CORRECTIF : pour un dossier MONO, l'adresse et la date de
      // prise en charge/livraison vivent sur le DOSSIER (c.ville_depart,
      // c.date_prise_en_charge, etc.) — l'objet véhicule synthétique ne
      // porte que type/marque/immat/vin (même distinction mono/multi déjà
      // établie pour date_livraison en V50.4B). Sans cette correction, la
      // carte d'un véhicule mono affichait toujours « Prise en charge : — »
      // même quand le trajet réel existait (visible plus haut dans le bloc
      // Convoyage HelixCar du dossier).
      var adrDepartEff = _monoPdf
        ? _adresseCompleteOuVille(c.adresse_depart_rue, c.code_postal_depart, c.ville_depart)
        : _adresseCompleteOuVille(v.adresse_depart_rue, v.code_postal_depart, v.ville_depart);
      var adrArriveeEff = _monoPdf
        ? _adresseCompleteOuVille(c.adresse_arrivee_rue, c.code_postal_arrivee, c.ville_arrivee)
        : _adresseCompleteOuVille(v.adresse_arrivee_rue, v.code_postal_arrivee, v.ville_arrivee);
      var datePcEff = _monoPdf ? c.date_prise_en_charge : v.date_prise_en_charge;
      // V50.4J — Objectif 5/6/7/8 : source de l'heure/créneau, mono (niveau
      // dossier, _horaireDossier déjà utilisée par le grand bloc TRAJET) ou
      // multi (niveau véhicule, _horaireVehicule — déjà existante, jamais
      // utilisée pour la carte jusqu'ici). Aucune heure n'est inventée :
      // ces fonctions renvoient null si rien n'est renseigné.
      var horairePcEff = _phraseHoraireFr(_monoPdf ? _horaireDossier(c, 'pc') : _horaireVehicule(v, 'pc'));
      var horaireLivEff = _phraseHoraireFr(_monoPdf ? _horaireDossier(c, 'liv') : _horaireVehicule(v, 'liv'));
      var _modeLigneV = _libelleModeTransport(v.mode_transport);

      // V50.4J — Objectif 5 : UNE ligne métier complète par opération
      // (adresse + date + heure/créneau) au lieu de plusieurs lignes
      // séparées. Retourne null si aucune adresse (rien à afficher) —
      // jamais de donnée inventée pour la date ou l'heure, simplement
      // omise si absente.
      function _ligneOperationVCombinee(label, adresse, date, heure) {
        if (!adresse) return null;
        var texte = label + ' : ' + adresse;
        if (date) texte += ' le ' + _dvDate(date);
        // V50.5D.3I — Objectif 2 : `heure` est désormais la phrase
        // française complète ("à 16h30" / "entre 15h30 et 16h30"),
        // fournie par l'appelant via _phraseHoraireFr() — plus de
        // préfixe " à " codé ici en dur (qui produirait "à entre X et
        // Y" pour un créneau).
        if (heure && !estVide(heure)) texte += ' ' + heure;
        return texte;
      }
      // V50.4J — Objectif 10 : jusqu'à 3 lignes (au lieu de 2) pour les
      // adresses volontairement très longues combinées à une date et une
      // heure — retour à la ligne naturel, jamais de réduction de police
      // ni de compression, priorité absolue à la lisibilité.
      // Objectif tiret (V50.5G.4) — petit tiret rouge horizontal, DESSINÉ
      // graphiquement avec doc.line() (jamais un caractère "—" inséré
      // dans le texte). Utilise uniquement l'espace déjà existant entre
      // le bord de la carte et xG (= M + 7, donc 7mm disponibles) —
      // aucun déplacement du texte, aucune consommation de hauteur, le Y
      // fourni (celui de la PREMIÈRE ligne de l'opération) n'est ni lu
      // ni modifié par l'appelant après cet appel. Purement graphique :
      // n'avance jamais `cur`, ne dessine jamais qu'un seul tiret par
      // opération (l'appelant ne l'invoque qu'une fois, devant la
      // première ligne).
      // G.6 — CORRECTIF (Objectif 1) : le tiret commence désormais
      // EXACTEMENT à xDebut (= xG, même X que TEST-V1/Berline/etc.),
      // jamais à gauche de cet axe. Longueur = LARGEUR_TIRET_OP.
      function _dessinerTiretOperationPdf(xDebut, yPremiereLigne) {
        doc.setDrawColor(ROUGE[0], ROUGE[1], ROUGE[2]);
        doc.setLineWidth(0.6);
        // G.6 — léger réajustement supplémentaire de l'offset Y (1.15 ->
        // 1.0), rapproché encore de la ligne de base pour un centrage
        // plus fidèle sur la hauteur visuelle du texte, suite au retour
        // visuel réel. Longueur, épaisseur, couleur inchangées.
        doc.line(xDebut, yPremiereLigne - 1.0, xDebut + LARGEUR_TIRET_OP, yPremiereLigne - 1.0);
      }

      // Objectif 4 (G.5, corrigé G.6) — met en valeur (gras + noir
      // prononcé) UNIQUEMENT les dates DD/MM/YYYY, les heures HHhMM (1 ou
      // 2 chiffres) et les durées entre parenthèses « (N jour) »/« (N
      // jours) », dans les lignes opérationnelles des CARTES VÉHICULES.
      // Tout le reste (libellé, adresse, mots de liaison « le »/« à »/
      // « au »/« entre »/« et ») garde le style normal existant. Remplace
      // l'usage du gras complet (_dessinerLigneOperationnelleGrasComplet,
      // laissée totalement INTACTE plus haut, simplement plus appelée
      // depuis ces deux emplacements précis) UNIQUEMENT pour ce rendu des
      // cartes véhicules — aucune autre zone du PDF n'utilise cette
      // fonction.
      function _segmenterValeursCarteV(texte) {
        var regex = /(\d{2}\/\d{2}\/\d{4}|\d{1,2}h\d{2}|\(\d+\s*jours?\))/g;
        var segments = [], dernierIndex = 0, m;
        while ((m = regex.exec(texte)) !== null) {
          if (m.index > dernierIndex) segments.push({ texte: texte.slice(dernierIndex, m.index), valeur: false });
          segments.push({ texte: m[0], valeur: true });
          dernierIndex = m.index + m[0].length;
        }
        if (dernierIndex < texte.length) segments.push({ texte: texte.slice(dernierIndex), valeur: false });
        // G.7 — CORRECTIF DÉFINITIF DU COLLAGE VISUEL : la tentative G.6
        // (déplacer l'espace vers le segment suivant) s'est révélée
        // insuffisante sur le vrai rendu jsPDF — un espace positionné
        // pile à une bascule de police (normal<->bold) peut être absorbé
        // visuellement quel que soit le segment auquel on l'attribue,
        // car le problème n'est pas SON attribution mais le fait même de
        // confier son rendu à jsPDF à cet endroit précis. Solution
        // définitive : chaque espace de bordure entre deux segments
        // n'est plus JAMAIS dessiné comme caractère — il devient une
        // AVANCE NUMÉRIQUE EXPLICITE de curX (mesurée une fois via
        // doc.getTextWidth(' '), strictement identique en Helvetica
        // normal et bold), appliquée par _dessinerSegmentsValeursCarteV/
        // _largeurSegmentsValeursCarteV ci-dessous — jamais un glyphe
        // espace confié au moteur de rendu. Chaque segment est donc
        // débarrassé de ses espaces de bordure (comptés séparément),
        // son « coeur » de texte ne commence ni ne finit plus jamais par
        // un espace.
        return segments.map(function (s) {
          var espacesAvant = (/^ */.exec(s.texte) || [''])[0].length;
          var texteSansDebut = s.texte.slice(espacesAvant);
          var espacesApres = (/ *$/.exec(texteSansDebut) || [''])[0].length;
          var coeur = espacesApres > 0 ? texteSansDebut.slice(0, -espacesApres) : texteSansDebut;
          return { texte: coeur, valeur: s.valeur, espacesAvant: espacesAvant, espacesApres: espacesApres };
        });
      }
      // G.7 — la largeur d'un espace de bordure (espacesAvant/espacesApres
      // du segment) est ajoutée numériquement, jamais mesurée comme
      // faisant partie d'un texte dessiné.
      // G.8 — CORRECTIF DÉFINITIF : cause réelle trouvée dans le code —
      // `doc.getTextWidth(' ')` était mesuré SANS jamais fixer
      // explicitement la police juste avant (seule la TAILLE était
      // fixée). La largeur mesurée dépendait donc de l'état de police
      // RÉSIDUEL laissé par le tout dernier doc.setFont() appelé
      // ailleurs dans le PDF avant ce point précis — un état
      // imprévisible, potentiellement une police différente d'Helvetica.
      // Fonction UNIQUE, partagée entre la mesure et le dessin (jamais
      // deux implémentations séparées qui pourraient diverger) : fixe
      // TOUJOURS explicitement Helvetica normal + la taille demandée
      // avant de mesurer — jamais un état résiduel.
      // G.9 — HONNÊTETÉ TECHNIQUE : trois tentatives précédentes (G.6 :
      // déplacer l'espace vers le segment suivant ; G.7 : convertir
      // l'espace en avance numérique pure, jamais un glyphe dessiné ;
      // G.8 : fixer explicitement la police avant la mesure) reposaient
      // chacune sur une hypothèse plausible mais se sont révélées
      // INSUFFISANTES sur le vrai rendu PDF — la valeur calculée pour
      // « la largeur d'un espace » continue apparemment d'être rognée
      // par le moteur de rendu réel, pour une cause que je ne peux pas
      // isoler avec certitude sans accès à un vrai jsPDF dans cet
      // environnement. Plutôt que de proposer une quatrième hypothèse
      // tout aussi invérifiable, ce correctif abandonne le calcul
      // « précis » au profit d'un PLANCHER MINIMUM GÉNÉREUX, garanti
      // quelle que soit la cause exacte : au moins 1.3× la largeur
      // théorique d'un espace, avec un minimum absolu de 1mm — une
      // valeur volontairement plus grande qu'un espace typographique
      // parfait, mais impossible à confondre visuellement avec un
      // collage. Le compromis assumé : l'espacement paraîtra
      // légèrement plus large qu'un espace unique strict, en échange
      // d'une garantie de lisibilité réelle.
      function _largeurEspaceExplicitePdf(taille, estTransitionInitiale) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(taille);
        // G.13/G.14 (corrigé) — analyse des photos réelles : le collage
        // se produit TOUJOURS sur la PREMIÈRE transition normal->valeur
        // d'un texte indépendamment dessiné (ligne unique, ou chaque
        // ligne de repli en cas d'adresse longue), jamais sur les
        // transitions suivantes ("à", "entre", "et"). Un seuil basé sur
        // la LONGUEUR du segment précédent (tenté en G.13) s'est révélé
        // fragile : un retour à la ligne peut couper juste avant la
        // date, laissant un court reste sous le seuil alors que le
        // problème reste bien présent. Corrigé en ciblant directement
        // la PREMIÈRE transition de chaque texte, quelle que soit sa
        // longueur. Base 1.2mm partout, +1.0mm (= 2.2mm) sur cette
        // première transition (valeur choisie par l'utilisateur,
        // compromis risque/homogénéité).
        var base = 1.2;
        return base + (estTransitionInitiale ? 1.0 : 0);
      }
      function _largeurSegmentsValeursCarteV(segments, taille) {
        var l = 0;
        segments.forEach(function (s, idx) {
          if (idx > 0) {
            // G.15 — CORRECTIF DÉFINITIF : si le retour à la ligne
            // coupe juste avant la date, celle-ci devient ELLE-MÊME le
            // premier segment (en gras) — la transition idx=1 devient
            // alors "date -> à" (courte, doit rester à 1.2mm), jamais
            // "long texte -> date". Le bonus ne s'applique donc que si
            // le premier segment est un texte NORMAL substantiel
            // (jamais déjà une valeur elle-même).
            var estTransitionInitiale = (idx === 1 && !segments[0].valeur && segments[0].texte.length > 15);
            var largeurEspace = _largeurEspaceExplicitePdf(taille, estTransitionInitiale);
            l += largeurEspace * (segments[idx - 1].espacesApres + s.espacesAvant);
          }
          doc.setFont('helvetica', s.valeur ? 'bold' : 'normal');
          doc.setFontSize(taille);
          l += doc.getTextWidth(s.texte);
        });
        return l;
      }
      // G.7/G.8/G.13/G.14/G.15 — avant de dessiner chaque segment, curX
      // avance d'abord numériquement de la largeur EXPLICITE des
      // espaces de bordure (jamais un doc.text(' ', ...) qui pourrait
      // être absorbé par le rendu réel à une bascule de police), en
      // réutilisant EXACTEMENT la même fonction _largeurEspaceExplicitePdf()
      // que la mesure ci-dessus (même condition passée en paramètre,
      // donc même compensation appliquée en mesure et en dessin) — puis
      // la police du segment est (re)définie explicitement, PUIS le
      // segment est dessiné, PUIS mesuré avec cette même police pour
      // avancer X exactement de sa largeur réelle.
      function _dessinerSegmentsValeursCarteV(segments, x, yy, taille, couleurNormale, couleurValeur) {
        var curX = x;
        segments.forEach(function (s, idx) {
          if (idx > 0) {
            var estTransitionInitiale = (idx === 1 && !segments[0].valeur && segments[0].texte.length > 15);
            var largeurEspace = _largeurEspaceExplicitePdf(taille, estTransitionInitiale);
            curX += largeurEspace * (segments[idx - 1].espacesApres + s.espacesAvant);
          }
          doc.setFont('helvetica', s.valeur ? 'bold' : 'normal');
          doc.setFontSize(taille);
          var col = s.valeur ? couleurValeur : couleurNormale;
          doc.setTextColor(col[0], col[1], col[2]);
          if (s.texte !== '') doc.text(s.texte, curX, yy);
          curX += doc.getTextWidth(s.texte);
        });
      }
      // Rendu adaptatif (une seule ligne) : mêmes tailles/fallback que
      // l'ancien mécanisme de gras complet. La décision « tient sur une
      // ligne » utilise la largeur RÉELLE segmentée (mélange normal/bold
      // + espaces numériques explicites), jamais une mesure uniforme en
      // police normale qui sous-estimerait la largeur réelle une fois
      // les valeurs effectivement dessinées en gras.
      function _dessinerLigneValeursCarteV(texte, x, yy, largeurMax, tailleActuelle, tailleAgrandie, couleurNormale, couleurValeur) {
        var segments = _segmenterValeursCarteV(texte);
        var tailleChoisie = (_largeurSegmentsValeursCarteV(segments, tailleAgrandie) <= largeurMax) ? tailleAgrandie : tailleActuelle;
        _dessinerSegmentsValeursCarteV(segments, x, yy, tailleChoisie, couleurNormale, couleurValeur);
        return tailleChoisie;
      }
      // Léger espacement (Objectif 2) : UNE SEULE FOIS entre deux
      // opérations différentes, jamais entre les lignes d'une même
      // opération multiligne (ajouté à la fin de chaque bloc d'opération
      // complet, jamais à l'intérieur d'une boucle de lignes).
      var ESPACE_MICRO_OPERATIONS = 2.6;

      // V50.17 — équilibre les retours à la ligne des longues opérations :
      // évite qu'une heure, une date ou un fragment très court reste seul
      // sur la dernière ligne. Présentation uniquement, texte inchangé.
      function _reequilibrerLignesOperationV(lignes) {
        if (!lignes || lignes.length < 2) return lignes;
        var out = lignes.slice();
        for (var i = out.length - 1; i > 0; i--) {
          var motsDerniere = String(out[i]).trim().split(/\s+/);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10.8);
          var largeurDerniere = doc.getTextWidth(String(out[i]).trim());
          if (motsDerniere.length <= 2 || largeurDerniere < Math.min(48, wColVOp * 0.34)) {
            var precedent = String(out[i - 1]).trim().split(/\s+/);
            while (precedent.length > 3 && (motsDerniere.length <= 3 || doc.getTextWidth(motsDerniere.join(' ')) < Math.min(55, wColVOp * 0.40))) {
              motsDerniere.unshift(precedent.pop());
            }
            out[i - 1] = precedent.join(' ');
            out[i] = motsDerniere.join(' ');
          }
        }
        return out;
      }

      function _dessinerLigneCombineeV(texte) {
        if (!texte) return;
        // La décision « tient sur une seule ligne » est prise de façon
        // identique sur la passe de mesure (dess=false) et la passe de
        // dessin (dess=true), afin que `cur` avance EXACTEMENT pareil
        // dans les deux cas — jamais de désynchronisation de hauteur.
        // G.6 — CORRECTIF (Objectif 12) : mesure de la largeur RÉELLE
        // segmentée (mélange normal/bold), jamais une mesure uniforme en
        // police normale qui sous-estimerait la largeur une fois les
        // valeurs effectivement dessinées en gras. Comparée à wColVOp
        // (largeur réellement disponible après le tiret, cf. déclaration
        // plus haut), jamais wColV qui inclut à tort l'espace du tiret.
        var segmentsPourMesure = _segmenterValeursCarteV(texte);
        // G.14 — taille uniformisée à 9/9.3, identique à la ligne
        // Stockage juste plus bas : Prise en charge/Livraison/
        // Restitution étaient auparavant à 8.5/8.8, une différence
        // intentionnelle mais ancienne (V50.4H) devenue trop visible
        // avec la mise en valeur des dates/heures en gras. Toutes les
        // lignes opérationnelles des cartes véhicules partagent
        // désormais exactement la même taille.
        var tientSurUneLigne = _largeurSegmentsValeursCarteV(segmentsPourMesure, 10.4) <= wColVOp;

        if (tientSurUneLigne) {
          if (dess) {
            _dessinerTiretOperationPdf(xG, cur);
            _dessinerLigneValeursCarteV(texte, xTexteOp, cur, wColVOp, 10.4, 10.4, [82, 86, 90], ANTHRACITE);
          }
          cur += 5.0 + ESPACE_MICRO_OPERATIONS; // interligne inchangé + léger espace avant l'operation suivante
          return;
        }

        // Adresse exceptionnellement longue (tenait déjà sur plusieurs
        // lignes à la taille actuelle) : comportement d'origine
        // STRICTEMENT conservé (aucun agrandissement, même mécanisme de
        // retour à la ligne, même interligne 4.2 entre les lignes de
        // CETTE MÊME opération). Un seul tiret, devant la PREMIÈRE ligne
        // uniquement (Objectif 1) — les lignes de continuation démarrent
        // au X DU TEXTE (xTexteOp), jamais sous le tiret (Objectif 3).
        // Dates/heures/durée mises en valeur sur CHAQUE ligne où elles
        // apparaissent (Objectif 4/CAS D).
        var lignes = doc.splitTextToSize(_preCasserMotsLongsPdf(doc, texte, wColVOp, 10.4, 'normal'), wColVOp).slice(0, 3);
        lignes = _reequilibrerLignesOperationV(lignes);
        if (dess) {
          _dessinerTiretOperationPdf(xG, cur);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10.4);
          lignes.forEach(function (ligne, idx) {
            _dessinerSegmentsValeursCarteV(_segmenterValeursCarteV(ligne), xTexteOp, cur + idx * 5.0, 10.4, [82, 86, 90], ANTHRACITE);
          });
        }
        cur += lignes.length * 5.0 + ESPACE_MICRO_OPERATIONS; // léger espace uniquement APRÈS toute l'opération
      }

      if (_aStockage(c)) {
        // CORRECTIF V50.5G.1 — la V50.5G avait correctement supprimé la
        // fausse mention « Dépôt au stockage par le client » du bloc
        // dossier global en multi individuel, mais le commentaire V50.4H
        // ci-dessous documentait une décision devenue incorrecte : « plus
        // de ligne Prise en charge redondante, quel que soit qui a
        // effectué ce dépôt ». Si le client dépose réellement, c'est
        // juste — la ligne Stockage suffit. MAIS si HelixCar va chercher
        // le véhicule avant stockage, cette opération réelle disparaissait
        // alors totalement de la carte. Corrigé : la vraie prise en
        // charge s'affiche désormais AVANT la ligne Stockage — réutilise
        // exactement adrDepartEff/datePcEff/horairePcEff déjà calculés
        // plus haut (mono : dossier ; multi : CE véhicule précis), donc
        // déjà mono/multi-aware et jamais inventés (null si le client
        // dépose, auquel cas cette ligne ne s'affiche simplement pas).
        // Même présentation exacte que les autres lignes opérationnelles
        // (_ligneOperationVCombinee + _dessinerLigneCombineeV), phrase
        // française complète ("à"/"entre...et"), jamais le format compact
        // du bloc TRAJET.
        if (datePcEff) {
          _dessinerLigneCombineeV(_ligneOperationVCombinee('Prise en charge', adrDepartEff, datePcEff, horairePcEff));
        }
        // V50.4B — Objectif 1 : source correcte selon mono/multi. Les deux
        // textes restent structurellement exclusifs : soit une livraison
        // HelixCar existe et on l'affiche, soit c'est le client qui
        // récupère — jamais les deux, jamais aucun.
        var _livAppliqueeV = _monoPdf ? _livDossierApplicablePdf : (v.date_livraison || null);
        if (_livAppliqueeV) {
          // V50.4J — Objectif 7/13 : Livraison combinée (adresse + date +
          // heure/créneau) en une seule ligne — plus de « Date de
          // livraison » séparée.
          _dessinerLigneCombineeV(_ligneOperationVCombinee('Livraison', adrArriveeEff, _livAppliqueeV, horaireLivEff));
        // V50.4H — Objectifs 8/9/10/11/12/14/15 : AVEC STOCKAGE, l'information
        // « Stockage pris en compte : début → fin (durée) » représente à
        // elle seule la phase d'entrée (que ce soit HelixCar qui achemine
        // ou le client qui dépose) — plus de ligne « Prise en charge »
        // redondante avec elle, quel que soit qui a effectué ce dépôt.
        // AUCUN calcul modifié : _finStockageEffectiveDossier()/
        // _finStockageEffectiveVehiculeDash()/_joursEntreDatesDash() sont
        // les mêmes fonctions déjà validées, seule la présentation change.
        var _debutStockV = c.stockage_date_debut;
        var _finEffV = _monoPdf ? _finStockageEffectiveDossier(c) : _finStockageEffectiveVehiculeDash(c, v);
        var _jEffV = _joursEntreDatesDash(_debutStockV, _finEffV);
        if (_debutStockV && _finEffV) {
          // V50.4I — Objectifs E/F : formulation naturelle, sans flèche.
          // AUCUN calcul modifié : _debutStockV = c.stockage_date_debut
          // (source inchangée), _finEffV = _finStockageEffectiveDossier()/
          // _finStockageEffectiveVehiculeDash() (déjà validées), _jEffV =
          // _joursEntreDatesDash() (déjà validée) — seule la phrase change.
          var texteStockV = 'Stockage : ' + _dvDate(_debutStockV) + ' au ' + _dvDate(_finEffV) +
            (_jEffV > 0 ? ' (' + _jEffV + (_jEffV > 1 ? ' jours)' : ' jour)') : '');
          var _segmentsStockV = _segmenterValeursCarteV(texteStockV);
          var _stockTientSurUneLigne = _largeurSegmentsValeursCarteV(_segmentsStockV, 10.4) <= wColVOp;
          if (_stockTientSurUneLigne) {
            if (dess) {
              _dessinerTiretOperationPdf(xG, cur);
              _dessinerLigneValeursCarteV(texteStockV, xTexteOp, cur, wColVOp, 10.4, 10.4, [82, 86, 90], ANTHRACITE);
            }
            cur += 5.0 + ESPACE_MICRO_OPERATIONS;
          } else {
            // Cas exceptionnel (tenait déjà sur 2 lignes à la taille
            // actuelle) : comportement d'origine strictement conservé.
            // Un seul tiret, devant la première ligne uniquement.
            var aStockV = doc.splitTextToSize(_preCasserMotsLongsPdf(doc, texteStockV, wColVOp, 10.4, 'normal'), wColVOp).slice(0, 2);
            if (dess) {
              _dessinerTiretOperationPdf(xG, cur);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(10.4);
              aStockV.forEach(function (ligne, idx) {
                _dessinerSegmentsValeursCarteV(_segmenterValeursCarteV(ligne), xTexteOp, cur + idx * 5.0, 10.4, [82, 86, 90], ANTHRACITE);
              });
            }
            cur += aStockV.length * 5.0 + ESPACE_MICRO_OPERATIONS;
          }
        }


          if (_modeLigneV) {
            if (dess) {
              // G.6 — style G.4 STRICTEMENT préservé (bold, gris
              // 95/100/105, taille adaptative 8.5/8.8) : cette ligne ne
              // contient ni date, ni heure, ni durée, elle ne subit donc
              // aucun traitement de mise en valeur segmentée. Seuls le
              // positionnement du tiret et du texte changent (Objectif 13).
              doc.setFont('helvetica', 'normal'); doc.setFontSize(10.4);
              doc.setTextColor(82, 86, 90);
              _dessinerTiretOperationPdf(xG, cur);
              T(_modeLigneV, xTexteOp, cur);
            }
            cur += 5.8 + ESPACE_MICRO_OPERATIONS;
          }
        } else {
        // V50.4H — Objectifs 8/9/10/11/12/14/15 : AVEC STOCKAGE, l'information
        // « Stockage pris en compte : début → fin (durée) » représente à
        // elle seule la phase d'entrée (que ce soit HelixCar qui achemine
        // ou le client qui dépose) — plus de ligne « Prise en charge »
        // redondante avec elle, quel que soit qui a effectué ce dépôt.
        // AUCUN calcul modifié : _finStockageEffectiveDossier()/
        // _finStockageEffectiveVehiculeDash()/_joursEntreDatesDash() sont
        // les mêmes fonctions déjà validées, seule la présentation change.
        var _debutStockV = c.stockage_date_debut;
        var _finEffV = _monoPdf ? _finStockageEffectiveDossier(c) : _finStockageEffectiveVehiculeDash(c, v);
        var _jEffV = _joursEntreDatesDash(_debutStockV, _finEffV);
        if (_debutStockV && _finEffV) {
          // V50.4I — Objectifs E/F : formulation naturelle, sans flèche.
          // AUCUN calcul modifié : _debutStockV = c.stockage_date_debut
          // (source inchangée), _finEffV = _finStockageEffectiveDossier()/
          // _finStockageEffectiveVehiculeDash() (déjà validées), _jEffV =
          // _joursEntreDatesDash() (déjà validée) — seule la phrase change.
          var texteStockV = 'Stockage : ' + _dvDate(_debutStockV) + ' au ' + _dvDate(_finEffV) +
            (_jEffV > 0 ? ' (' + _jEffV + (_jEffV > 1 ? ' jours)' : ' jour)') : '');
          var _segmentsStockV = _segmenterValeursCarteV(texteStockV);
          var _stockTientSurUneLigne = _largeurSegmentsValeursCarteV(_segmentsStockV, 10.4) <= wColVOp;
          if (_stockTientSurUneLigne) {
            if (dess) {
              _dessinerTiretOperationPdf(xG, cur);
              _dessinerLigneValeursCarteV(texteStockV, xTexteOp, cur, wColVOp, 10.4, 10.4, [82, 86, 90], ANTHRACITE);
            }
            cur += 5.0 + ESPACE_MICRO_OPERATIONS;
          } else {
            // Cas exceptionnel (tenait déjà sur 2 lignes à la taille
            // actuelle) : comportement d'origine strictement conservé.
            // Un seul tiret, devant la première ligne uniquement.
            var aStockV = doc.splitTextToSize(_preCasserMotsLongsPdf(doc, texteStockV, wColVOp, 10.4, 'normal'), wColVOp).slice(0, 2);
            if (dess) {
              _dessinerTiretOperationPdf(xG, cur);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(10.4);
              aStockV.forEach(function (ligne, idx) {
                _dessinerSegmentsValeursCarteV(_segmenterValeursCarteV(ligne), xTexteOp, cur + idx * 5.0, 10.4, [82, 86, 90], ANTHRACITE);
              });
            }
            cur += aStockV.length * 5.0 + ESPACE_MICRO_OPERATIONS;
          }
        }

          // Objectif 12/15 : récupération client — formulation déjà
          // correcte, conservée telle quelle. Pas de « Livraison : — ».
          // V50.5D.3I — Objectif 1 : heure de récupération ajoutée quand
          // elle existe. Mono : champ dossier stockage_heure_sortie déjà
          // existant, jamais dupliqué (aucun mélange mono/multi). Multi :
          // champ propre à CE véhicule (heure_recuperation_client),
          // jamais celle d'un autre véhicule. Anciennes demandes sans
          // cette donnée : _heureRecupV est alors vide, le texte reste
          // strictement celui d'avant, sans planter.
          // Réutilise _dessinerLigneCombineeV (même style visuel exact
          // que la ligne "Récupération..." précédente : helvetica normal
          // 8.5, gris 95/100/105) pour un habillage sûr si le texte
          // devient plus long, plutôt qu'un T() non protégé contre un
          // éventuel débordement de colonne.
          var _heureRecupV = _monoPdf ? c.stockage_heure_sortie : v.heure_recuperation_client;
          var _texteRecupV = 'Récupération du véhicule par le client' +
            (_heureRecupV ? (' ' + _phraseHoraireFr(_heureRecupV)) : '');
          _dessinerLigneCombineeV(_texteRecupV);
        }
      } else {
        // V50.4J — Objectifs 6/7/14 : SANS STOCKAGE, Prise en charge et
        // Livraison combinées (adresse + date + heure/créneau) chacune en
        // une seule ligne — plus de « Date de prise en charge »/« Date de
        // livraison »/« Horaire » séparées dans la carte véhicule (le
        // grand bloc TRAJET en haut du devis, lui, reste inchangé —
        // Objectif 15).
        _dessinerLigneCombineeV(_ligneOperationVCombinee('Prise en charge', adrDepartEff, datePcEff, horairePcEff));
        var dateLivEff = _monoPdf ? c.date_livraison : v.date_livraison;
        _dessinerLigneCombineeV(_ligneOperationVCombinee('Livraison', adrArriveeEff, dateLivEff, horaireLivEff));
        if (_modeLigneV) {
          if (dess) {
            // G.6 — style G.4 STRICTEMENT préservé, voir occurrence 1.
            doc.setFont('helvetica', 'normal'); doc.setFontSize(10.4);
            doc.setTextColor(82, 86, 90);
            _dessinerTiretOperationPdf(xG, cur);
            T(_modeLigneV, xTexteOp, cur);
          }
          cur += 5.8 + ESPACE_MICRO_OPERATIONS;
        }
      }

      if (v.restitution_concernee) {
        // V50.15 — la sous-section restitution respire comme une vraie sous-zone :
        // espace avant le repère rouge puis espace net avant la ligne Restitution.
        cur += 2.8;
        if (dess) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
          doc.setTextColor(ROUGE[0], ROUGE[1], ROUGE[2]);
          T('RESTITUTION PRÉVUE', xG, cur);
        }
        cur += 6.8;
        // V50.4J — Objectifs 8/9 : adresse + date + heure/créneau combinées
        // en une seule ligne « Restitution : ... », EXACTEMENT la même
        // police/taille/graisse/logique de retour à la ligne que Prise en
        // charge/Livraison/transport ci-dessus (_dessinerLigneCombineeV
        // partagée) — seul « RESTITUTION PRÉVUE » ci-dessus reste en
        // rouge/gras comme repère de sous-section. Aucune heure inventée :
        // omise si absente (Objectif 8, « si aucune heure... »).
        var adrRestitV = _adresseCompleteOuVille(v.restit_adresse_rue, v.restit_code_postal, v.restit_ville);
        var dateRestitV = _monoPdf ? c.date_restitution : v.restit_date;
        var horaireRestitV = _phraseHoraireFr(_monoPdf ? _horaireDossier(c, 'restit') : _horaireVehicule(v, 'restit'));
        _dessinerLigneCombineeV(_ligneOperationVCombinee('Restitution', adrRestitV, dateRestitV, horaireRestitV));
      }
      return cur - y0 + 3.5 + (_etirementCartePdf * 0.42);
    };

    // V50.33 — PAGINATION ADAPTATIVE SUBTILE : on garde les espacements normaux et on n’ajoute qu’une respiration légère quand un bloc suivant ne tient pas.
    // 1) on remplit chaque page avec le maximum de cartes ENTIÈRES ;
    // 2) si la carte suivante ne peut vraiment pas tenir, l'espace restant est
    //    redistribué dans les cartes déjà présentes (respiration avant opérations
    //    + bas de carte) et dans les gouttières entre cartes ;
    // 3) aucune carte n'est coupée et les pages ne finissent plus brutalement avec
    //    un grand désert blanc. Cette logique s'applique à tous les devis multi.
    var _hauteursCartesBase = vhPdf.map(function (v, i) {
      _etirementCartePdf = 0;
      return _dessinerCarteVehicule(v, i, false);
    });
    var _idxCarte = 0;
    while (_idxCarte < vhPdf.length) {
      var _basPageCarte = _pdfMultiRespiration ? BAS_PAGE_CARTE_MULTI : BAS_PAGE;
      var _titreSurCettePage = (_idxCarte === 0);
      var _hTitrePlan = _titreSurCettePage ? HAUTEUR_TITRE_SECTION : 0;

      // Si même la première carte ne tient pas ici, elle commence sur une page neuve.
      if (y + _hTitrePlan + _hauteursCartesBase[_idxCarte] > _basPageCarte) {
        doc.addPage();
        y = M;
      }

      var _yPlan = y + (_titreSurCettePage ? HAUTEUR_TITRE_SECTION : 0);
      var _finLot = _idxCarte;
      while (_finLot < vhPdf.length) {
        var _hCandidate = _hauteursCartesBase[_finLot];
        var _ajoutGap = (_finLot > _idxCarte) ? ESPACE_SECTION : 0;
        if (_yPlan + _ajoutGap + _hCandidate > _basPageCarte) break;
        _yPlan += _ajoutGap + _hCandidate;
        _finLot++;
      }
      // Filet de sécurité : au moins une carte par page.
      if (_finLot === _idxCarte) _finLot = _idxCarte + 1;

      var _nbCartesPage = _finLot - _idxCarte;
      var _resteUneCarte = _finLot < vhPdf.length;
      var _basPlanNormal = y + (_titreSurCettePage ? HAUTEUR_TITRE_SECTION : 0);
      for (var _kPlan = _idxCarte; _kPlan < _finLot; _kPlan++) {
        if (_kPlan > _idxCarte) _basPlanNormal += ESPACE_SECTION;
        _basPlanNormal += _hauteursCartesBase[_kPlan];
      }
      var _videDisponible = _resteUneCarte ? Math.max(0, _basPageCarte - _basPlanNormal) : 0;
      // V50.33 — respiration volontairement SUBTILE : on ne cherche plus à remplir
      // artificiellement toute la page. Les cartes gardent presque exactement leur
      // rythme validé ; on ajoute au maximum 3 mm par carte et 1.5 mm par gouttière.
      // Si le prochain véhicule ne tient pas, il passe page suivante sans déformer
      // la page courante.
      var _stretchParCarte = _resteUneCarte ? Math.min(3.0, _videDisponible / Math.max(1, _nbCartesPage)) : 0;
      var _resteApresStretch = Math.max(0, _videDisponible - (_stretchParCarte * _nbCartesPage));
      var _nbGouttieres = _nbCartesPage; // après le titre/avant V1 + avant les suivantes
      var _gouttiereExtra = _resteUneCarte ? Math.min(1.5, _resteApresStretch / Math.max(1, _nbGouttieres)) : 0;

      if (_titreSurCettePage) sectionTitre(titreVeh);

      for (var _k = _idxCarte; _k < _finLot; _k++) {
        y += _gouttiereExtra;
        _etirementCartePdf = _stretchParCarte;
        var v = vhPdf[_k];
        var h = _dessinerCarteVehicule(v, _k, false);
        var y0 = y;
        doc.setFillColor(GRIS_CARTE[0], GRIS_CARTE[1], GRIS_CARTE[2]);
        doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'F');
        doc.setFillColor(ROUGE[0], ROUGE[1], ROUGE[2]);
        doc.rect(M, y0, 1.3, h, 'F');
        y = y0;
        _dessinerCarteVehicule(v, _k, true);
        y = y0 + h;
        if (_k < _finLot - 1) y += ESPACE_SECTION;
      }
      _etirementCartePdf = 0;
      _idxCarte = _finLot;
      if (_idxCarte < vhPdf.length) {
        doc.addPage();
        y = M;
      } else {
        y += ESPACE_SECTION;
      }
    }

    /* V50.32 ancien forEach conservé ci-dessous sous forme de commentaire pour audit :
    vhPdf.forEach(function (v, i) {
      var h = _dessinerCarteVehicule(v, i, false);
      // Le titre de section n'accompagne que la PREMIÈRE carte dans la
      // décision de pagination (Objectif 2 : jamais de titre seul en bas
      // de page) ; les cartes suivantes se paginent chacune pour elles-mêmes.
      var hTitreEventuel = (i === 0) ? HAUTEUR_TITRE_SECTION : 0;
      // V50.12 — pagination adaptative : en multi, une carte peut descendre plus bas sur
      // une page intermédiaire (jusqu'à BAS_PAGE_CARTE_MULTI) puisqu'aucun pied de page
      // final n'y est encore dessiné. On conserve la hauteur réelle de la carte et tous
      // les espacements premium : aucune compression, aucune coupure.
      var _basPageCarte = _pdfMultiRespiration ? BAS_PAGE_CARTE_MULTI : BAS_PAGE;
      if (y + hTitreEventuel + h > _basPageCarte) { doc.addPage(); y = M; }
      if (i === 0) sectionTitre(titreVeh);
      var y0 = y;
      // V50.7 — reproduction exacte de la référence : fond passé de
      // l'ancien IVOIRE beige au GRIS_CARTE premium (cohérent avec le
      // reste du document), ajout du contour subtil. La barre rouge
      // (1.2mm) est CONSERVÉE : c'est la seule carte du document qui en
      // affiche une dans la référence fournie. Géométrie identique
      // (M, y0, LARGEUR, h) — hauteur mesurée et pagination inchangées.
      doc.setFillColor(GRIS_CARTE[0], GRIS_CARTE[1], GRIS_CARTE[2]);
      doc.roundedRect(M, y0, LARGEUR, h, 2, 2, 'F');
      // V50.13 — finition premium : pas de contour gris autour des cartes
      // véhicules. Le fond très léger + la barre rouge suffisent à structurer
      // la carte et évitent les traits parasites visibles sur les PDF multi.
      doc.setFillColor(ROUGE[0], ROUGE[1], ROUGE[2]);
      doc.rect(M, y0, 1.3, h, 'F');
      y = y0;
      _dessinerCarteVehicule(v, i, true);
      y = y0 + h;
      y += ESPACE_SECTION;
    });
    */
  }

  // ══ PRESTATIONS ══
  // Chaque prestation réellement assurée apparaît. Le convoyage vers le
  // stockage disparaissait auparavant du devis.
  var prestations = [];
  // Services sur site : la prestation est celle que le client a
  // RÉELLEMENT demandée — jamais une formulation ajoutée d'office.
  if (_estDemandeNettoyage(c)) {
    var _ndPrest = _nettDetails(c) || {};
    var _libNettPrest = NETT_LIB_TYPE[_ndPrest.type_nettoyage];
    if (_libNettPrest) prestations.push(_libNettPrest);
  } else if (_estDemandeProfessionnel(c)) {
    var _pdPrest = _proPrestationTexte(_proDetails(c));
    if (_pdPrest) prestations.push(_pdPrest);
  } else if (_aStockage(c)) {
    if (_operationDossier(c, 'pc')) prestations.push('Convoyage vers le stockage');
    prestations.push('Stockage automobile');
    if (_operationDossier(c, 'liv')) prestations.push('Livraison après stockage');
  } else if (_aConvoyage(c)) {
    prestations.push('Convoyage automobile');
  }
  if (c.plateau === 'Oui') prestations.push('Transport sur plateau');
  if (c.urgence === 'Oui') prestations.push('Transport prioritaire / urgent');
  if (aRestit) prestations.push('Restitution du véhicule');

  // V50.4D — Objectif 3 : PRESTATIONS passe par sectionAvecBloc comme les
  // autres sections — elle ne peut donc plus jamais être perdue ou
  // dessinée hors-page parce que les véhicules précédents ont consommé
  // toute la hauteur restante : si elle ne tient pas, une page est ajoutée
  // AVANT de la dessiner, exactement comme pour chaque carte véhicule.
  // V50.29 — pagination globale intelligente de fin de document.
  // PRESTATIONS + TARIF sont considérés comme un paquet final : si les deux
  // peuvent tenir proprement dans la hauteur physique disponible, on les garde
  // sur la page en cours au lieu de pousser PRESTATIONS (puis le tarif) sur une
  // page 2 avec un grand vide sur la page 1. Cette règle s'applique à TOUS les
  // devis (mono/multi) et ne compresse ni les cartes véhicule ni leur typographie.
  function _contenuPrestationsPdf(dess) {
    var y0 = y, cur = y0 + 7.0;
    var deuxCol = prestations.length > 2;
    var parCol = deuxCol ? Math.ceil(prestations.length / 2) : prestations.length;
    prestations.forEach(function (p, i) {
      var col = (deuxCol && i >= parCol) ? 1 : 0;
      var rang = (deuxCol && i >= parCol) ? i - parCol : i;
      var yy = cur + rang * 6.2;
      var x = xG + col * (LARGEUR / 2);
      if (dess) {
        doc.setFillColor(ROUGE[0], ROUGE[1], ROUGE[2]);
        doc.circle(x + 1, yy - 1.1, 1, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.4);
        doc.setTextColor(ANTHRACITE[0], ANTHRACITE[1], ANTHRACITE[2]);
        T(p, x + 5, yy);
      }
    });
    cur += parCol * 6.2;
    return cur - y0;
  }

  var _hPrestFinal = _contenuPrestationsPdf(false);
  var _espaceTarifMiniFinal = 1.5;
  var _hauteurTarifFinal = 18;
  var _margeTarifFinal = 2;
  var _limitePhysiqueFinale = 291;
  var _espacePrestations = _espaceAvantTitre(prestations.length === 1 ? 'Prestation' : 'Prestations');
  var _besoinPaquetFinal = (_espacePrestations + 7.2) + _hPrestFinal + _espaceTarifMiniFinal + _hauteurTarifFinal + _margeTarifFinal;

  if (y + _besoinPaquetFinal <= _limitePhysiqueFinale) {
    // Dessin direct sur la page courante : même design que sectionAvecBloc,
    // mais sans son ancien seuil générique à 270 mm trop conservateur pour
    // ce paquet final court.
    y += _espacePrestations;
    sectionTitre(prestations.length === 1 ? 'Prestation' : 'Prestations');
    var _yPrest0 = y;
    doc.setFillColor(GRIS_CARTE[0], GRIS_CARTE[1], GRIS_CARTE[2]);
    doc.roundedRect(M, _yPrest0, LARGEUR, _hPrestFinal, 2, 2, 'F');
    doc.setDrawColor(GRIS_FILET[0], GRIS_FILET[1], GRIS_FILET[2]); doc.setLineWidth(0.15);
    doc.roundedRect(M, _yPrest0, LARGEUR, _hPrestFinal, 2, 2, 'S');
    y = _yPrest0; _contenuPrestationsPdf(true); y = _yPrest0 + _hPrestFinal;
  } else {
    // V50.35 — PRESTATIONS + TARIF restent toujours solidaires.
    // Si le paquet final complet ne tient pas sur la page courante, on ne
    // laisse jamais TARIF PROPOSÉ seul sur la page suivante : on démarre
    // directement une nouvelle page AVANT PRESTATIONS. Aucun autre bloc,
    // espacement, style ou contenu du devis n'est modifié.
    doc.addPage();
    y = M;
    y += _espacePrestations;
    sectionTitre(prestations.length === 1 ? 'Prestation' : 'Prestations');
    var _yPrestNouvellePage = y;
    doc.setFillColor(GRIS_CARTE[0], GRIS_CARTE[1], GRIS_CARTE[2]);
    doc.roundedRect(M, _yPrestNouvellePage, LARGEUR, _hPrestFinal, 2, 2, 'F');
    doc.setDrawColor(GRIS_FILET[0], GRIS_FILET[1], GRIS_FILET[2]); doc.setLineWidth(0.15);
    doc.roundedRect(M, _yPrestNouvellePage, LARGEUR, _hPrestFinal, 2, 2, 'S');
    y = _yPrestNouvellePage; _contenuPrestationsPdf(true); y = _yPrestNouvellePage + _hPrestFinal;
  }
  // V50.27 — mémorise la fin réelle du bloc PRESTATIONS avant la respiration
  // vers le tarif. Si le bandeau TARIF serait seul sur une nouvelle page pour
  // seulement quelques millimètres, on réduit UNIQUEMENT cette respiration
  // (jamais le contenu, les cartes ni la typographie) tout en conservant au
  // minimum 3 mm d'air entre PRESTATIONS et TARIF PROPOSÉ.
  var yFinPrestations = y;
  y += ESPACE_AVANT_PRESTATIONS;

  // ══ MONTANT ══
  // V50.4G — Objectif 8 : règle explicite plutôt qu'un seuil magique isolé.
  // V50.5H.1 — CAUSE EXACTE de la page 2 inutile : ce bloc réutilisait
  // BAS_PAGE (270mm), une constante partagée calibrée pour la pagination
  // des CARTES VÉHICULES — lesquelles ont besoin d'une marge basse
  // confortable car elles sont hautes et ne doivent jamais être coupées.
  // Or la limite physique réelle de ce dernier bloc est bien plus basse :
  // le trait de séparation du pied de page se dessine à yPied-5, soit
  // ~279mm (yPied = max(y+9, 284-...)). Le montant renonçait donc à 9mm
  // d'espace parfaitement utilisable et basculait en page 2 dès que
  // Prestations se terminait au-delà de 247mm, alors qu'il tenait
  // physiquement jusqu'à 258mm — une fenêtre de 11mm de bascules
  // inutiles, exactement le cas observé en QA.
  //
  // Corrigé avec une limite PROPRE à ce bloc (BAS_PAGE_MONTANT), calée
  // sur sa contrainte physique réelle et conservant une marge de
  // sécurité de 2mm sous le bloc avant le trait du pied de page.
  // BAS_PAGE reste STRICTEMENT INCHANGÉE : la pagination des cartes
  // véhicules n'est en rien affectée (une carte qui ne tient pas part
  // toujours intégralement page suivante).
  // V50.11 — en mono, les espacements amont sont légèrement resserrés sans
  // toucher aux cartes ni à la typographie afin de garder le tarif sur la page 1
  // quand il tient proprement. En multi, aucune compression : 2 pages propres
  // sont préférées à une page tassée.
  var hauteurMontant = 18;
  var margeMontant = 2;
  var BAS_PAGE_MONTANT = 291; // seuil physique conservé
  // V50.27 — pagination tarif intelligente : avant de créer une page 2
  // contenant seulement le tarif, on tente de récupérer l'espace vertical
  // superflu placé APRÈS Prestations. La respiration standard reste inchangée
  // dans tous les cas où elle tient ; elle n'est ramenée à 3 mm que si cela
  // suffit à conserver proprement le tarif sur la page courante.
  if (y + hauteurMontant + margeMontant > BAS_PAGE_MONTANT) {
    var yTarifCompact = yFinPrestations + 1.5; // V50.28 — dernier recours propre pour éviter une page 2 contenant uniquement le tarif
    if (yTarifCompact + hauteurMontant + margeMontant <= BAS_PAGE_MONTANT) {
      y = yTarifCompact;
    } else {
      doc.addPage();
      y = M;
    }
  }
  doc.setFillColor(26, 26, 26);
  doc.roundedRect(M, y, LARGEUR, 18, 1.5, 1.5, 'F');
  // ══ V50.6 PREMIUM ══ Petit accent rouge vertical à gauche du bandeau,
  // écho de celui des titres de section et des cartes : conclusion
  // visuelle forte et cohérente. Dessiné À L'INTÉRIEUR du bandeau
  // existant — HAUTEUR (21mm), position, largeur et logique de
  // pagination H.1 STRICTEMENT INCHANGÉES.
  doc.setFillColor(ROUGE[0], ROUGE[1], ROUGE[2]);
  doc.rect(M, y, 1.6, 18, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  // V50.5H.2 — libellé UNIQUE en mono ET en multi (la variation
  // « MONTANT TOTAL DE LA PRESTATION » est supprimée). La variable
  // `_nbV` qui servait uniquement à choisir entre les deux libellés
  // devient inutile et est donc retirée avec eux — elle n'était
  // utilisée nulle part ailleurs (vérifié).
  T('TARIF PROPOSÉ', M + 9, y + 11.2);
  doc.setFont('helvetica', 'bold');
  // V50.5H.2 — prix en BLANC franc (auparavant ROUGE). La constante
  // ROUGE elle-même n'est PAS modifiée : tous les autres accents rouges
  // HelixCar (titres, traits, tirets, puces) restent inchangés.
  doc.setTextColor(255, 255, 255);
  if (d.prix === null || d.prix === undefined || d.prix === '') {
    // Aperçu avant saisie du prix : aucun montant inventé.
    doc.setFontSize(11);
    T('MONTANT À RENSEIGNER', L - 8, y + 11.2, { align: 'right' });
  } else {
    // V50.5H.2 — taille réduite de 20 à 17.5 (-12.5%, dans la fourchette
    // 10-15% demandée). Reste en gras, aligné à droite au même X (L - 8)
    // et au même Y (y + 13.8) — aucun déplacement, aucun ajustement
    // vertical n'a été nécessaire. Reste 1.67x plus grand que le libellé
    // (10.5), la hiérarchie visuelle est donc préservée.
    doc.setFontSize(14.5);
    T(_formaterMontantEuros(d.prix), L - 8, y + 11.2, { align: 'right' });
  }
  y += 18;

  // ══ PIED DE PAGE — inchangé ══
  var lignesPied = [];
  if (HELIXCAR_MENTIONS_LEGALES && HELIXCAR_MENTIONS_LEGALES.length) {
    lignesPied = lignesPied.concat(HELIXCAR_MENTIONS_LEGALES);
  }
  if (HELIXCAR_MENTION_TVA) lignesPied.push(HELIXCAR_MENTION_TVA);
  lignesPied = lignesPied.slice(0, 3);

  var yPied = Math.max(y + 9, 284 - (lignesPied.length - 1) * 3.4);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.0); // V50.25 — pied de page réellement lisible
  doc.setTextColor(145, 145, 145); // reste volontairement discret
  lignesPied.forEach(function (l, i) { T(l, M, yPied + i * 3.4); });
  T('HelixCar - Services automobiles France & Europe', L, yPied, { align: 'right' });

  // V50.37 — pagination discrète en bas à droite et automatique sur toutes les pages.
  // Le compteur est ajouté après génération complète afin de connaître
  // le nombre réel de pages : 1 / 2, 2 / 2, 1 / 3, etc.
  var _nbPagesPdf = doc.getNumberOfPages();
  for (var _pPdf = 1; _pPdf <= _nbPagesPdf; _pPdf++) {
    doc.setPage(_pPdf);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(155, 155, 155);
    T(String(_pPdf) + ' / ' + String(_nbPagesPdf), L - 2, 291.5, { align: 'right' });
  }

  return doc;
}
return _construirePdfDevis(dossier, devis);
}
