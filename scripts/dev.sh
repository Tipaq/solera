#!/usr/bin/env bash
# Lance Solera en développement, isolé de toute autre instance de la machine.
#
# Trois instances cohabitent ici, et elles ne doivent jamais se partager ni un port
# ni un dossier de données :
#
#   7517  Solera stable      ~/.local/share/solera        (service systemd, build)
#   7417  Solera dev         ~/.local/share/solera-dev    (ce script, tsx watch)
#   5417  vite               —                            (proxie /api vers 7417)
#   7317  Sillage installé   ~/.local/share/sillage       (le produit de Marl, intact)
#
# Les variables sont posées ici et nulle part ailleurs : une configuration qui ne vit
# que dans l'environnement d'un processus lancé à la main se perd au premier redémarrage.
set -euo pipefail

# Le runtime de Solera, pour que le script marche depuis un shell non interactif
# (une unité systemd, un agent) où node n'est pas sur le PATH.
export PATH="$HOME/.local/share/solera/node/current/bin:$HOME/.local/share/solera-dev/agents/bin:$PATH"

export SOLERA_DATA_DIR="${SOLERA_DATA_DIR:-$HOME/.local/share/solera-dev}"
export SOLERA_CONFIG="${SOLERA_CONFIG:-$SOLERA_DATA_DIR/config.toml}"
export SOLERA_PORT="${SOLERA_PORT:-7417}"
export SOLERA_LOG_LEVEL="${SOLERA_LOG_LEVEL:-debug}"

mkdir -p "$SOLERA_DATA_DIR"

if command -v ss >/dev/null && ss -ltn "sport = :$SOLERA_PORT" | grep -q LISTEN; then
  echo "Le port $SOLERA_PORT est déjà pris." >&2
  echo "C'est probablement l'ancienne instance de dev de Sillage, lancée depuis" >&2
  echo "~/projects/sillage et devenue inutile : Solera a son propre dépôt." >&2
  echo "Pour la retirer :  pkill -f 'projects/sillage/apps/server'" >&2
  echo "Ou choisis un autre port :  SOLERA_PORT=7418 $0" >&2
  exit 1
fi

echo "Solera dev — serveur :$SOLERA_PORT · vite :5417 · données $SOLERA_DATA_DIR"
cd "$(dirname "$0")/.."
exec pnpm dev
