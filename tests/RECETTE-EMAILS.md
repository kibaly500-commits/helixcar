# RECETTE E-MAILS — Lot E01 : inventaire honnête des e-mails

Dossier d'inspection, lecture seule. Aucun e-mail n'a été envoyé, aucun
service réel appelé, aucun secret lu ni cherché. Aucun modèle n'a été
fabriqué : ce document dit ce qui existe dans le dépôt, ce qui manque, et
ce qui ne peut pas être vérifié d'ici.

## 1. Périmètre, méthode, ce qui est bloqué

**Révision inspectée** : branche `claude/helixcar-expert-review-p0-p1-qcawh6`,
commit `fed90a7` (« L01 : la carte et la page de fidelite ont des identifiants
distincts »). Tout numéro de ligne ci-dessous se rapporte à cette révision.

**Fichiers inspectés** : `index.html`, `dashboard.html`, `edl.html`, `devis.html`,
`creer-compte-convoyeur.html`, `fiche-mission.html`, `lettre-voiture.html`,
`helixcar-emails.html`, `supabase/functions/devis-secure/index.ts`,
`supabase/functions/candidature-video/index.ts`, `supabase/templates/*`,
`supabase/config.toml`, `migrations/06`, `94`, `106`, `108`, `109`,
`migrations/README.md`, `tests/env.js`, `tests/lib.js`, les suites `tests/t_*`,
`RECETTE-LOT.md`, `RECETTE-STABILISATION-POST-PR2.md`, `vercel (2).json`.

**Méthode** : `grep -n -i "emailjs\|resend\|sendEmail\|send_email\|mail"` sur
les `.html`, `.ts`, `.sql`, `.md`, `.js`, `.mjs`, `.toml`, puis lecture de
chaque point d'appel avec sa fonction englobante, son déclencheur, son
destinataire, ses données et sa journalisation. Les recherches complémentaires
(`signUp`, `resetPasswordForEmail`, `updateUser`, `PASSWORD_RECOVERY`,
`emailRedirectTo`, `mailto:`, `notif`, `pg_cron`, `pg_net`) ont servi à prouver
les absences.

**Règles d'état appliquées** (prompt expert, E01 / C11 / T30) :

| État | Signification exacte dans ce document |
|---|---|
| OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION | Le code appelle réellement un prestataire avec un modèle identifiable ; le déploiement du prestataire et la réception en boîte ne sont pas prouvés. |
| NON VÉRIFIÉ | Un élément (modèle déployé, réglage projet, notification native) existe peut-être hors du dépôt ; rien ici ne permet de trancher. |
| E-MAIL MANQUANT POUR […] | Absence **prouvée par inspection** : aucun appel d'envoi n'existe sur ce déclencheur. |
| BLOQUÉE | La réception réelle est inaccessible dans cet environnement. Vaut pour **tous** les e-mails. |

Rien n'a été déplacé de « non vérifié » vers « absent » ou « opérationnel »
sans preuve dans le code.

**Ce qui est BLOQUÉ ici, et pourquoi** : aucune boîte de recette autorisée,
aucun accès aux tableaux de bord Resend, EmailJS ou Supabase Auth, aucun
secret (`RESEND_API_KEY`, configuration SMTP Supabase, service EmailJS). La
**réception** de chaque e-mail est donc BLOQUÉE. Le **déploiement** des deux
modèles Supabase versionnés (ils se collent à la main dans le tableau de bord
Supabase, `supabase/templates/recuperation-mot-de-passe.html:9-12`) et
l'activation de la confirmation d'adresse (`migrations/README.md:487-494`
demande de « décider explicitement ») sont NON VÉRIFIÉS. Les suites de tests
coupent le réseau (`tests/env.js:81-104`) : elles prouvent qu'aucun e-mail ne
part pendant les tests, pas qu'un e-mail arrive en production.

**Décision C11 rappelée** : préparation, tentative, acceptation prestataire,
échec et réception prouvée se journalisent séparément ; aucun faux statut
« envoyé » en cas d'erreur. Un seul e-mail du produit respecte ce contrat (le
devis, § 2 EM0-003) ; tous les envois EmailJS n'ont **aucune** journalisation.

**Prestataires réellement présents dans le code** :

