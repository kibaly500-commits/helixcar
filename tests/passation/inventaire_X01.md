# X01 — Sources fictives, faux succès, anciennes pages (dashboard.html, index.html, edl.html, fiche-mission.html, lettre-voiture.html, helixcar-emails.html, creer-compte-convoyeur.html, helixcar-cgv-client.html, helixcar-contrat-convoyeur.html, devis.html) + L02 — ordre des sections de la vitrine index.html + outils QA admin (Tester PREPARE). Branche : claude/helixcar-expert-review-p0-p1-qcawh6. Lecture seule, aucun fichier modifié.

## [A_CORRIGER] X01-001 bandeau « Page de démonstration » — page admin Demandes recontact
- fichier: /home/user/helixcar/dashboard.html — lignes: 1267-1324 (bandeau 1268 ; select décoratif 1273-1280 ; lignes 1293-1319 ; bouton Archiver 1317)
- état: Page id=page-admin-recontact entièrement codée en dur : 3 lignes fictives (Jean Dupont 06 11 22 33 44 j.dupont@email.com ; Marie Lambert ; Farid Alami), filtre <select> sans id ni onchange, bouton « Archiver » sans handler. Or une VRAIE table Supabase `recontacts` existe et est alimentée par la vitrine (index.html submitRecontact l.18523-18549 → supabaseInsert('recontacts')) et lue par l'archivage (dashboard l.4614, 5186, texteFicheRecontact l.5291). Menu NAVS admin l.2551, PAGE_TITLES l.3506.
- détail: Source fictive à retirer (ou à brancher sur `recontacts`). Test t_nettoyage_dashboard E/Demandes recontact exige aujourd'hui la bannière sur cette page.

## [A_CORRIGER] X01-001 bandeau « Page de démonstration » — page admin Challenge mensuel
- fichier: /home/user/helixcar/dashboard.html — lignes: 1365-1450 (bandeau 1366 ; alerte « 3 convoyeurs à récompenser » 1369-1377 ; select 1382-1384 ; classement 1390-1432 ; historique 1438-1447)
- état: Classement « Mai 2024 » codé en dur (Antoine Arcelin CNV-0001 3 280 km 150 €, Jean Pellerin, Sara Bouali, Karim Benali), historique Avril/Mars 2024 « Versé ». Bouton « Attribuer les récompenses et notifier » → envoyerRecompenses() l.7743-7748 = alert honnête « pas encore connecté ». Select mois décoratif.
- détail: Page 100 % fictive. Retirer la page, l'entrée NAVS l.2553 et PAGE_TITLES l.3508. Test E/Challenge mensuel à adapter.

## [A_CORRIGER] X01-001 bandeau « Page de démonstration » — page admin Pannes
- fichier: /home/user/helixcar/dashboard.html — lignes: 1452-1488 (bandeau 1453 ; « Exemple : 1 panne active » 1454-1456 ; card-sub 1458 ; lignes 1462-1484)
- état: Tableau codé en dur HC-2024-0531 Sara Bouali Marseille→Nice « ✅ SMS + Email » et HC-2024-0518 Antoine Arcelin. Le sous-titre « Mis à jour en temps réel par les convoyeurs » est faux (aucune source). Le texte « Exemple : 1 panne active » est un texte de démonstration, pas un texte métier.
- détail: Source fictive à retirer intégralement (NAVS l.2554, PAGE_TITLES l.3509). Mot « exemple » ici = démo, à retirer avec la page.

