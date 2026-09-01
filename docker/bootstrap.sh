#!/usr/bin/env bash
# One-shot bootstrap: creates env files, installs every workspace's dependencies,
# compiles the contracts and exports the ABIs. Runs inside the `install` service.
set -euo pipefail

seed_env() {
  local example="$1" target="$2"
  if [ -f "$target" ]; then
    echo "env    : $target already exists — leaving it alone"
  elif [ -f "$example" ]; then
    cp "$example" "$target"
    echo "env    : created $target from $(basename "$example")"
  fi
}

echo "=== 1/4  environment files ==="
seed_env ".env.example" ".env"
seed_env "apps/platform/.env.local.example" "apps/platform/.env.local"
seed_env "apps/employee-portal/.env.local.example" "apps/employee-portal/.env.local"

echo
echo "=== 2/4  installing dependencies (root + platform + employee-portal) ==="
npm ci
npm --prefix apps/platform ci
npm --prefix apps/employee-portal ci

echo
echo "=== 3/4  compiling contracts ==="
npm run compile

echo
echo "=== 4/4  exporting ABIs ==="
npm run export:abi

echo
echo "bootstrap complete."
