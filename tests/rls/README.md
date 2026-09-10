# Sections RLS par lot

Chaque fichier `*.sh` de ce dossier est **exécuté à la fin de
`tests/t_rls.sh`**, dans l'ordre alphabétique, avec les mêmes helpers :
`check "libellé" "attendu" "obtenu"`, `sql "…"`, `sqlAdmin "…"`,
`appliquer migrations/NNN_….sql`, et l'accès direct `su postgres -c "psql
-U postgres -d $DB …"`.

Pourquoi un fichier par lot : deux chantiers menés en parallèle
n'entrent plus en conflit sur la fin du script principal. Les jeux
d'essai restent préfixés `TEST-QA-CLAUDE-HELIXCAR` et n'atteignent
jamais Supabase.

Le nom de la base jetable est paramétrable : `HC_RLS_DB=verif_lot bash
tests/t_rls.sh` permet deux campagnes simultanées sur la même machine.