## [A_CORRIGER] X01-001 bandeau « Page de démonstration » — page admin Notations
- fichier: /home/user/helixcar/dashboard.html — lignes: 1490-1596 (bandeau 1491 ; alerte info 1492 ; fiches 1500-1573 ; table « Dernières évaluations » 1577-1590)
- état: 4 convoyeurs inventés avec barres de notes (Antoine Arcelin 17.2, Jean Pellerin 13.8, Sara Bouali 11.4, Nadia Ouali 8.2). La fiche Nadia (l.1557-1565) affiche « BLOQUÉ DÉFINITIVEMENT … Compte bloqué automatiquement. Email envoyé le 20/05/2024 », en contradiction directe avec l'alerte l.1492 « Aucune note ne bloque personne automatiquement ». Boutons « Historique » → openNotationAdmin() l.7990-7995 = alert honnête. Table des évaluations codée en dur.
- détail: Source fictive et message contradictoire. Retirer (NAVS l.2555, PAGE_TITLES : pas d'entrée pour admin-notations). Test E/Notations à adapter.

## [A_CORRIGER] X01-001/003 bandeau + faux succès — page client Évaluer (notation)
- fichier: /home/user/helixcar/dashboard.html — lignes: 1670-1760 (bandeau 1671 ; sous-titre 1674 ; formulaire 1678-1748 ; écran succès 1750-1755) ; soumettreNotation 7972-7988 ; NAVS badge 2573 ; PAGE_TITLES 3524
- état: Sous-titre codé en dur « Mission : Paris → Lyon · Antoine Arcelin · 29/05/2024 ». soumettreNotation() masque le formulaire et affiche « ✅ Évaluation envoyée ! Merci pour votre retour » SANS aucun appel serveur (aucune table, aucun fetch) = faux succès. Badge menu « badge: 1 » (l.2573) et sous-titre « 1 mission en attente d'évaluation » (l.3524) = faux compteur permanent.
- détail: Dépend du lot D01 (évaluations réelles). À minima : retirer le faux succès, le badge 1 et le sous-titre fixe.

## [A_CORRIGER] X01-003 faux succès — page admin Paramètres & RIB
- fichier: /home/user/helixcar/dashboard.html — lignes: 1762-1819 (alerte 1763 ; RIB 1765-1773 ; notifications 1775-1783 ; retenue 1785-1802 ; SMS 1804-1816)
- état: Trois boutons affichent un succès sans rien faire : « Enregistrer le RIB » → alert('RIB enregistré de manière sécurisée ✓') l.1773 (inputs sans id, rien n'est persisté ; l'alerte l.1763 affirme pourtant « enregistrées pour vous ») ; « Envoyer la notification » → alert('Notification envoyée à tous les convoyeurs actifs ✓') l.1783 (OneSignal non branché) ; « Enregistrer la configuration » SMS → alert('Configuration SMS enregistrée ✓') l.1816. Selects décoratifs l.1781, 1788. Seule la retenue (envoyerPenalite l.7857-7867) est honnête.
- détail: Trois faux succès explicites ; NAVS l.2557, PAGE_TITLES l.3510. Test D1 (t_nettoyage_dashboard) couvre uniquement envoyerPenalite.

## [A_CORRIGER] X01-002/003 page convoyeur Signaler une panne (sans bandeau)
- fichier: /home/user/helixcar/dashboard.html — lignes: 1878-1898 (alerte 1880 ; select mission 1885 ; bouton 1895) ; PAGE_TITLES 3512
- état: Alerte « Le client sera prévenu automatiquement par SMS et email » (faux, aucun service SMS n'existe) ; select avec mission fictive « HC-2024-0531 · Marseille → Nice (en cours) » ; sous-titre de page « Prévenez le client automatiquement ». Le bouton lui-même est honnête (alert « pas encore connecté »). Aucune bannière « Page de démonstration » : le test B12 ne la détecte pas (aucun nom inventé).
- détail: Promesse SMS/email non tenue + donnée fictive dans un select. NAVS convoyeur l.2564.

## [A_CORRIGER] X01-002 faux compteurs — page convoyeur Ma notation (sans bandeau)
- fichier: /home/user/helixcar/dashboard.html — lignes: 1900-1946 (note 17.2 « Excellent » 1908-1909 ; barres 1913-1918 ; table avis 1929-1941)
- état: Note globale, six barres et trois « derniers avis reçus » (Paris → Lyon 18/20 « Parfait, très ponctuel »…) codés en dur pour TOUT convoyeur connecté. Aucune bannière, non détecté par B12/B13 (trajets seulement, pas de nom complet).
- détail: Faux compteur trompeur pour un vrai partenaire connecté. NAVS l.2565, PAGE_TITLES l.3517.

## [A_CORRIGER] X01-001 bandeau — page convoyeur Récompenses
- fichier: /home/user/helixcar/dashboard.html — lignes: 1970-2011 (bandeau 1971 ; éligibilité 1974-1975 ; podium 1976-1994 ; fidélité 1997-2008)
- état: « Challenge mensuel — Mai 2024 », « Vous êtes 2ème avec 3 840 km », podium Jean Pellerin / Vous / Sara Bouali, « Vos km : 11 280 km », « Palier 4 atteint » — tout codé en dur.
- détail: NAVS l.2566, PAGE_TITLES l.3518. Le challenge n'existe pas côté serveur.

## [A_CORRIGER] X01-002 faux compteurs — page client Tableau de bord (bandeau partiel)
- fichier: /home/user/helixcar/dashboard.html — lignes: 2013-2085 (réel : 2014-2031 ; stats 2033-2038 ; carte mission 2040-2053 avec bandeau 2042 ; fidélité 2056-2067)
- état: Partie réelle : « Faire une nouvelle demande » (ouvrirNouvelleDemande) et « Mes demandes » (#client-demandes-liste). Partie fictive : stats-row sans id « 8 missions / 3 840 km / P.2 / 1 mission en cours » placée AVANT le bandeau (qui n'est que dans la carte « Mission en cours »), « Exemple de suivi : véhicule en route, Paris → Lyon », BMW 320d · AB-123-CD, « Suivi en temps réel disponible via l'application mobile HelixCar » (aucune app), barre fidélité 1 280 km / 51 %.
- détail: Tests t_client.js et t_demande_integree.js utilisent page-client-dashboard (partie réelle uniquement). « Exemple de suivi » = texte de démo à retirer.

## [A_CORRIGER] X01-002/004 données fictives + bouton sans action — page client Mes missions (sans bandeau)
- fichier: /home/user/helixcar/dashboard.html — lignes: 2106-2126 (bouton 2109 ; table 2112-2121)
- état: Bouton « + Nouvelle mission » → alert('Redirection vers le formulaire de devis HelixCar') : aucune redirection (alors que ouvrirNouvelleDemande() existe, l.2022). Table de 4 missions inventées (BMW 320d Antoine A., Tesla Model 3 Jean P., Mercedes GLC Sara B., Peugeot 308 Jean P.) sans tbody id, jamais alimentée par JS. Aucune bannière ; B12 ne détecte pas les noms abrégés.
- détail: NAVS l.2571, PAGE_TITLES l.3522, mbnGo mobile l.7883 mappe missions/history → client-missions.

## [A_CORRIGER] X01-002 faux compteurs — page client Fidélité (sans bandeau)
- fichier: /home/user/helixcar/dashboard.html — lignes: 2137-2180
- état: « Km parcourus : 1 280 km », barre 51 %, « 1 220 km restants », paliers 1 000 / 2 500 / 5 000 / 10 000 / 20 000 km codés en dur, sans aucune lecture serveur.
- détail: Dépend du lot L01 (registre fidélité serveur, paliers 2k→10k puis +2k). NAVS l.2574, PAGE_TITLES l.3525.

## [A_CORRIGER] X01-002/004 données fictives + bouton sans action — page client Mon profil
- fichier: /home/user/helixcar/dashboard.html — lignes: 2182-2195 (inputs 2186-2190 ; bouton 2192)
- état: Champs value="Marc" / "Dupont" / "m.dupont@email.com" / "06 12 34 56 78" / "Particulier" codés en dur, jamais remplis par le compte réel ; bouton « Sauvegarder les modifications » sans onclick.
- détail: NAVS l.2575, PAGE_TITLES l.3526. Le prénom réel est pourtant connu (PAGE_TITLES client-dashboard écrasé l.2880).

## [A_CORRIGER] X01-002/004/005 — page convoyeur Mon profil : bandeau statique, bouton sans action, liens vers pages absentes
- fichier: /home/user/helixcar/dashboard.html — lignes: 2197-2237 (alerte 2200 ; bouton 2216 ; documents 2218-2236 ; liens 2226 et 2233)
- état: Champs réels (profil-prenom… remplis par JS) mais alerte statique « ✅ Compte validé par HelixCar — Certifié Convoyeur d'Excellence » affichée à tout partenaire ; bouton « Sauvegarder » sans onclick ; bloc « Mes documents de mission » codé en dur (« Mission HC-2024-0529 Paris → Lyon ») avec liens vers helixcar-lettre-voiture.html et helixcar-lettre-voiture-restit.html, fichiers ABSENTS du dépôt (jamais présents dans git log) → 404.
- détail: La vraie lettre de voiture s'ouvre via ouvrirLettreVoiture() l.12777 → lettre-voiture.html?mission=.

## [A_CORRIGER] X01-004/005 — code mort et liens cassés : modale « Mission acceptée » et acceptMission/openMissionDetail
- fichier: /home/user/helixcar/dashboard.html — lignes: 2308-2337 (modale mission 2308-2322 ; modale acceptée 2325-2337, href 2333, texte 2330) ; openMissionDetail 7692-7702 ; acceptMission 7704-7722 (code 7706, href 7719)
- état: acceptMission() fixe un code en dur 'HC-2024-0529', affiche « Un email de confirmation avec la fiche mission complète vous a été envoyé » sans rien envoyer et pointe #edl-link vers helixcar-edl.html (absent). openMissionDetail() n'a aucun appelant ; acceptMission() n'est appelé que depuis le bouton l.2320 de la modale #modal-mission, elle-même non ouverte par le flux réel. Le flux réel est accepterMission() l.6878-6890 (PATCH puis alert) + allerVersEdl() l.7008 → edl.html.
- détail: Supprimer les deux fonctions et les deux modales, ou corriger le lien vers edl.html.

## [A_CORRIGER] X01-004 bouton sans action — cloche de notifications de la topbar
- fichier: /home/user/helixcar/dashboard.html — lignes: 1061 (CSS 262-275)
- état: <button class="notif-btn">🔔<span class="notif-dot"> sans handler ; le point rouge est affiché en permanence = faux indicateur pour les trois rôles.
- détail: 

## [A_CORRIGER] X01-002 titres par défaut fictifs « Bienvenue Antoine » / « Bienvenue Marc »
- fichier: /home/user/helixcar/dashboard.html — lignes: 3514, 3520 (écrasés à la connexion l.2694 et l.2880)
- état: Valeurs par défaut fictives dans PAGE_TITLES, remplacées par le vrai prénom après connexion. Visibles seulement si showPage est appelé avant le chargement du profil.
- détail: Mineur : remplacer par « Bienvenue » neutre.

## [DEJA_CONFORME] X01-003 note honnête dans la fiche partenaire (à mettre à jour)
- fichier: /home/user/helixcar/dashboard.html — lignes: 6091
- état: « Pénalités & récompenses : pas encore connectées à de vraies données (pages Pannes/Notations/Challenge toujours fictives). » — texte honnête qui deviendra faux une fois les pages retirées.
- détail: À reformuler dans le même lot que la suppression des pages.

## [DEJA_CONFORME] X01-003 succès réels vérifiés (à conserver)
- fichier: /home/user/helixcar/dashboard.html — lignes: 6878-6890 accepterMission ; 7545-7572 genererFactureConvoyeur ; 12284-12327 envoyerDevis
- état: Les trois alertes « ✅ Mission acceptée », « ✅ Facture … générée », « ✓ Devis … envoyé » sont émises dans le .then() d'un appel serveur réussi (PATCH missions, POST factures_convoyeur, PREPARE + send_email confirmé côté serveur).
- détail: 

## [NON_APPLICABLE] X01-001 mentions « démo / fictif / maquette / exemple » restantes dans le code (commentaires et placeholders)
- fichier: /home/user/helixcar/dashboard.html — lignes: 992, 2536-2543, 3684, 6360, 6602, 7839, 8350, 9069, 9536-9538, 9819, 10405, 10470, 10548 (commentaires) ; placeholders 1790, 1801, 1890, 8941 ; index.html 7709 (placeholder vous@exemple.com), 19965 (commentaire)
- état: Uniquement des commentaires JS (documentant des suppressions passées : table USERS démo, session démo helixcar_demo_email, VIN fictifs) ou des placeholders de saisie (« Ex : 450 », « vous@exemple.com »). Rien n'est affiché comme donnée.
- détail: Textes métier/placeholders à conserver ; les placeholders l.1790/1801/1890 disparaissent avec leurs pages.

## [DEJA_CONFORME] X01-001 « exemple » dans la vitrine — textes métier à conserver
- fichier: /home/user/helixcar/index.html — lignes: 5532, 5544, 5556, 5568 (pricing-example « Ex : Paris → Chartres / Lyon / Marseille / Nice »)
- état: Exemples de trajets illustrant les tranches tarifaires de la section #devis « Tarifs convoyage ». Texte métier réel.
- détail: 

## [INCERTAIN] X01-002 témoignages inventés sur la vitrine
- fichier: /home/user/helixcar/index.html — lignes: 5920-5974 (section id=avis, cartes 5930-5970)
- état: 4 témoignages signés « Antoine A. », « Marie L. », « Sébastien M. », « Karim B. » — trois noms recoupent la liste NOMS_INVENTES du test (Antoine Arcelin, Marie Lambert, Karim Benali). Aucune source réelle.
- détail: Décision métier : témoignages réels à substituer ou section à retirer. Aucun test ne couvre cette section.

## [INCERTAIN] X01-002 faux compteurs marketing dans le hero
- fichier: /home/user/helixcar/index.html — lignes: 5177-5195 (hero2-panel-stats : « 7j/7 », « 100 % Sécurisé », « 98 % Satisfaction client », « EU ») ; panneau « Mission type » 5071-5175 (Paris → Lyon 463 km, 14 jours, 2 heures)
- état: « 98 % Satisfaction client » est un chiffre sans source. Le panneau Paris → Lyon est explicitement étiqueté « Mission type » (illustration assumée, switcher hero2ChangeScenario l.16498).
- détail: Le panneau illustratif est conforme ; le 98 % est à arbitrer (retirer ou sourcer).

## [A_CORRIGER] X01-002 / L01 — frise fidélité de la vitrine : valeurs statiques et incohérentes
- fichier: /home/user/helixcar/index.html — lignes: 5607 (loyalty-bar width:28%) ; nœuds 5613-5691 : node-km 1 000 / 3 000 / 7 000 / 15 000 / 30 000 km vs tooltips « Palier 2 — 2 500 km », « Palier 3 — 5 000 km », « Palier 4 — 10 000 km », « Entreprises — 20 000 km »
- état: Illustration statique (classes done/active codées en dur). Les kilométrages affichés sous les nœuds ne correspondent pas aux paliers annoncés dans les infobulles, ni aux paliers du dashboard (1 000/2 500/5 000/10 000/20 000), ni à la cible L01 (2k→10k puis +2k).
- détail: Cohérence à traiter avec L01 ; aucun test ne couvre cette frise.

## [INCERTAIN] X01-002 incohérence « Challenge Trimestriel » vs « Challenge mensuel »
- fichier: /home/user/helixcar/index.html — lignes: 5866-5868 (section #convoyeurs « Challenge Trimestriel », podium 150/100/50 €) vs 5778-5782 (#info-rewards « chaque mois ») et dashboard.html 2553/2566 (« Challenge mensuel »)
- état: La vitrine annonce un challenge trimestriel dans la section « Devenez convoyeur » et un challenge mensuel dans l'encart « Fidélité & Challenge mensuel » ; le dashboard parle de challenge mensuel. Aucun challenge n'existe côté serveur.
- détail: Arbitrage métier requis (ou retrait de la promesse tant qu'aucun challenge n'est implémenté).

## [A_CORRIGER] X01-004 liens sans cible dans le footer de la vitrine
- fichier: /home/user/helixcar/index.html — lignes: 6255-6263 (Convoyage standard, Véhicules de luxe, Gestion de parc, Stockage, Nettoyage), 6277 (Blog), 6287 (Formulaire contact), 6289 (Mentions légales), 6291 (Politique de confidentialité)
- état: Neuf liens href="#" sans onclick : cliquer remonte en haut de page. « Stockage » pourrait pointer vers #stockage-automobile ; Mentions légales / Politique de confidentialité n'existent pas.
- détail: 

## [A_CORRIGER] X01-003 faux succès potentiel — formulaire « Être recontacté »
- fichier: /home/user/helixcar/index.html — lignes: 18523-18570 (insert 18541-18549 ; affichage succès 18552-18553 ; EmailJS 18556-18569 ; console.log données personnelles 18535)
- état: supabaseInsert('recontacts') est lancé sans await ni catch (.then(console.log) seulement) et l'écran recontact-success s'affiche immédiatement : en cas d'échec d'insertion, l'utilisateur voit quand même un succès. Un e-mail EmailJS de confirmation part en parallèle. console.log('RC submit:', prenom, nom, tel, email…) journalise des données personnelles.
- détail: 

## [BLOQUE] X01-003 faux succès — écran de fin de l'état des lieux
- fichier: /home/user/helixcar/edl.html — lignes: 829-836 (« 📧 Rapport envoyé automatiquement à HelixCar et au client », « 📱 SMS de confirmation envoyé au client ») ; 1352, 1359 (« SMS envoyé au client pour confirmer l'arrivée / la restitution ») ; envoyerEmailClientEdl 979-1010
- état: L'enregistrement (POST etats_des_lieux l.1302, PATCH missions l.1334) est réel. Mais aucun SMS n'est envoyé nulle part (aucun service SMS dans le dépôt) et l'e-mail EmailJS ne part qu'au client (pas « à HelixCar »), sans attendre le résultat.
- détail: Bloqué par tests/t_nonreg.js E6b (l.285-289) qui interdit toute modification d'edl.html tant que le périmètre n'est pas élargi.

## [DEJA_CONFORME] X01-005 rôle réel — edl.html
- fichier: /home/user/helixcar/edl.html — lignes: 6 (titre), 895-930 (Supabase), 966-1000 (session convoyeur), 1090-1110 (?mission=&phase=), 1286-1365 (enregistrement)
- état: État des lieux réel (photos → Storage bucket edl, INSERT etats_des_lieux, PATCH statut mission par phase depart/arrivee/restitution_*). Accessible uniquement via dashboard allerVersEdl() l.7008 (« edl.html?mission=REF&phase=… »). Renvoie vers lettre-voiture.html (l.842) et dashboard.html (l.843). Pas de lien depuis index.html.
- détail: Page métier réelle à conserver ; seuls les liens cassés helixcar-edl.html (dashboard l.2333, 7719) sont à corriger.

## [DEJA_CONFORME] X01-005 rôle réel — fiche-mission.html
- fichier: /home/user/helixcar/fiche-mission.html — lignes: 6, 61-63, 137-208
- état: Fiche mission imprimable, réelle : exige une session Supabase convoyeur (l.149-160), lit missions?reference=eq. et clients, refuse l'accès sinon. Liée uniquement par l'e-mail de confirmation envoyé par dashboard.html l.6924 (« /fiche-mission.html?mission=REF »). Le code « HC-2026-XXXX » l.63 est un placeholder remplacé au chargement.
- détail: 

## [INCERTAIN] X01-005 rôle réel — lettre-voiture.html
- fichier: /home/user/helixcar/lettre-voiture.html — lignes: 70-150 (gabarit vide), 154-222 (PDF html2pdf) ; appelants dashboard.html 12777 et edl.html 842
- état: Gabarit de lettre de voiture vierge (tous les champs f-nom-conv, f-reference… sont vides) avec bouton PDF/impression. Le paramètre ?mission=REF transmis par le dashboard et l'EDL n'est jamais lu (aucun URLSearchParams, aucun appel Supabase) : le document imprimé est toujours vide.
- détail: Page utilisée par le flux réel mais non préremplie ; à confirmer si c'est voulu (remplissage manuel) ou un manque. Hors périmètre t_nonreg E6b.

## [BLOQUE] X01-005/006 ancienne page — helixcar-emails.html
- fichier: /home/user/helixcar/helixcar-emails.html — lignes: 6 (titre « Aperçu des emails »), 66-84 (onglets), 87-660 (maquettes avec Antoine Arcelin, Marc Dupont, HC-2024-0529, AB-123-CD, l.595 « Pénalité client - radar exemple »)
- état: Catalogue statique de maquettes d'e-mails avec données fictives, 0 appel réseau, aucun lien entrant depuis index.html ni dashboard.html (page orpheline). Le mot « exemple » l.595 est un commentaire HTML de maquette.
- détail: Candidate à suppression (lot E01 inventaire e-mails), mais tests/t_nonreg.js l.341-347 lit ce fichier via readFileSync (plantage si supprimé) et E6b interdit de le toucher.

## [A_CORRIGER] X01-003/006 ancienne page — helixcar-cgv-client.html (faux succès)
- fichier: /home/user/helixcar/helixcar-cgv-client.html — lignes: 205 (bouton signCGV), 211-221 (écran « CGV acceptées ! … Un email de confirmation vous a été envoyé »), 264-274 (signCGV)
- état: signCGV() génère une référence locale 'CGV-CLI-'+Date.now() et affiche le succès sans aucun appel réseau : rien n'est enregistré, aucun e-mail. Page orpheline (aucun lien entrant dans le dépôt).
- détail: Supprimer ou marquer clairement comme document à imprimer. Fichier absent du PERIMETRE de t_nonreg E6 (l.251-263) → sa modification/suppression fera échouer E6 tant que la liste n'est pas mise à jour.

## [A_CORRIGER] X01-003/006 ancienne page — helixcar-contrat-convoyeur.html (faux succès)
- fichier: /home/user/helixcar/helixcar-contrat-convoyeur.html — lignes: 244 (bouton), 250-261 (« Contrat signé ! … Un email de confirmation vous a été envoyé avec une copie »), 313-328 (signContrat)
- état: Même mécanisme : référence 'CTR-CONV-'+Date.now(), succès affiché sans réseau. Page orpheline.
- détail: Même contrainte t_nonreg E6 que la page CGV.

## [DEJA_CONFORME] X01-005 rôle réel — creer-compte-convoyeur.html
- fichier: /home/user/helixcar/creer-compte-convoyeur.html — lignes: 6, 92-94, 168-170 (vérif convoyeur validé), 256-259 (signUp Supabase, redirect dashboard.html), 279-284 (succès après signUp)
- état: Inscription réelle du partenaire validé : vérifie le dossier `convoyeurs`, appelle sb.auth.signUp, affiche le succès après réponse. Liée par l'e-mail de validation (dashboard.html l.6131). Couverte par t_mdp_ui.js et t_roles.js.
- détail: 

## [DEJA_CONFORME] X01-005 rôle réel — devis.html
- fichier: /home/user/helixcar/devis.html — lignes: 6, 309-324 (Edge Function devis-secure, token), 379-430 (modales accepter/refuser)
- état: Page client réelle de consultation/acceptation/refus du devis par token (Edge Function devis-secure). Atteinte via e-mail et via le bouton QA (dashboard l.12222-12224). Hors périmètre t_nonreg E6b.
- détail: 

## [A_CORRIGER] X01-005 pages référencées mais absentes du dépôt
- fichier: /home/user/helixcar/dashboard.html — lignes: 2226 (helixcar-lettre-voiture.html), 2233 (helixcar-lettre-voiture-restit.html), 2333 et 7719 (helixcar-edl.html)
- état: Les trois fichiers n'existent pas (ls + git log --all vides). index.html l.16718 mentionne confirmation-adresse.html : il s'agit de supabase/templates/confirmation-adresse.html (présent), en commentaire uniquement.
- détail: 

## [DEJA_CONFORME] X01-005 liens réels index.html ↔ dashboard.html
- fichier: /home/user/helixcar/index.html — lignes: 16885 (location.href='dashboard.html' après connexion) ; 8122-8124 et 16550-16553 (URL dashboard pour redirections Supabase) ; dashboard.html 3071/3115 (index.html?nouvelle-demande=1, ?completer=), 12223 (devis.html?token=), 6924 (fiche-mission.html), 6131 (creer-compte-convoyeur.html), 7008 (edl.html), 12777 (lettre-voiture.html)
- état: index.html ne pointe que vers dashboard.html. dashboard.html pointe vers index.html (nouvelle demande / compléter), edl.html, lettre-voiture.html, fiche-mission.html (par e-mail), creer-compte-convoyeur.html (par e-mail), devis.html (bouton QA). Aucune page ne lie helixcar-emails.html, helixcar-cgv-client.html, helixcar-contrat-convoyeur.html.
- détail: Inventaire des accès : 3 pages orphelines identifiées.

## [INCERTAIN] L02 — ordre actuel des sections de la vitrine (desktop)
- fichier: /home/user/helixcar/index.html — lignes: 5005-5033 nav ; 5039 #accueil ; 5203 #info-convoyage (expand) ; 5241 slogan-band ; 5332 #services ; 5407 #renfort-ponctuel ; 5467 #stockage-automobile ; 5522 #devis (tag « Tarifs convoyage ») ; 5593 #fidelite (tag « Programme de fidélité convoyage ») ; 5766 #info-rewards (expand) ; 5796 #convoyeurs (h2 « Devenez convoyeur HelixCar ») ; 5920 #avis ; 5976 #faq ; 6111 #recontact ; 6235 footer#contact
- état: Ordre DOM des quatre blocs visés : Stockage automobile (5467) → Tarif convoyage (5522) → Programme de fidélité (5593) → Devenez convoyeur (5796). Menu principal (l.5015-5025) : Services #services, Devis #devis, Fidélité #fidelite, Partenaires #convoyeurs, FAQ #faq, Être recontacté #recontact — aucune entrée pour Stockage ni Renfort. Footer : « Programme fidélité » → #fidelite (l.6275), « Stockage » → # (l.6261). CTA pricing href="#contact" → footer id=contact (l.6235).
- détail: Aucune spécification L02 de l'ordre cible dans le dépôt (RECETTE-*.md ne mentionnent pas L02) : état actuel documenté, cible à confirmer.

## [DEJA_CONFORME] L02 — ordre mobile
- fichier: /home/user/helixcar/index.html — lignes: 3235-3260 (@media max-width:900px : .nav-links display:none l.3241, section padding 56px 20px) ; 882-886 (.stockage-inner 1 colonne) ; aucune règle CSS `order:` ni `display:none` sur une section
- état: Sur mobile le menu textuel est masqué (pas de burger ; seul le bouton Connexion reste) ; aucune règle ne réordonne ni ne masque de section : l'ordre mobile est strictement l'ordre DOM desktop. Stockage passe en une colonne (texte puis frise).
- détail: Un déplacement de section dans le DOM s'appliquera identiquement sur mobile.

## [DEJA_CONFORME] L02 — animations liées aux sections à déplacer
- fichier: /home/user/helixcar/index.html — lignes: 3211-3229 (.reveal / .hidden-init / .in-view) ; 18576-18592 (IntersectionObserver threshold 0.08 sur tous les .reveal au chargement) ; 842-886 (stockage : .stockage-block.in-view .stockage-steps-line-fill + .stockage-step délais .1/.45/.8 s) ; 800-830 (renfort : .renfort-block.in-view .renfort-card, .renfort-flow-line-fill) ; 5523-5525, 5527, 5581 (#devis : reveal sur tag/h2/sub/grid/note) ; 5595-5601 (#fidelite : reveal sur tag/h2/sub/track) ; 5802, 5860 (#convoyeurs : reveal sur convoyeur-text / convoyeur-challenge) ; 592-599 (slogan scrollLoop) ; 3537-3558 (hero2)
- état: Les sections #renfort-ponctuel et #stockage-automobile portent elles-mêmes la classe reveal (l.5407, 5467) : leurs animations internes (frise, cartes) dépendent de l'ajout de in-view sur la section. Pour #devis, #fidelite et #convoyeurs, reveal est porté par les éléments internes. L'observer est enregistré une fois au chargement via querySelectorAll('.reveal') : un déplacement DOM conserve le comportement tant que les classes sont conservées. prefers-reduced-motion géré (l.877-880).
- détail: Risque limité : conserver les classes reveal/stockage-block/renfort-block et les ids d'ancre.

## [A_CORRIGER] Outils de test admin — bouton « 🧪 Tester PREPARE (QA) »
- fichier: /home/user/helixcar/dashboard.html — lignes: 8934-8936 (rendu du bouton, fiche demande de devis admin, affiché dès qu'un devis existe, y compris statut accepté/refusé) ; 12172-12229 (testerPrepareDevisQA) ; 12040-12115 (prepareDevisSecure) ; 12222-12224 (redirection de l'onglet admin vers devis.html?token=) ; 12795 (allowlist HC_ACTIONS) ; 12241-12242 (commentaire : allowlist serveur ['genere','envoye'] conservée « pour d'autres usages (QA, renvoi futur) »)
- état: Bouton visible en production pour tout admin. Il génère réellement le PDF, appelle l'action `prepare` de l'Edge Function devis-secure (création réelle d'un token + stockage du PDF, invalidant le token précédent, cf. l.12348-12349), puis redirige l'onglet admin vers la page client devis.html avec le token. Il ne change pas le statut et n'envoie pas d'e-mail. Aucun test ne le couvre (grep tests : 0 occurrence). Journaux console « PREPARE diagnostic » l.12059-12070 (longueur PDF, id) en production.
- détail: Outil interne exposé en prod avec effet de bord serveur ; à retirer ou à conditionner (flag/environnement, lot « configuration par environnement »). Retirer aussi son nom de l'allowlist l.12795 pour éviter console.error « Action déclarée mais introuvable ».

## [DEJA_CONFORME] Outils de test admin — autres
- fichier: /home/user/helixcar/dashboard.html — lignes: grep 🧪 / « mode test » / « test interne » / sandbox / btn-test : uniquement 8934-8936 et 12172
- état: Aucun autre bouton de test ou de diagnostic dans l'interface admin. Les occurrences « diagnostic » l.4303/8071 sont un métier de nettoyage/mécanique, pas un outil.
- détail: 

## [DEJA_CONFORME] X01 — bypass démo (déjà traité)
- fichier: /home/user/helixcar/dashboard.html — lignes: 985-1000 (masquagePrecoceLoginScreen), 2536-2543 (table USERS supprimée)
- état: La clé localStorage helixcar_demo_email n'ouvre plus l'interface et est effacée ; table de comptes démo retirée. Vérifié par t_nettoyage_dashboard A1-A5 et RECETTE-LOT.md §5.7 (l.701-706).
- détail: 

## Fonctions clés
- NAVS (table des menus par rôle) — /home/user/helixcar/dashboard.html:2544 — Déclare les entrées de menu admin/convoyeur/client, dont les pages fictives (admin-recontact, admin-challenge, admin-pannes, admin-notations, admin-parametres, convoyeur-panne, convoyeur-notation, convoyeur-recompenses, client-missions, client-notation badge:1, client-fidelite, client-profil).
- PAGE_TITLES — /home/user/helixcar/dashboard.html:3499 — Titres/sous-titres par page ; contient « Bienvenue Antoine/Marc », « 1 mission en attente d'évaluation », « Prévenez le client automatiquement ».
- buildNav — /home/user/helixcar/dashboard.html:3468 — Construit le menu latéral à partir de NAVS (badges inclus).
- showPage — /home/user/helixcar/dashboard.html:3529 — Affiche une page .page par id et applique PAGE_TITLES ; revérifie la session partenaire.
- mbnGo — /home/user/helixcar/dashboard.html:7869 — Navigation mobile basse ; mappe home/missions/history/profil vers les ids de page (l.7883 : client → client-missions).
- envoyerRecompenses — /home/user/helixcar/dashboard.html:7743 — Bouton du challenge admin : alert honnête « pas encore connecté ».
- envoyerPenalite — /home/user/helixcar/dashboard.html:7857 — Retenue admin : alert honnête, rien d'enregistré (test D1).
- setNote / updateNotePreview / soumettreNotation — /home/user/helixcar/dashboard.html:7943 — Notation client : calcule la note en local puis affiche « Évaluation envoyée ! » sans appel serveur (faux succès, l.7972-7988).
- openNotationAdmin — /home/user/helixcar/dashboard.html:7990 — Historique des évaluations : alert honnête « pas encore connectées ».
- openMissionDetail / acceptMission — /home/user/helixcar/dashboard.html:7692 — Code mort : modale mission fictive, code HC-2024-0529 en dur, lien vers helixcar-edl.html (absent).
- accepterMission — /home/user/helixcar/dashboard.html:6878 — Acceptation réelle (PATCH missions) puis alert et envoi de la fiche mission par e-mail.
- allerVersEdl — /home/user/helixcar/dashboard.html:7008 — Ouvre edl.html?mission=REF&phase= (flux réel de l'état des lieux).
- ouvrirLettreVoiture — /home/user/helixcar/dashboard.html:12777 — Ouvre lettre-voiture.html?mission=REF (paramètre ignoré par la page cible).
- testerPrepareDevisQA — /home/user/helixcar/dashboard.html:12176 — Bouton QA admin : génère le PDF, appelle PREPARE (devis-secure) et redirige l'onglet vers devis.html?token=.
- prepareDevisSecure — /home/user/helixcar/dashboard.html:12040 — Appel de l'action prepare de l'Edge Function devis-secure (session admin réelle) ; journalise « PREPARE diagnostic ».
- envoyerDevis — /home/user/helixcar/dashboard.html:12231 — Envoi réel du devis : PREPARE puis envoyerEmailDevisSecure ; le succès n'est affiché qu'après confirmation serveur (l.12327).
- HC_ACTIONS allowlist — /home/user/helixcar/dashboard.html:12785 — Liste des actions autorisées via actionHtml/data-action ; inclut testerPrepareDevisQA ; console.error si une fonction déclarée manque.
- submitRecontact — /home/user/helixcar/index.html:18523 — Formulaire « Être recontacté » : insert Supabase recontacts non attendu, succès affiché immédiatement, e-mail EmailJS.
- revealObserver — /home/user/helixcar/index.html:18576 — IntersectionObserver qui pose in-view sur tous les .reveal (déclenche les animations Stockage/Renfort/Devis/Fidélité/Convoyeurs).
- hero2ChangeScenario — /home/user/helixcar/index.html:16498 — Bascule le panneau illustratif « Mission type » (convoyage/stockage/nettoyage) du hero.
- signCGV — /home/user/helixcar/helixcar-cgv-client.html:264 — Affiche « CGV acceptées ! … email envoyé » sans aucun appel réseau (faux succès).
- signContrat — /home/user/helixcar/helixcar-contrat-convoyeur.html:313 — Affiche « Contrat signé ! … email envoyé » sans aucun appel réseau (faux succès).
- envoyerEmailClientEdl — /home/user/helixcar/edl.html:979 — E-mail EmailJS au client après l'état des lieux ; l'écran de succès annonce en plus un SMS et un rapport à HelixCar qui n'existent pas.

## Tests existants
- /home/user/helixcar/tests/t_nettoyage_dashboard.js — suite principale du domaine : A1-A5 (bypass session démo, table USERS/demo123), B1-B11 (compteurs réels de l'accueil admin), B12 (aucun nom inventé hors page bannière, liste NOMS_INVENTES l.175), B13/B13b (bannière « Page de démonstration » exactement sur les pages fictives, PAGES_REELLES l.215), B14-B16 (MISSIONS/showMission/modal-info-mission supprimés), C1-C7 (base clients réelle, « 47 inscrits » retiré), D1-D8 (promesses e-mail/SMS retirées : envoyerPenalite, openNotationAdmin, voirDocumentsConvoyeur, blocage automatique, signalement incident, page SMS), E (bannière requise sur admin-challenge, admin-pannes, admin-notations, admin-recontact), Z1/Z2 (zéro erreur JS)
- /home/user/helixcar/tests/t_blocage.js — F4 (alerts « Convoyeur bloqué. Email… » supprimées), F6 (boutons démo bloquerConvoyeur('sara')/debloquerConvoyeur('nadia') disparus)
- /home/user/helixcar/tests/t_nonreg.js — E6/E6b/E6c (périmètre de fichiers : PERIMETRE l.251-263 limité à index.html, dashboard.html, creer-compte-convoyeur.html + config/CI/recettes ; E6b interdit devis.html, index.ts, edl.html, fiche-mission.html, lettre-voiture.html, helixcar-emails.html ; E6c plafonne PERIMETRE à 12 entrées) ; l.341-347 lit helixcar-emails.html et devis.html (readFileSync) ; F1/F2 textes index.html
- /home/user/helixcar/tests/t_lots_de.js — F3-3 (aucun véhicule fictif inventé pour un professionnel)
- /home/user/helixcar/tests/t_client.js et /home/user/helixcar/tests/t_demande_integree.js — espace client réel (page-client-dashboard : « Faire une nouvelle demande », liste des demandes)
- /home/user/helixcar/tests/t_durcissement.js, /home/user/helixcar/tests/t_charte.js — utilisent page-admin-dashboard / admin-missions (charte comparée à index.html)
- /home/user/helixcar/tests/t_mission_nettoyage.js — page convoyeur-missions réelle
- /home/user/helixcar/tests/t_mdp_ui.js et /home/user/helixcar/tests/t_roles.js — creer-compte-convoyeur.html
- /home/user/helixcar/tests/t_devis.js, t_devis_commun.js — génération du devis (aucun test du bouton Tester PREPARE (QA) : 0 occurrence de testerPrepareDevisQA/btn-test-qa dans tests/)
- Aucun test ne couvre : l'ordre des sections de la vitrine, les témoignages, le footer, la frise fidélité index.html, les pages convoyeur-notation / client-missions / client-fidelite / client-profil / convoyeur-profil, les pages CGV/contrat, lettre-voiture.html, fiche-mission.html, edl.html (écran de succès)

## Risques
- Suppression des pages fictives admin (challenge, pannes, notations, recontact) : t_nettoyage_dashboard section E (l.296-305) retourne false si document.getElementById('page-'+id) est null → 4 FAIL ; B13/B13b restent verts mais doivent être relus. Les tests doivent évoluer dans le même lot.
- Suppression d'entrées NAVS/PAGE_TITLES : showPage() sur un id absent, mbnGo (l.7883) mappe encore missions/history → client-missions, alerte l.1072/1086 et bouton l.1105 pointent vers des pages réelles (OK) ; vérifier aussi le badge client-notation (l.2573, l.7986 #nav-client-notation).
- t_nonreg E6/E6b (l.277-289) : toute modification d'edl.html, lettre-voiture.html, fiche-mission.html, helixcar-emails.html, devis.html fait échouer E6b ; helixcar-cgv-client.html et helixcar-contrat-convoyeur.html ne sont pas dans PERIMETRE → E6 échoue si on les supprime ; E6c plafonne PERIMETRE à 12 (11 aujourd'hui). La liste doit être élargie explicitement (X01 « anciennes pages »).
- t_nonreg l.341-347 : readFileSync('helixcar-emails.html') et devis.html — supprimer helixcar-emails.html fait PLANTER la suite entière (exception avant la synthèse), pas seulement un contrôle.
- Retrait de testerPrepareDevisQA sans retirer son nom de l'allowlist HC_ACTIONS (l.12795) → console.error au chargement ; côté serveur, le commentaire l.12241-12242 indique que l'allowlist de statuts de actionPrepare est conservée « pour la QA » : à revoir avec le lot Q01.
- Réordonnancement L02 : conserver les ids d'ancre (#devis, #fidelite, #convoyeurs référencés par la nav l.5015-5025 et le footer l.6275) et les classes reveal/stockage-block/renfort-block (animations CSS l.800-886) ; t_charte.js compare la palette calculée à index.html (insensible à l'ordre) ; t_nonreg F1/F2 vérifie des textes d'index.html (insensible à l'ordre). Aucun test ne fige l'ordre : une régression d'ordre passerait inaperçue sans nouveau test.
- Douze suites (RECETTE-LOT.md §5.8) échouent si un seul appel EmailJS part : toute refonte de submitRecontact (index.html l.18556) ou d'edl.html (EmailJS l.1004) doit rester hors de ces scénarios de test ou stubber emailjs.
- Fiche partenaire l.6091 : la phrase « pages Pannes/Notations/Challenge toujours fictives » devient fausse dès que ces pages disparaissent (non testée mais visible par l'admin).
- Cohérence fidélité : les paliers de la vitrine (l.5613-5691), du dashboard client (l.2137-2180) et de la cible L01 (2k→10k puis +2k) divergent ; corriger l'un sans l'autre crée une nouvelle incohérence.
- Remplacer le faux succès de la notation client / du recontact par un vrai attente serveur change l'UX (délai, erreurs) : prévoir les messages d'échec et le stub Supabase des tests (t_client, t_demande_integree utilisent un double fetch /rest/v1/).