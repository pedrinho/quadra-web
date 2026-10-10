#!/bin/sh
# Photograph a recording as the original game plays it.
#
#   shoot.sh <quadra-dir> <file.rec> <out-dir> [every] [turbo]
#
# <quadra-dir> is an upstream checkout built with patches/0002-screenshot-frames.patch
# (the `quadra` binary and `quadra.res` side by side). Every <every> game frames
# (1/100 s, default 1000 = ten seconds) the frame is saved to <out-dir> as a
# 640x480 PNG named by its game frame. <turbo> is how many milliseconds of game
# run per displayed frame (default 100, about six times real time at 60 Hz).
#
# A window opens while it runs. The game goes back to its menus when a recording
# ends rather than quitting (-thenquit does not apply to -play), so this stops it
# once the log says the playback is over.
set -eu

[ $# -ge 3 ] || { sed -n '2,12p' "$0"; exit 2; }
dir=$(cd "$1" && pwd)
rec=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
out=$3
every=${4:-1000}
turbo=${5:-100}

mkdir -p "$out"
out=$(cd "$out" && pwd)

cd "$dir"
QUADRA_SHOT_DIR="$out" QUADRA_SHOT_EVERY="$every" QUADRA_SHOT_TURBO="$turbo" QUADRADIR=. \
  ./quadra -nosound -play "$rec" >"$out/quadra.log" 2>&1 &
pid=$!
while kill -0 "$pid" 2>/dev/null; do
  if grep -q 'Multi_player::~Multi_player' "$out/quadra.log"; then
    kill "$pid"
    break
  fi
  sleep 1
done
wait "$pid" 2>/dev/null || true

for bmp in "$out"/*.bmp; do
  [ -e "$bmp" ] || continue
  sips -s format png "$bmp" --out "${bmp%.bmp}.png" >/dev/null && rm "$bmp"
done
echo "$(ls "$out"/*.png 2>/dev/null | wc -l | tr -d ' ') frames in $out"
