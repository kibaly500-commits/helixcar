# Dossier de passation

Contenu conservé pour la reprise (voir `tests/PASSATION-CODEX.md`) :

- `inventaire_A01.md`, `inventaire_D01.md`, `inventaire_X01.md` : cartographies
  en lecture seule (fichier:ligne, état avant correction) établies au début
  des lots. Les numéros de ligne sont ceux de la branche AVANT ces lots.
- `scripts/patch_d01_x01_index.py` : script de modification d'`index.html`
  (mode intégré sans flash, étape identité retirée, complétion par
  véhicule et enregistrement progressif, vitrine sans liens morts ni
  chiffres sans source, « Être recontacté » honnête). **Non appliqué** :
  il s'est arrêté sur une ancre (les liens du pied de page ont six espaces
  d'indentation) sans rien écrire. À corriger puis exécuter.
- `scripts/f01_lot1_index.py` : premier script du lot F01 (étape 3
  « Trouver un professionnel »), écrit pour un ancien arbre de travail ;
  remplacé par les patchs ci-dessous.
- `f01/0001-*.patch`, `f01/0002-*.patch` : les deux commits de l'agent F01
  (`git am`), non fusionnés, non testés par la personne qui a rédigé la
  passation.
- `f01/0003-F01-travail-non-committe.diff` : le reste du travail F01, non
  committé (dashboard.html, index.html).
- `f01/111_plafonds_mission_et_nettoyage_reserve.sql.txt` et
  `f01/f01.sh.txt` : migration et section RLS de l'agent F01, **à
  renuméroter 112** (le numéro 111 est pris par les évaluations).

Aucun de ces fichiers n'est chargé par une page ni par une suite de tests.
