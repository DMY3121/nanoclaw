#!/bin/bash
# uninstall.sh — Remove NanoClaw, its dependencies, and Docker
# Ollama is preserved if installed.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[uninstall] $*"; }
warn() { echo "[uninstall] WARNING: $*"; }

# --- 1. Stop NanoClaw service ---

log "Stopping NanoClaw service..."

# systemd (user)
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user stop nanoclaw 2>/dev/null && log "Stopped systemd user service" || true
  systemctl --user disable nanoclaw 2>/dev/null && log "Disabled systemd user service" || true
  UNIT_USER="$HOME/.config/systemd/user/nanoclaw.service"
  if [ -f "$UNIT_USER" ]; then
    rm -f "$UNIT_USER"
    systemctl --user daemon-reload 2>/dev/null || true
    log "Removed $UNIT_USER"
  fi
  # systemd (system / root)
  if [ -f "/etc/systemd/system/nanoclaw.service" ]; then
    systemctl stop nanoclaw 2>/dev/null || true
    systemctl disable nanoclaw 2>/dev/null || true
    rm -f /etc/systemd/system/nanoclaw.service
    systemctl daemon-reload 2>/dev/null || true
    log "Removed /etc/systemd/system/nanoclaw.service"
  fi
fi

# launchd (macOS)
PLIST="$HOME/Library/LaunchAgents/com.nanoclaw.plist"
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  log "Removed launchd plist: $PLIST"
fi

# nohup fallback — kill by pid file
PID_FILE="$PROJECT_ROOT/nanoclaw.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null && log "Killed nohup process (PID $PID)" || true
  fi
  rm -f "$PID_FILE"
fi

# Kill any remaining nanoclaw node processes
pkill -f "$PROJECT_ROOT/dist/index.js" 2>/dev/null && log "Killed orphaned nanoclaw processes" || true

# --- 2. Remove Docker nanoclaw image and containers ---

if command -v docker >/dev/null 2>&1; then
  log "Removing nanoclaw Docker containers and image..."
  docker ps -a --filter "ancestor=nanoclaw-agent" -q 2>/dev/null \
    | xargs -r docker rm -f 2>/dev/null && log "Removed nanoclaw containers" || true
  docker rmi nanoclaw-agent 2>/dev/null && log "Removed nanoclaw-agent image" || true
fi

# --- 3. Remove Docker engine ---

log "Removing Docker engine..."

if command -v apt-get >/dev/null 2>&1; then
  # Debian / Ubuntu
  apt-get remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
    docker-compose-plugin docker-ce-rootless-extras 2>/dev/null || \
  apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
  apt-get autoremove -y 2>/dev/null || true
  rm -rf /var/lib/docker /var/lib/containerd /etc/docker
  log "Docker removed (apt)"
elif command -v yum >/dev/null 2>&1 || command -v dnf >/dev/null 2>&1; then
  # RHEL / Fedora
  PKG_MGR=$(command -v dnf || command -v yum)
  $PKG_MGR remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
    docker-compose-plugin 2>/dev/null || \
  $PKG_MGR remove -y docker docker-engine docker-common 2>/dev/null || true
  rm -rf /var/lib/docker /var/lib/containerd /etc/docker
  log "Docker removed (yum/dnf)"
elif command -v brew >/dev/null 2>&1; then
  # macOS (Homebrew)
  brew uninstall --cask docker 2>/dev/null || brew uninstall docker 2>/dev/null || true
  log "Docker removed (brew)"
else
  warn "Could not detect package manager — remove Docker manually."
fi

# --- 4. Remove NanoClaw node_modules and build artifacts ---

log "Removing node_modules and build artifacts..."
rm -rf "$PROJECT_ROOT/node_modules"
rm -rf "$PROJECT_ROOT/dist"
rm -rf "$PROJECT_ROOT/container/agent-runner/node_modules"
log "Cleaned node_modules and dist"

# --- 5. Ollama — preserved ---

if command -v ollama >/dev/null 2>&1; then
  log "Ollama detected — NOT removed (preserved as requested)."
else
  log "Ollama is not currently installed."
fi

log ""
log "=== NanoClaw uninstall complete ==="
log "The project directory ($PROJECT_ROOT) was left in place."
log "To fully delete it run: rm -rf $PROJECT_ROOT"
