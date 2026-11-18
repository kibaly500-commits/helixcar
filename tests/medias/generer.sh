#!/bin/sh
# Régénère les médias de test. Nécessite un ffmpeg avec le décodeur mjpeg
# et l'encodeur libvpx (celui fourni avec Playwright convient).
# Les fichiers produits sont volontairement minuscules (64x48, 2 img/s).
set -e
FF="${FF:-/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux}"
D="$(dirname "$0")"
[ -f "$D/frame.jpg" ] || { echo "frame.jpg manquant (voir mkjpeg.js)"; exit 1; }
gen() { n="$1"; out="$2"; i=1; while [ "$i" -le "$n" ]; do cat "$D/frame.jpg"; i=$((i+1)); done \
  | "$FF" -y -hide_banner -loglevel error -f image2pipe -vcodec mjpeg -framerate 2 -i pipe:0 \
    -c:v libvpx -b:v 25k -deadline realtime -cpu-used 8 -r 2 "$out"; }
gen 60  "$D/video_30s.webm"    # 30 s  — valide partout
gen 180 "$D/video_90s.webm"    # 90 s  — acceptée pour tous les métiers
gen 300 "$D/video_150s.webm"   # 150 s — refusée partout
printf 'ceci n est pas une video' > "$D/document.avi"
head -c 200000 /dev/urandom > "$D/factice.mp4"
echo "Médias régénérés."
