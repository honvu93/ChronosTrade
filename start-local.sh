#!/usr/bin/env bash
set -e

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[start-local]${NC} $1"; }

cleanup() {
  log "Shutting down all services..."
  kill 0 2>/dev/null
  wait 2>/dev/null
  log "Done."
}
trap cleanup EXIT INT TERM

cd "$(dirname "$0")"

# Kill any lingering processes on our ports
kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null) || true
  if [ -n "$pids" ]; then
    log "Port $port in use — killing PID(s) $pids..."
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
}

kill_port 3001
kill_port 5001

# 1. Infrastructure
log "Starting Docker (TimescaleDB, Redis)..."
docker compose up -d

# 2. Backend API
log "Starting backend API ${CYAN}:3001${NC}"
npm run dev &

# 3. Frontend
log "Starting frontend ${CYAN}:5001${NC}"
npm --prefix web run dev &

# 4. Workers
log "Starting workers..."
npm run dev:trading:auto-worker &
npm run dev:trading:reconciliation-worker &
npm run dev:external-action:worker &
npm run dev:backtest:worker &

# 5. Cloudflare Tunnel
if command -v cloudflared &>/dev/null; then
  log "Starting Cloudflare Tunnel ${CYAN}(trade.your-domain.com / trade-api.your-domain.com)${NC}"
  cloudflared tunnel --config cloudflared-config.yml run &
else
  log "cloudflared not found, skipping tunnel"
fi

log "All services started. Press Ctrl+C to stop."
wait