| Prestataire | Où | Exécution | Journal |
|---|---|---|---|
| EmailJS (bibliothèque `@emailjs/browser@4`) | `index.html:3592-3595`, `dashboard.html:11-16`, `edl.html:9-11` ; un seul service et un seul modèle générique `service_jmckybp` / `template_n26gasf` avec trois variables `email`, `titre`, `message` | **navigateur**, clé publique | aucun (un `console.log` en succès, `console.error` en échec) |
| Resend (API HTTPS) | `supabase/functions/devis-secure/index.ts:480-698` (`actionSendEmail`) | **serveur** (Edge Function, clé `RESEND_API_KEY` lue à `index.ts:855`) | `public.devis_envois` (migration 106) |
| Supabase Auth (e-mails du service d'authentification) | `signUp` (`index.html:16042`, `creer-compte-convoyeur.html:268-272`), `resetPasswordForEmail` (`index.html:16933`, `dashboard.html:3920`) | serveur Supabase, modèles collés dans le tableau de bord | hors dépôt (journal Auth de Supabase, inaccessible ici) |
| Aucun | opportunités (migration 108), fidélité (109), missions, informations manquantes, factures, évaluations | — | 108 : table d'intentions `opportunite_notifications` seulement |

## 2. Tableau principal — un événement EM0 par ligne, sous-lignes si plusieurs e-mails

Légende de la colonne « Journalisation C11 » : P = préparation, T = tentative,
A = acceptation prestataire, É = échec, R = réception prouvée. « aucune »
signifie qu'aucune des cinq étapes n'est écrite nulle part.

| Événement | Destinataire | Déclencheur (fichier:fonction) | Prestataire | Modèle (fichier ou identifiant, ou ABSENT) | Données nécessaires | Journalisation C11 | État | Branchement nécessaire (à faire, non fait) |
|---|---|---|---|---|---|---|---|---|
| **EM0-001a** Création de compte — bienvenue client | Adresse saisie dans le formulaire client | `index.html:15584 _submitClientFormInterne()` → après enregistrement de la demande, bloc `index.html:16377-16398`, `emailjs.send` à `:16388` | EmailJS | `template_n26gasf` (texte composé en dur dans le navigateur, objet « Bienvenue chez HelixCar, {prénom} ! ») | prénom, numéro client, code de parrainage (générés côté navigateur `index.html:15544-15556`) | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION — **contenu faux possible** : l'e-mail affirme « Votre compte vient d'être créé avec succès » sans tester `_compteEtat` (`'non_demande'`, `'existe_deja'`, `'echec'` à `index.html:16035-16074`) ; il part aussi quand aucun compte n'a été demandé | Envoi serveur conditionné à la création Auth réelle ; supprimer l'annonce de compte quand `_compteEtat ≠ 'cree'` ; décider s'il subsiste à côté de la confirmation d'adresse (doublon « bienvenue » + « confirmez », C11/E01) |
| **EM0-001b** Confirmation d'adresse (client) | Titulaire de l'adresse | `index.html:16042 _sb.auth.signUp({email, password})` — sans `emailRedirectTo` : l'URL de retour est le « Site URL » du projet Supabase (hors dépôt) | Supabase Auth « Confirm signup » | `supabase/templates/confirmation-adresse.html` (objet à saisir : « Confirmez votre adresse e-mail HelixCar », variable `{{ .ConfirmationURL }}`) — **déploiement dans Supabase NON VÉRIFIÉ** | adresse, lien de confirmation à usage unique fourni par Supabase | hors dépôt | NON VÉRIFIÉ (modèle présent dans le dépôt ; activation de la confirmation et Site URL non vérifiables ; `migrations/README.md:487-494` laisse la décision ouverte) ; réception BLOQUÉE | Vérifier dans Supabase : confirmation activée ou non, modèle collé, objet, URL de retour autorisée ; l'écran `index.html:16266-16270` promet « un message vient de vous être envoyé » uniquement si `_compteEtat === 'cree'` — cohérent, à revalider en réception |
| **EM0-001c** Confirmation d'adresse (partenaire) | Titulaire de l'adresse | `creer-compte-convoyeur.html:167 creerCompte()` → `sb.auth.signUp` à `:268-272` avec `emailRedirectTo` = origine officielle + `/dashboard.html` | Supabase Auth « Confirm signup » | même modèle que EM0-001b | idem ; rattachement du rôle partenaire à la première session réelle (`:283-285`) | hors dépôt | NON VÉRIFIÉ ; réception BLOQUÉE | Idem EM0-001b ; vérifier que l'origine officielle figure dans les « Redirect URLs » Supabase |
| **EM0-001d** Validation de l'inscription partenaire (« Compte validé ») — événement complémentaire | Adresse du candidat (colonne `convoyeurs.email`) | `dashboard.html:6412 validerConvoyeur(id, name, email)` → après `PATCH convoyeurs statut='actif'`, `emailjs.send` à `:6437` | EmailJS | `template_n26gasf` (objet « ✅ Compte validé — Bienvenue chez HelixCar ! », texte en dur `:6426-6436`) | prénom, lien `creer-compte-convoyeur.html?email=…` (**adresse en paramètre d'URL**), règles de mission | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION ; l'écran `:6450` affirme « Un email de confirmation a été envoyé automatiquement » **avant** toute réponse d'EmailJS | Envoi serveur après persistance ; retirer l'adresse de l'URL ; ne pas annoncer « envoyé » sans acceptation prestataire (C11) |
| **EM0-001e** Refus / mise en attente de l'inscription partenaire — complémentaire | Candidat | décisions par activité `dashboard.html:5838-5850` (« AUCUN EMAIL n'est déclenché ») ; blocage `:8139-8145` (« ne déclenche aucun email ») | aucun | ABSENT | — | aucune | E-MAIL MANQUANT POUR « inscription partenaire refusée / en attente » (événement complémentaire, texte à proposer, pas à activer par défaut) | Décision métier d'abord (destinataire, moment, contenu) ; puis déclencheur serveur sur la décision persistée |
| **EM0-002a** Mot de passe oublié | Titulaire de l'adresse | `index.html:16905 demanderReinitialisationMotDePasse()` → `resetPasswordForEmail` `:16933` (retour `_hcUrlRetourReinitialisation()` `:16607`) ; `dashboard.html:3905 envoyerLienReinitialisation(email)` → `:3920` (retour `urlRetourReinitialisation()` `:3879`) | Supabase Auth « Reset Password » | `supabase/templates/recuperation-mot-de-passe.html` (objet à saisir : « Réinitialisez votre mot de passe HelixCar », `{{ .ConfirmationURL }}`, « valable une heure ») — **non déployé automatiquement** (`:9-12`) | adresse ; lien de récupération à usage unique | hors dépôt ; côté application : message neutre anti-énumération (`index.html:16944-16948`, `dashboard.html:3925-3929`), limitation d'envoi gérée (`:3894-3898`), anti-double-clic (`_reinitEnvoiEnCours`, `_envoiReinitEnCours`) | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION (appel réel prouvé, modèle versionné) ; déploiement du modèle et « Redirect URLs » NON VÉRIFIÉS ; réception BLOQUÉE | Vérifier modèle collé + objet + délai (le modèle dit « une heure » : à confronter au réglage Supabase) + origines autorisées ; recette en boîte contrôlée |
| **EM0-002b** Mot de passe modifié | Titulaire | `index.html:16720 enregistrerNouveauMotDePasse()` → `updateUser({password})` `:16755` ; `dashboard.html:4031 enregistrerNouveauMotDePasse()` → `:4055` ; réception du lien : `PASSWORD_RECOVERY` `index.html:16857`, `dashboard.html:4107` | aucun côté application | ABSENT côté application ; notification native Supabase éventuelle : hors dépôt | date, consigne de sécurité, jamais le mot de passe | aucune | E-MAIL MANQUANT POUR « mot de passe modifié » (côté application, prouvé) ; notification native Auth : NON VÉRIFIÉ | Décider d'abord si une notification Auth native existe/est activée (éviter le doublon) ; sinon déclencheur serveur sur succès réel d'`updateUser` |
| **EM0-003a** Devis envoyé (et renvoi explicite) | Client propriétaire — adresse **relue côté serveur** (`index.ts:559-565`), jamais celle du navigateur | `dashboard.html:12594 envoyerDevis()` → `prepareDevisSecure()` `:12419` (action `prepare`) → `envoyerEmailDevisSecure()` `:12499` (action `send_email`) → `supabase/functions/devis-secure/index.ts:480 actionSendEmail()` ; identifiant canonique relu serveur si absent (`sbAuthDevisCanonique` `:4315`, réponse au bug « d_id absent » rapporté) | Resend (`https://api.resend.com/emails`, `index.ts:634`) | **inline** dans la fonction : objet `index.ts:595` (« Votre devis HelixCar — {référence} »), HTML `:602-616`, texte `:617-625`, bouton « Consulter et accepter mon devis », PDF joint `Devis_HelixCar_{référence}.pdf` (`:582`). Aucun fichier de modèle séparé | référence, version, prénom/nom, PDF figé par `prepare` (bucket `devis`, `:569-582`), lien `devis.html?token=…` (`:593`) construit depuis `HELIXCAR_URL_PUBLIQUE` ou l'origine autorisée (`:95-102`) | **P** (`actionPrepare` `:461-465`), **T** (`:627-630`), **A** (`:668-669`, avec `fournisseur_id` Resend), **É** (réseau `:648-649`, HTTP `:659-660`, `maj_statut_echouee_apres_envoi` `:685-686`) ; **R jamais écrite** (« exigerait le webhook du prestataire (non configuré) », `:32-35`) ; statut `envoye` posé **seulement après A** (`:672-680`) ; idempotence par `envoi_cle` (`:505-514`) ; verrou serveur 2 min (`:542-556`) ; historique affiché à l'admin `dashboard.html:9294 _afficherJournalEnvois()` | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION ; dépend de secrets et réglages hors dépôt (`RESEND_API_KEY`, domaine expéditeur vérifié — sinon expéditeur temporaire du domaine de test Resend, `index.ts:477`) ; réception BLOQUÉE. Prouvé hors ligne par `tests/t_devis_securite.mjs` (double Resend `:142-154`, contrôle 4.13 « aucune ligne reception_prouvee inventée » `:292-293`) et `tests/t_devis_envoi.js` | Configurer `RESEND_API_KEY`, `RESEND_FROM` (domaine vérifié), `HELIXCAR_URL_PUBLIQUE` ; déployer la fonction ; **webhook Resend → étape `reception_prouvee`** ; recette en boîte contrôlée (rendu, pièce jointe, lien) |
| **EM0-003b** Devis accepté | Client / administrateur (répartition à confirmer) | `devis.html` → action `accept` → `index.ts:751 actionAccept` → `traiterReponseDevis` `:758-803` : écrit `statut='accepte'`, `paiement_statut='en_attente'`, **aucun envoi** | aucun | ABSENT | version acceptée, référence, date, prochaine étape autorisée (paiement en attente, pas de mission — C02) | aucune | E-MAIL MANQUANT POUR « devis accepté » | Déclencheur serveur dans `traiterReponseDevis` après écriture réussie ; destinataires à confirmer ; ne jamais annoncer mission créée ni paiement reçu |
| **EM0-003c** Devis refusé | Client / administrateur (à confirmer) | même chemin, `cibleStatut='refuse'` (`index.ts:754`, `:783`) — **aucun envoi** | aucun | ABSENT | référence, version, date, motif (`nettoyerMotifRefus` `:155`) | aucune | E-MAIL MANQUANT POUR « devis refusé » | Idem ; aucun paiement ni mission |
| **EM0-004a** Mission créée (« Réservation confirmée ») | Client (`clients.email` relue par le navigateur `dashboard.html:6618`) | `dashboard.html:6518 submitNewMission()` → après `POST missions`, `envoyerEmailReservationConfirmee()` `:6616`, `emailjs.send` `:6630` (si `clientId`) | EmailJS | `template_n26gasf` (objet « ✅ Réservation confirmée — {départ} → {arrivée} », texte `:6621-6628`) | référence, trajet, date de prise en charge, montant TTC | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION ; ancien parcours de création admin — **n'applique pas C02** (mission exigeant paiement confirmé et informations complètes) ; promet « un email dès son départ et un autre à son arrivée » (tenu par EM0-013a) | À rebrancher sur la création de mission conforme C02, côté serveur, avec journal ; lien autorisé vers le Dashboard |
| **EM0-004b** Mission modifiée | Acteurs concernés | aucune fonction de modification de mission avec envoi n'existe (`grep modifierMission\|editerMission\|updateMission` : aucun résultat) ; les seuls `PATCH missions` sont des changements de statut (`:7030-7066`, `:7576`, `edl.html:1334-1338`) | aucun | ABSENT | version / changements utiles, date, lien | aucune | E-MAIL MANQUANT POUR « mission modifiée » | Définir d'abord quelles modifications justifient un e-mail (pas une sauvegarde technique) ; trigger serveur sur les colonnes concernées |
| **EM0-004c** Mission annulée | Client et partenaire déjà attribué | `dashboard.html:7059 annulerMission(id)` → `PATCH statut='annulee'`, **aucun envoi** | aucun | ABSENT | référence, date, suite utile (pas de promesse de remboursement) | aucune | E-MAIL MANQUANT POUR « mission annulée » | Déclencheur serveur (trigger sur passage à `annulee`), destinataires selon attribution réelle |
| **EM0-005a** Informations manquantes demandées | Client propriétaire | la liste est **calculée à la lecture** (`migrations/94:95 informations_demande`, remplaçant `06:240`) ; lue par l'admin `dashboard.html:2805`, `:3314` et par le client `index.html:9161` ; **aucun envoi** nulle part | aucun | ABSENT | liste réellement manquante, référence dossier/devis, véhicule ou bloc concerné, lien ciblé Dashboard | aucune | E-MAIL MANQUANT POUR « informations manquantes demandées » | Définir l'événement (la première demande admin ? l'acceptation du devis ?) car aujourd'hui rien n'est « demandé » : c'est un calcul ; puis déclencheur serveur + journal |
| **EM0-005b** Complétion des informations confirmée | Client / administrateur (à confirmer) | client : `index.html:9196 rpc('repondre_informations_demande')` (fonction `migrations/06:345`) ; admin : `dashboard.html:2810 deciderInformation()` / `:2831 changerDecisionInformation()` (statut `validee`) ; **aucun envoi** | aucun | ABSENT | référence, état global « dossier complet » (aucun état global n'existe : chaque rubrique a son statut) | aucune | E-MAIL MANQUANT POUR « complétion des informations » | Définir la notion de complétion globale (toutes rubriques `validee`) avant tout e-mail ; ne pas confondre avec chaque sauvegarde partielle |
| **EM0-006** Opportunité publiée → partenaires éligibles | Partenaires actifs, non bloqués, avec au moins un badge requis validé | `migrations/108:609 publier_opportunite(p_id)` → `insert into opportunite_notifications (…, 'publiee', 'a_envoyer')` par partenaire éligible (`:652-665`) ; **aucune interface** ne l'appelle encore (0 occurrence d'« opportunit » dans `dashboard.html` / `index.html`) | aucun | ABSENT (l'en-tête `108:49-56` le dit : « AUCUN e-mail n'existe ni ne part dans ce lot ») | données publiques-partenaire : intitulé, période, zone générale, lien ; **jamais** coordonnées client, adresse exacte, rémunération | intention seulement : `etat='a_envoyer'` ; états `echec` / `acceptee_prestataire` prévus (`:199-200`) mais rien ne les renseigne ; pas de P, T, R | E-MAIL MANQUANT POUR « opportunité publiée » (intention journalisée, envoi absent) | Fonction serveur consommant les lignes `a_envoyer` (clé événement-destinataire-version), passage `acceptee_prestataire` / `echec` ; modèle à valider |
| **EM0-007a** Candidature partenaire d'inscription reçue | Candidat (adresse saisie) ; **aucune notification admin** | `index.html:18296 submitConvoyeurForm()` → après insertion et vidéo réellement envoyée (`:18505-18510`), `emailjs.send` `:18525` | EmailJS | `template_n26gasf` (objet « Votre candidature partenaire HelixCar a bien été reçue », texte `:18519-18524` avec la liste des activités) | prénom, activités déclarées | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION ; l'écran `index.html:7588` promet « Vous recevrez un email dès que votre dossier sera validé » (tenu par EM0-001d) | Envoi serveur depuis la finalisation réelle (fonction `candidature-video` déjà serveur) ; journal ; décider si l'administration est notifiée |
| **EM0-007b** Candidature à une opportunité reçue | Partenaire candidat ; administration selon règle | `migrations/108:683 postuler_opportunite()` — **n'insère aucune intention** (`evenement` n'admet que `publiee`, `retenu`, `non_retenu`, `pourvue_client`, `:196-198`) | aucun | ABSENT | référence opportunité, date, unicité de la candidature | aucune (même pas une intention) | E-MAIL MANQUANT POUR « candidature à une opportunité reçue » | Ajouter l'événement au journal d'intentions puis au consommateur serveur ; aucun faux succès après clôture (`postuler_opportunite` refuse déjà) |
| **EM0-008** Présélection | Partenaire présélectionné | `migrations/108:754 decider_candidature(…, 'preselectionne')` — état admis (`:167`, `:771`) mais **aucune intention** n'est écrite pour ce cas (`:820-828` ne couvrent que `retenu` / `non_retenu`) | aucun | ABSENT | — | aucune | E-MAIL MANQUANT POUR « présélection » — **conditionnel : décision métier requise** (présélection ≠ retenu) | Décider si l'événement doit notifier ; s'il l'est, intention + consommateur serveur |
| **EM0-009** Partenaire retenu | Partenaire sélectionné | `decider_candidature(…, 'retenu')` → intention `'retenu'` `a_envoyer` (`108:820-824`) ; aucun envoi. Ancien parcours distinct : `dashboard.html:7173 accepterMission()` (le convoyeur s'auto-attribue) → `envoyerEmailFicheMission()` `:7191`, `emailjs.send` `:7236` | aucun (nouveau parcours) / EmailJS (ancien parcours) | ABSENT (nouveau) ; ancien : `template_n26gasf`, objet « ✅ Mission confirmée — {départ} → {arrivée} », texte `:7195-7233` (adresses, contacts, VIN, rémunération, notes, lien fiche mission) | mission et informations autorisées, suite opérationnelle ; texte « Vous avez été retenu pour la mission… » **non validé, non fabriqué ici** | intention seulement (nouveau) ; aucune (ancien) | E-MAIL MANQUANT POUR « partenaire retenu » (intention journalisée, envoi absent ; modèle signalé à préparer, absence confirmée par inspection) ; ancien e-mail « fiche mission » : OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION, hors parcours opportunités | Consommateur serveur des intentions `retenu` ; proposition de texte à faire valider séparément ; décider du sort de l'ancien e-mail (données client complètes envoyées au partenaire) |
| **EM0-010** Partenaire non retenu | Candidat non retenu | `decider_candidature(…, 'non_retenu')` → intention `'non_retenu'` `a_envoyer` (`108:825-828`) ; aucun envoi | aucun | ABSENT | référence opportunité ; ne pas divulguer l'identité du retenu | intention seulement | E-MAIL MANQUANT POUR « partenaire non retenu » (intention journalisée) | Consommateur serveur ; définir le moment d'envoi (à la décision ? à la clôture N/N ?) |
| **EM0-011** Client informé : professionnels trouvés (N sur N) | Client propriétaire de la mission | `decider_candidature` à `v_retenus >= nb_professionnels` : clôture atomique + intention `'pourvue_client'` avec `convoyeur_id` NULL (`108:834-840`) ; jamais à 6/9 (C03) ; aucun envoi | aucun | ABSENT | référence mission, suite utile ; **résolution de l'adresse client côté serveur** (mission → client) à prévoir ; ne pas révéler les candidatures internes | intention seulement | E-MAIL MANQUANT POUR « client informé qu'un professionnel a été trouvé » (intention journalisée, absence confirmée) | Consommateur serveur ; modèle à valider (« un professionnel a été trouvé ») ; proposition séparée |
| **EM0-012** Rappels opérationnels | Client / partenaire concerné | aucun ordonnanceur : `grep pg_cron\|pg_net\|net.http` dans `migrations/` et `supabase/` = 0 ; aucune fonction de rappel | aucun | ABSENT | échéance, mission active, fuseau, fréquence — **non définis** | aucune | E-MAIL MANQUANT POUR « rappels opérationnels » (définition métier préalable : horaire, délai, fuseau, fréquence, arrêt après annulation/clôture) | Définition métier d'abord ; puis tâche planifiée serveur + journal ; jamais de relance après annulation ou clôture |
| **EM0-013a** Fin de mission côté client — état des lieux d'arrivée / de restitution | Client (`clients.email` relue par le navigateur `edl.html:980`) | `edl.html:1276 submit()` → après `PATCH missions` (`:1334-1338`, statut `edl_termine` / `restitution_requise` / …), `envoyerEmailClientEdl(currentMission, PHASE)` `:1339` → `emailjs.send` `:1004` ; 4 phases : `depart`, `arrivee`, `restitution_depart`, `restitution_arrivee` ; texte « fin de mission » si `arrivee` sans restitution ou `restitution_arrivee` (`:996-1002`) | EmailJS | `template_n26gasf` (objets `:983-988`, corps `:989-994`) | référence, villes, phase | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION ; **déclenché à l'état des lieux du convoyeur (`edl_termine`), pas à la mission réellement terminée** (`terminee` est posé par l'admin, ligne suivante) ; deux e-mails intermédiaires (départ, restitution en cours) non demandés par l'inventaire | Requalifier : « véhicule pris en charge / arrivé » ≠ « mission terminée » ; envoi serveur avec journal |
| **EM0-013b** Mission terminée (statut `terminee`) — client et partenaire | Client et partenaire selon règle validée | `dashboard.html:7030 terminerMission()`, `:7039 confirmerMissionTerminee()`, `:7576 terminerMissionNettoyage()` → `PATCH statut='terminee'`, **aucun envoi** ; `109` attribue les points fidélité sur ce passage, sans e-mail | aucun | ABSENT | référence, date, prochaine action (évaluation, facture) | aucune | E-MAIL MANQUANT POUR « fin de mission » (au sens mission réellement terminée) | Trigger serveur sur `terminee` (réservé à l'admin par `97`) ; destinataires à valider |
| **EM0-014a** Paiement confirmé | Client payeur | aucun objet de paiement : `106` prépare `paiement_statut` / `paiement_confirme_le` et précise « rien dans ce lot ne le fait » (`106:74-78`) ; `109:14` « aucun objet de paiement (Stripe ou autre) » | aucun | ABSENT | référence, montant, devise, date — issus d'une confirmation serveur (webhook signé) | aucune | E-MAIL MANQUANT POUR « paiement confirmé » — conditionnel au gate paiement (Q01/Q02), aucun vrai paiement | Après le gate : déclencheur sur l'événement serveur authentifié ; éviter le doublon avec le reçu du prestataire de paiement |
| **EM0-014b** Facture disponible | Client facturé | aucune facture client n'existe ; les « factures » du Dashboard (`dashboard.html:1337-1363`) sont celles des **convoyeurs** vers HelixCar, sans envoi | aucun | ABSENT | numéro, montant, document autorisé | aucune | E-MAIL MANQUANT POUR « facture disponible » (fonctionnalité elle-même absente côté client) | Fonctionnalité facture client d'abord ; envoi serveur ensuite, éventuellement combiné à EM0-014a si le modèle est validé |
| **EM0-015a** Demande d'évaluation | Client éligible | la page « Notations » est **fictive** : convoyeurs, notes et « 18 évaluations » codés en dur (`dashboard.html:1498-1546`) ; aucune table ni fonction d'évaluation dans `migrations/` | aucun | ABSENT | mission éligible non encore évaluée, partenaire autorisé, lien | aucune | E-MAIL MANQUANT POUR « demande d'évaluation » (parcours d'évaluation inexistant) | Parcours d'évaluation réel d'abord (table, RLS, unicité) ; déclencheur serveur après `terminee`, une seule fois |
| **EM0-015b** Confirmation d'évaluation | Client évaluateur | idem — rien ne persiste une évaluation | aucun | ABSENT | évaluation enregistrée une seule fois, accès à l'historique | aucune | E-MAIL MANQUANT POUR « confirmation d'évaluation » | Idem ; jamais déclenché par une simple navigation |

### Événements constatés dans le code mais absents de l'inventaire EM0

| Événement | Destinataire | Déclencheur | Prestataire / modèle | Journal | État | Remarque |
|---|---|---|---|---|---|---|
| Notification administrateur « Nouvelle demande de devis reçue » | Adresse de la constante `HELIXCAR_EMAIL_ADMIN` (`index.html:8121`, **boîte réelle**, valeur non reproduite ici) | `index.html:15584 _submitClientFormInterne()` → bloc `:16298-16375`, `emailjs.send` `:16365`, seulement si `missionReelle` | EmailJS / `template_n26gasf`, objet « Nouvelle demande de devis — HelixCar » | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION | Contient l'adresse et le nom du client, le trajet, le numéro client, un lien vers le Dashboard |
| Parrainage — e-mail au filleul | Adresse **d'un tiers** saisie par l'utilisateur | `index.html:18539 submitParrainage()` → `emailjs.send` `:18601` | EmailJS / `template_n26gasf`, objet « {prénom} vous offre 10% de réduction chez HelixCar ! » | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION | Envoi non sollicité à un tiers ; code généré aléatoirement côté navigateur (`:18552-18557`) ; le prompt n'autorise aucune campagne commerciale : à faire arbitrer |
| Parrainage — confirmation au parrain | Adresse saisie | même fonction, `emailjs.send` `:18614` | idem, objet « Votre parrainage est enregistré, {prénom} ! » | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION | Idem |
| Demande de rappel (« recontact ») reçue | Adresse saisie | `index.html:18625 submitRecontact()` → `emailjs.send` `:18664` | idem, objet « Nous avons bien recu votre demande, {prénom} ! » | aucune | OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION | Part avant toute réponse de l'insertion Supabase (`:18644-18652` non attendue) |
| Devis mis à jour (nouvelle version) | Client | `devis.html:578`, `:651` affichent « Un nouveau devis vous sera envoyé par e-mail » ; l'envoi est le **renvoi explicite** de EM0-003a (`renvoi=true`, `index.ts:598-600`) | Resend | P/T/A/É, `renvoi=true` | couvert par EM0-003a | Promesse tenue seulement si l'admin clique « Renvoyer au client » |
| Notifications push convoyeurs, configuration SMS, RIB | — | `dashboard.html:1792` `alert('Notification envoyée à tous les convoyeurs actifs ✓')`, bloc SMS `:1815-1827` `alert('Configuration SMS enregistrée ✓')`, `:1782` `alert('RIB enregistré…')` | aucun | aucune | **faux comportements encore présents** (lot X01) — rien n'est envoyé ni enregistré | À retirer ou à rendre honnêtes comme `envoyerRecompenses()` `:8038` et `envoyerPenalite()` `:8152`, qui disent désormais qu'aucun message ne part |
| « Un email de confirmation avec la fiche mission complète vous a été envoyé » | — | modale `dashboard.html:2308`, ouverte par `acceptMission()` `:7999` (données de démonstration codées en dur, référence fictive `:8001`) et texte « Il vous sera renvoyé par email dès la livraison » `:8010` | aucun | aucune | **promesse sans e-mail** (faux comportement) | Distinct d'`accepterMission()` `:7173`, qui envoie réellement via EmailJS |

### `helixcar-emails.html` — ce que contient l'ancienne page de modèles, et si elle est référencée

* Page statique « HelixCar — Aperçu des emails » (`<title>`, ligne 6), 679 lignes,
  deux onglets « Convoyeur » / « Client » (`:66-67`) et 14 maquettes HTML
  (`id="email-conv-…"` × 8 : inscription, validation, mission, penalite, rappel,
  retard, scenario, challenge ; `id="email-client-…"` × 6 : inscription,
  confirmation, depart, arrivee, penalite, fidelite). Un seul `<script>`
  (`:661-677`) qui bascule l'affichage ; **aucun appel EmailJS, Resend ou
  Supabase**.
* Contenu de démonstration daté de 2024 (référence fictive, prénoms fictifs,
  montants, « Challenge de mai », « Bronze atteint — 1 000 km ») avec une charte
  (jaune / bleu marine) différente de la charte actuelle du site, et **deux
  adresses réelles codées en dur** (liens `mailto:` `:272`, `:344`, `:395`,
  `:621` ; consigne d'envoi de documents `:237`) — non reproduites ici.
* **Aucune page ne la référence** (aucun lien dans `index.html`, `dashboard.html`,
  `edl.html`, `devis.html`) ; `vercel (2).json` ne déclare aucune route. Les
  seules mentions sont dans `tests/t_nonreg.js:297-300` (fichier déclaré « hors
  périmètre ») et `:355` (contrôle du délai annoncé).
* Elle **n'est pas la source des e-mails envoyés** : EmailJS n'utilise qu'un
  modèle générique (`template_n26gasf`, variables `email` / `titre` / `message`,
  texte brut composé dans le navigateur) et Resend un HTML inline dans la
  fonction Edge. Ces maquettes ne correspondent donc à aucun modèle validé ni
  déployé, et plusieurs décrivent des fonctions inexistantes (rappels, retards,
  pénalités, challenge, paliers de fidélité). À traiter comme un document
  d'idées obsolète, pas comme un inventaire de modèles existants.

### `migrations/109_fidelite_points.sql` — aucun e-mail attendu

Aucun e-mail n'y est attendu, et aucun n'y existe : le seul mot « envoi » du
fichier (`109:8`) cite le nom de la migration 106 en dépendance. La migration
ne contient ni appel réseau, ni intention de notification, ni trigger d'envoi ;
elle calcule des points et des paliers côté serveur. Les récompenses des
paliers n'étant pas validées, aucun e-mail « palier atteint » ne doit être
proposé comme existant (la maquette `email-client-fidelite` de
`helixcar-emails.html` n'a pas de contrepartie dans le code).

## 3. Listes

### E-MAILS EXISTANTS (un appel d'envoi réel existe dans le code ; réception BLOQUÉE partout)

Serveur, journalisé (C11 partiel : P/T/A/É, R jamais écrite) :

1. Devis envoyé / renvoyé — Resend — `devis-secure/index.ts:480 actionSendEmail` (EM0-003a).

Service d'authentification, modèles versionnés mais déploiement NON VÉRIFIÉ :

2. Confirmation d'adresse — Supabase Auth « Confirm signup » — `supabase/templates/confirmation-adresse.html` ; déclenché par `index.html:16042` et `creer-compte-convoyeur.html:268` (EM0-001b/c).
3. Mot de passe oublié — Supabase Auth « Reset Password » — `supabase/templates/recuperation-mot-de-passe.html` ; déclenché par `index.html:16933` et `dashboard.html:3920` (EM0-002a).

Navigateur, EmailJS, modèle générique `template_n26gasf`, aucune journalisation (dix points d'appel) :

4. Bienvenue client — `index.html:16388` (EM0-001a) — contenu potentiellement faux.
5. Notification admin « Nouvelle demande de devis » — `index.html:16365` (complémentaire).
6. Candidature partenaire reçue — `index.html:18525` (EM0-007a).
7. Parrainage, filleul — `index.html:18601` (complémentaire).
8. Parrainage, parrain — `index.html:18614` (complémentaire).
9. Demande de rappel reçue — `index.html:18664` (complémentaire).
10. Compte partenaire validé — `dashboard.html:6437` (EM0-001d).
11. Réservation confirmée (mission créée par l'admin) — `dashboard.html:6630` (EM0-004a).
12. Fiche mission au convoyeur (auto-attribution, ancien parcours) — `dashboard.html:7236` (EM0-009, ancien parcours).
13. État des lieux — départ / arrivée / restitution (4 phases) — `edl.html:1004` (EM0-013a).

### E-MAILS MANQUANTS (absence prouvée par inspection)

* E-MAIL MANQUANT POUR « mot de passe modifié » (EM0-002b) — côté application ; notification native Auth NON VÉRIFIÉE.
* E-MAIL MANQUANT POUR « devis accepté » (EM0-003b).
* E-MAIL MANQUANT POUR « devis refusé » (EM0-003c).
* E-MAIL MANQUANT POUR « mission modifiée » (EM0-004b).
* E-MAIL MANQUANT POUR « mission annulée » (EM0-004c).
* E-MAIL MANQUANT POUR « informations manquantes demandées » (EM0-005a).
* E-MAIL MANQUANT POUR « complétion des informations » (EM0-005b).
* E-MAIL MANQUANT POUR « opportunité publiée » (EM0-006) — intention `a_envoyer` journalisée.
* E-MAIL MANQUANT POUR « candidature à une opportunité reçue » (EM0-007b) — pas même une intention.
* E-MAIL MANQUANT POUR « présélection » (EM0-008) — conditionnel, décision métier requise.
* E-MAIL MANQUANT POUR « partenaire retenu » (EM0-009) — intention journalisée ; texte « Vous avez été retenu pour la mission… » à faire valider.
* E-MAIL MANQUANT POUR « partenaire non retenu » (EM0-010) — intention journalisée.
* E-MAIL MANQUANT POUR « client informé qu'un professionnel a été trouvé » (EM0-011) — intention journalisée à N/N.
* E-MAIL MANQUANT POUR « rappels opérationnels » (EM0-012) — définition métier préalable.
* E-MAIL MANQUANT POUR « fin de mission » au sens statut `terminee` (EM0-013b) ; l'e-mail existant part à l'état des lieux.
* E-MAIL MANQUANT POUR « paiement confirmé » (EM0-014a) — conditionnel au gate paiement.
* E-MAIL MANQUANT POUR « facture disponible » (EM0-014b) — fonctionnalité absente.
* E-MAIL MANQUANT POUR « demande d'évaluation » (EM0-015a) — parcours absent.
* E-MAIL MANQUANT POUR « confirmation d'évaluation » (EM0-015b) — parcours absent.
* Complémentaires, à proposer sans activer : « inscription partenaire refusée / en attente », « remboursement confirmé », « paiement échoué / action requise », « échéance ou annulation du devis » (colonnes `annule_le`, `expire_le` de `106` existent, rien ne les renseigne), « retrait d'opportunité ».

### Compte par état

| État | Lignes EM0 (sous-lignes comprises) |
|---|---|
| OPÉRATIONNEL NON VÉRIFIÉ EN RÉCEPTION | 7 : EM0-001a, 001d, 002a, 003a, 004a, 007a, 013a (+ ancien parcours d'EM0-009) |
| NON VÉRIFIÉ | 2 : EM0-001b, 001c (modèle présent, déploiement et activation inconnus) |
| E-MAIL MANQUANT POUR … | 20 : EM0-001e, 002b, 003b, 003c, 004b, 004c, 005a, 005b, 006, 007b, 008, 009, 010, 011, 012, 013b, 014a, 014b, 015a, 015b |
| BLOQUÉE (réception) | toutes, sans exception |

Un parcours dont l'e-mail obligatoire manque reste incomplet : c'est le cas du
parcours devis après acceptation/refus, du parcours opportunités de bout en
bout, et des parcours informations manquantes, annulation, fin de mission,
paiement, facture et évaluation.

## 4. Risques

### 4.1 Destinataires réels possibles pendant les tests, et comment les suites les neutralisent

* **Coupure réseau totale** : `tests/env.js:81-104` — `RESEAU_AUTORISE` n'admet que
  `file:`, `data:`, `blob:`, `about:`, `chrome-` et `localhost`/`127.0.0.1` ;
  `isolerPage()` et `_isolerNavigateur()` abandonnent toute autre requête au
  niveau de la page et du contexte. Ni le CDN EmailJS, ni Supabase, ni Resend
  ne sont joignables depuis une suite Playwright.
* **Doubles EmailJS** : `window.emailjs` est remplacé avant chargement par un
  double qui compte les appels (`tests/t_devis_envoi.js:51`, `t_client.js:110`,
  `t_decisions.js:150`, `t_blocage.js:119`, `t_infos.js:135`, `t_motdepasse.js:74`,
  `t_mdp_ui.js:47`, `t_mission_nettoyage.js:63`, `t_multivehicules.js:333`,
  `t_nettoyage_dashboard.js:42`, `t_durcissement.js:67`, `t_devis_commun.js:48`,
  `t_stabilisation.js:30`, `t_rattachement.js:41`, `t_reinit.js:72`,
  `t_roles.js:79`, `t_demande_integree.js:89`, `t_a01_connexion.js:101`,
  `t_fidelite.js:113`). Contrôles explicites : `t_devis_envoi.js:361` (J5 : aucun
  EmailJS sur l'envoi de devis), `t_motdepasse.js:314`, `t_mdp_ui.js:355`,
  `t_decisions.js:428`, `t_nonreg.js:144` (E1 : aucun nouvel `emailjs.send`
  introduit). `RECETTE-LOT.md:707-712` (§ 5.8) : douze suites échouent si un
  seul envoi part. `tests/lib.js:34` ignore le bruit console d'EmailJS en
  `file://`.
* **Doubles Supabase Auth** : `signUp` / `resetPasswordForEmail` remplacés
  (`t_a01_connexion.js:91`, `t_motdepasse.js:43-45`, `t_mdp_ui.js:31-39`,
  `t_client.js:86`) ; `t_motdepasse.js:336` et `t_a01_connexion.js:619` comptent
  les appels `resetPasswordForEmail` dans le code source.
* **Double Resend** : `tests/t_devis_securite.mjs:142-154` — `fetchFn` refuse toute
  URL hors `api.resend.com` et simule le prestataire (succès, HTTP 500, coupure
  réseau) ; adresses en `@example.invalid` uniquement (`:277`).
* **Ce que les suites ne couvrent pas** : une recette **manuelle** sur un
  déploiement (aperçu ou production) exécute le vrai code EmailJS depuis le
  navigateur. Les destinataires réels possibles sont alors : la boîte
  administrateur (`HELIXCAR_EMAIL_ADMIN`, à chaque demande de devis réelle), le
  client ou le convoyeur dont l'adresse est en base (réservation, fiche mission,
  état des lieux, validation), **un tiers quelconque** saisi dans le formulaire
  de parrainage, et l'adresse saisie dans les formulaires publics (bienvenue,
  candidature, rappel). Consigne : n'utiliser que des profils `TEST-QA` avec
  une boîte de recette expressément autorisée ; à défaut, ne pas déclencher et
  classer BLOQUÉE. L'erreur EmailJS observée avec une adresse `.invalid`
  (`RECETTE-STABILISATION-POST-PR2.md:400-407`) ne prouve aucun défaut.

### 4.2 Données personnelles et confidentialité dans les modèles

* **Fiche mission au convoyeur** (`dashboard.html:7195-7233`) : adresses de départ,
  d'arrivée et de restitution, noms et téléphones des contacts, VIN,
  immatriculation, notes libres, rémunération — le tout dans un e-mail non
  journalisé, via un service tiers côté navigateur. À confronter à la règle
  « pas de dossier client à un partenaire non encore attribué » (E08) et à la
  minimisation (E13/E17).
* **Notification admin** (`index.html:16332-16363`) : adresse et nom du client,
  trajet, numéro client.
* **Bienvenue client** : numéro client et code de parrainage ; affirmation
  « compte créé » non conditionnée à la création réelle (§ 2, EM0-001a).
* **Validation partenaire** : adresse du candidat placée dans l'URL du lien
  (`creer-compte-convoyeur.html?email=…`, `dashboard.html:6426`) — visible dans
  les journaux d'accès et l'historique.
* **EmailJS côté navigateur** : la clé publique, le service et le modèle sont
  lisibles dans la page ; le modèle accepte un objet et un corps libres
  (`titre`, `message`). N'importe qui peut donc faire partir, sous l'expéditeur
  configuré chez EmailJS, un e-mail au contenu arbitraire vers n'importe quelle
  adresse (usurpation, hameçonnage, épuisement du quota). L'identité de
  l'expéditeur EmailJS n'est pas inspectable d'ici.
* **Doublon à l'inscription** : bienvenue EmailJS (immédiat, « compte créé ») +
  confirmation Supabase (« confirmez votre adresse ») : deux messages
  contradictoires si la confirmation est active. E01 demande de distinguer
  bienvenue et confirmation sans doublon.
* **Expéditeur Resend** : tant que `RESEND_FROM` n'est pas renseigné avec un
  domaine vérifié, l'expéditeur est le domaine de test du prestataire
  (`index.ts:477`) — délivrabilité et confiance dégradées ; à vérifier avant
  toute recette de réception.
* **Modèles Supabase** : ils ne contiennent que `{{ .ConfirmationURL }}` et un
  texte fixe ; pas de donnée personnelle superflue. Le modèle de récupération
  annonce « valable une heure » : à faire correspondre au réglage réel
  d'expiration (non vérifiable ici).

### 4.3 Liens signés et jetons

* **Devis** : le jeton brut n'apparaît que dans l'URL envoyée
  (`index.ts:593`) ; seule son empreinte SHA-256 est en base
  (`hasherToken` `:124`), avec expiration (`date_expiration_token`) et
  invalidation à chaque nouvelle préparation (l'ancien lien « ne fonctionnera
  plus », `dashboard.html:12637`). Le code s'interdit de le journaliser
  (`dashboard.html:12488-12490` et `:12494-12498`) ; `t_devis_securite.mjs:284-285`
  vérifie que la clé Resend ne figure jamais dans le corps. Aucun lien réel ne
  doit être collé dans un document de recette — celui-ci n'en contient aucun.
* **Supabase** : `{{ .ConfirmationURL }}` porte un jeton à usage unique ; les URL
  de retour (`redirectTo`, `emailRedirectTo`) doivent figurer dans les
  « Redirect URLs » du projet, sinon le lien atterrit ailleurs — réglage hors
  dépôt, NON VÉRIFIÉ.
* **Réception jamais prouvée** : aucun webhook Resend, donc `reception_prouvee`
  n'est jamais écrite (`index.ts:32-35`, contrôle 4.13 de
  `t_devis_securite.mjs`) ; EmailJS ne renvoie qu'un succès d'appel, sans
  identifiant de message exploitable dans le code. « Envoyé » ne signifie donc
  jamais « reçu », et l'écran du Dashboard le dit (`dashboard.html:12697`).

## 5. Ce qu'il reste à faire — par e-mail manquant, sans code

Principe commun recommandé (à valider avant toute implémentation) : un seul
mécanisme serveur, sur le modèle déjà en place pour le devis — une **table
d'intentions/journal** par domaine avec les cinq étapes de C11 (préparation,
tentative, acceptation prestataire, échec, réception prouvée), une **clé de
déduplication** événement-destinataire-version, et une **fonction Edge
d'envoi** (service_role + `RESEND_API_KEY`) qui lit les intentions
`a_envoyer`, relit toujours l'adresse et les données côté serveur, appelle
Resend et pose l'étape obtenue — jamais un statut métier avant acceptation
prestataire. Un **webhook Resend** signé alimente `reception_prouvee`. Aucun
modèle n'est écrit ici : chaque texte fait l'objet d'une proposition séparée à
valider.

| E-mail manquant | Déclencheur serveur recommandé | Journal | Prérequis métier |
|---|---|---|---|
| Mot de passe modifié (EM0-002b) | Après succès réel d'`updateUser` : soit la notification native Supabase Auth si elle existe et est activée, soit une fonction Edge appelée après le succès — pas les deux | journal générique | Vérifier l'existence d'une notification native pour éviter le doublon |
| Devis accepté / refusé (EM0-003b/c) | Dans `traiterReponseDevis`, après l'`update` réussi (statut `accepte` / `refuse`), insertion d'une intention par destinataire ; envoi par la fonction d'envoi | `devis_envois` étendu (ou table sœur) avec `evenement` | Répartition client / administrateur ; contenu sans promesse de mission ni de paiement |
| Mission modifiée (EM0-004b) | Trigger `AFTER UPDATE` sur `missions`, restreint aux colonnes métier convenues (dates, lieux, véhicule), ignorant les sauvegardes techniques | table `mission_notifications` (à créer) | Liste des modifications qui justifient un e-mail |
| Mission annulée (EM0-004c) | Trigger sur passage à `annulee` ; destinataires = client + partenaires réellement attribués | idem | Texte sans promesse de remboursement |
| Informations manquantes demandées (EM0-005a) | Événement explicite côté admin (« demander au client ») ou transition définie (acceptation du devis) ; liste calculée par `informations_demande` au moment de l'envoi, lien ciblé vers l'espace client | journal générique | Définir l'événement déclencheur ; aucune rubrique incompatible avec le scénario |
| Complétion des informations (EM0-005b) | Trigger sur `demande_informations_manquantes` quand toutes les rubriques sont `validee` (état global à définir) | idem | Notion de « dossier complet » |
| Opportunité publiée (EM0-006) | Intentions déjà écrites par `publier_opportunite` ; fonction d'envoi consommant `opportunite_notifications` `a_envoyer`, passage à `acceptee_prestataire` / `echec` | `opportunite_notifications` (ajouter `preparation`, `tentative`, `reception_prouvee`, clé de déduplication, `fournisseur_id`) | Interface admin de publication (inexistante) ; modèle sans coordonnées client ni rémunération |
| Candidature à une opportunité reçue (EM0-007b) | Ajouter l'événement au domaine `evenement` et l'insertion dans `postuler_opportunite` | idem | Séparer de EM0-007a ; notification admin à confirmer |
| Présélection (EM0-008) | Seulement si décidé : insertion dans `decider_candidature` pour `preselectionne` | idem | Décision métier |
| Partenaire retenu (EM0-009) | Intention déjà écrite ; consommateur serveur | idem | Texte « Vous avez été retenu pour la mission… » à valider ; informations autorisées seulement |
| Partenaire non retenu (EM0-010) | Intention déjà écrite ; consommateur serveur | idem | Moment d'envoi ; ne pas nommer le retenu |
| Client : professionnels trouvés (EM0-011) | Intention `pourvue_client` déjà écrite à N/N ; résolution mission → client côté serveur | idem | Texte à valider ; jamais à 6/9 |
| Rappels opérationnels (EM0-012) | Tâche planifiée serveur (extension de planification Supabase ou fonction Edge appelée par un ordonnanceur externe) ne sélectionnant que les missions actives non annulées/clôturées | journal générique avec clé (mission, échéance, destinataire) | Horaire, délai, fuseau, fréquence |
| Fin de mission (EM0-013b) | Trigger sur passage à `terminee` (déjà réservé à l'admin par la migration 97) | `mission_notifications` | Destinataires client / partenaire ; requalifier l'e-mail d'état des lieux |
| Paiement confirmé (EM0-014a) | Après le gate paiement : sur l'événement serveur authentifié (webhook signé) qui pose `paiement_statut='paye'` | journal générique | Aucun vrai paiement en recette ; éviter le doublon avec le reçu du prestataire |
| Facture disponible (EM0-014b) | Après génération réelle d'une facture client (fonctionnalité à créer) | idem | Peut être combiné à EM0-014a si le modèle est validé |
| Demande / confirmation d'évaluation (EM0-015a/b) | Après un parcours d'évaluation réel : demande une seule fois après `terminee` ; confirmation à l'insertion unique de l'évaluation | idem | Table, RLS, unicité ; jamais déclenché par une navigation |
| Complémentaires (refus d'inscription, remboursement, paiement échoué, échéance/annulation du devis, retrait d'opportunité) | À proposer avec destinataire et texte ; ne pas activer sans validation | idem | Décision du propriétaire |

Pour les e-mails **existants**, ce qu'il reste à faire tient en trois points :
(1) recette de réception dans une boîte autorisée (date/délai, expéditeur,
objet, contenu, liens, pièce jointe, rendu desktop/mobile) — BLOQUÉE ici ;
(2) pour les envois EmailJS, décider de leur migration vers l'envoi serveur
journalisé (le contrat C11 n'est pas respectable depuis le navigateur) et,
en attendant, corriger les affirmations fausses (« compte créé »,
« e-mail envoyé ») ; (3) pour le devis, brancher le webhook Resend afin que
`reception_prouvee` cesse d'être une étape vide.
