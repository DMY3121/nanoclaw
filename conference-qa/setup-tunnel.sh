#!/usr/bin/env bash
# setup-tunnel.sh — Configure Cloudflare Tunnel pour qa.dmy.me
set -euo pipefail

TUNNEL_NAME="conference-qa"
HOSTNAME="qa.dmy.me"
APP_PORT=3456
CONFIG_DIR="$(cd "$(dirname "$0")/tunnel" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}▶ $*${NC}"; }
success() { echo -e "${GREEN}✓ $*${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $*${NC}"; }
error()   { echo -e "${RED}✗ $*${NC}"; exit 1; }

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Cloudflare Tunnel Setup — ${HOSTNAME}${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── 1. Vérifier cloudflared ──────────────────────────────────────────────────
if ! command -v cloudflared &>/dev/null; then
  warn "cloudflared non trouvé. Installation..."
  if [[ "$(uname)" == "Darwin" ]]; then
    brew install cloudflared
  elif [[ "$(uname)" == "Linux" ]]; then
    ARCH=$(uname -m)
    [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]] && BIN="arm64" || BIN="amd64"
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${BIN}" \
      -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
    success "cloudflared installé"
  else
    error "Plateforme non supportée. Installez cloudflared manuellement : https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/"
  fi
fi
success "cloudflared $(cloudflared --version 2>&1 | head -1)"

# ── 2. Authentification ──────────────────────────────────────────────────────
if [[ ! -f ~/.cloudflared/cert.pem ]]; then
  info "Authentification Cloudflare (ouvre le navigateur)…"
  cloudflared tunnel login
  success "Authentifié"
else
  success "Déjà authentifié"
fi

# ── 3. Créer ou récupérer le tunnel ─────────────────────────────────────────
EXISTING=$(cloudflared tunnel list 2>/dev/null | grep -w "$TUNNEL_NAME" | awk '{print $1}' || true)

if [[ -n "$EXISTING" ]]; then
  TUNNEL_ID="$EXISTING"
  success "Tunnel existant trouvé : $TUNNEL_ID"
else
  info "Création du tunnel '$TUNNEL_NAME'…"
  OUTPUT=$(cloudflared tunnel create "$TUNNEL_NAME" 2>&1)
  TUNNEL_ID=$(echo "$OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [[ -z "$TUNNEL_ID" ]] && error "Impossible de récupérer l'ID du tunnel.\n$OUTPUT"
  success "Tunnel créé : $TUNNEL_ID"
fi

# ── 4. Écrire le config.yml ──────────────────────────────────────────────────
CRED_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"
cat > "$CONFIG_DIR/config.yml" <<EOF
# Cloudflare Tunnel — Conference Q&A
tunnel: ${TUNNEL_ID}
credentials-file: ${CRED_FILE}

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:${APP_PORT}
  - service: http_status:404
EOF
success "config.yml écrit → $CONFIG_DIR/config.yml"

# ── 5. DNS CNAME ─────────────────────────────────────────────────────────────
info "Configuration DNS : ${HOSTNAME} → tunnel…"
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>&1 || warn "DNS déjà configuré ou erreur — vérifiez le dashboard Cloudflare."
success "DNS configuré"

# ── 6. Résumé ────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Tunnel prêt !${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Pour lancer l'app + le tunnel :"
echo ""
echo -e "  ${CYAN}npm run start:tunnel${NC}   (dans conference-qa/)"
echo ""
echo "  URLs publiques :"
echo -e "  ${CYAN}https://${HOSTNAME}/${NC}          ← Public"
echo -e "  ${CYAN}https://${HOSTNAME}/display.html${NC} ← Écran"
echo "  Admin : voir ADMIN_PATH dans la console au démarrage"
echo ""
