#!/usr/bin/env bash
# One-shot: quality gates → register (first time) → deploy to production → install on your site (Jira + Confluence).
# Usage:  SITE=your-site.atlassian.net ./scripts/ship.sh
# Needs:  forge login (or FORGE_EMAIL + FORGE_API_TOKEN in the environment).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SITE:?Set SITE=your-site.atlassian.net}"
ENV="${FORGE_ENV:-production}"

echo "==> Installing dependencies"
npm ci --no-audit --no-fund
npm --prefix static/app ci --no-audit --no-fund

echo "==> Quality gates"
npm run lint
npm run typecheck
npm run test:coverage
npm run build:ui

if grep -q '00000000-0000-0000-0000-000000000000' manifest.yml; then
  echo "==> Registering the app (writes your app id into manifest.yml)"
  forge register "Sprint Sentinel" --accept-terms
fi

echo "==> forge lint"
forge lint

echo "==> Deploying to $ENV"
forge deploy -e "$ENV" --non-interactive

echo "==> Installing on $SITE (Jira required, Confluence optional)"
forge install -e "$ENV" -s "$SITE" -p Jira --confirm-scopes --non-interactive || forge install -e "$ENV" -s "$SITE" -p Jira --upgrade --confirm-scopes --non-interactive
forge install -e "$ENV" -s "$SITE" -p Confluence --confirm-scopes --non-interactive || forge install -e "$ENV" -s "$SITE" -p Confluence --upgrade --confirm-scopes --non-interactive || \
  echo "   (Confluence install skipped/failed — reports need it; see README › Confluence)"

APP_UUID=$(grep -oE 'app/[0-9a-f-]{36}' manifest.yml | head -1 | cut -d/ -f2)
cat <<MSG

Deployed and installed.
  • Jira:        open any Scrum project → "Sprint Sentinel" tab → "Load demo sprint data"
  • Rovo:        Rovo Chat → Agents → "Sprint Sentinel"
  • MCP:         https://mcp.atlassian.com/forge/$APP_UUID  (enable in admin.atlassian.com → Apps → Sites → Connected apps)
  • Install link: developer.console → Sprint Sentinel → Distribution → Sharing → copy link into SUBMISSION.md
  • Logs:        forge logs -e $ENV
MSG
