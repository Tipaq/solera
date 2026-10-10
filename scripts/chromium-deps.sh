#!/usr/bin/env bash
#
# Pose les bibliothèques dont Chromium a besoin, sans sudo.
#
# `playwright install` dépose bien les binaires, mais ils ne démarrent pas : il leur
# manque une vingtaine de bibliothèques système. `playwright install-deps` les
# installerait — par apt, donc avec un sudo qu'on n'a pas sur cette machine.
#
# Mais `apt-get download` n'a jamais eu besoin de privilèges, et `dpkg -x` extrait un
# .deb où on veut. On pose donc les mêmes fichiers dans le répertoire personnel, et
# `LD_LIBRARY_PATH` dit à Chromium où les trouver. Rien n'est installé pour le système,
# rien n'est modifié hors de ~/.local.
#
# La liste vient de `deb.deps`, livré par Playwright à côté du binaire : c'est sa propre
# déclaration de dépendances, pas une liste devinée.
#
# Usage :
#   ./scripts/chromium-deps.sh
#   export LD_LIBRARY_PATH="$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu"
set -euo pipefail

DEST="$HOME/.local/lib/chromium-deps"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Noms Ubuntu 25.10. Le suffixe `t64` vient de la transition vers `time_t` 64 bits :
# sans lui, apt ne trouve pas le paquet sur les versions récentes.
PACKAGES=(
  libnspr4 libnss3 libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64
  libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libexpat1 libgbm1
  libglib2.0-0t64 libgtk-3-0t64 libpango-1.0-0 libudev1 libvulkan1
  libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3
  libxkbcommon0 libxrandr2
)

echo "Téléchargement de ${#PACKAGES[@]} paquets…"
(cd "$WORK" && apt-get download "${PACKAGES[@]}" >/dev/null)

echo "Extraction vers $DEST"
mkdir -p "$DEST"
for deb in "$WORK"/*.deb; do dpkg -x "$deb" "$DEST"; done

LIB="$DEST/usr/lib/x86_64-linux-gnu"
BIN="$(find "$HOME/.cache/ms-playwright" -name chrome-headless-shell -type f | head -1)"

if [ -z "$BIN" ]; then
  echo "Binaire absent : lance d'abord « pnpm exec playwright install chromium »." >&2
  exit 1
fi

echo -n "Vérification : "
LD_LIBRARY_PATH="$LIB" "$BIN" --version

cat <<MSG

Prêt. Pour s'en servir :

  export LD_LIBRARY_PATH="$LIB"

Les scripts *-ui-check.mjs et toute utilisation de Playwright fonctionnent alors
normalement.
MSG
