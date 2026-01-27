#!/usr/bin/env bash
set -e

# 1. Build
docker compose build backend-green frontend-green

# 2. Update Config to Green (Before starting Gateway to avoid crashes)
cp nginx/conf.d/upstreams/backend.green.conf  nginx/conf.d/upstreams/backend.active.conf
cp nginx/conf.d/upstreams/frontend.green.conf nginx/conf.d/upstreams/frontend.active.conf

# 3. Start Green Stack + Gateway
docker compose up -d gateway backend-green frontend-green

# 4. Reload (Optional, in case it was already running)
docker compose exec gateway nginx -s reload || true

# docker compose stop backend-blue frontend-blue || true
