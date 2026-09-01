#!/usr/bin/env bash
# Waits for the local Hardhat chain, then deploys and seeds the contracts.
set -euo pipefail

RPC="${LOCALHOST_RPC_URL:-http://chain:8545}"

echo "waiting for chain at $RPC ..."
for _ in $(seq 1 60); do
  if curl -sf -X POST -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
      "$RPC" >/dev/null; then
    echo "chain is up."
    break
  fi
  sleep 2
done

echo
echo "=== deploying contracts to the local chain ==="
npm run deploy:local

echo
echo "=== seeding on-chain demo data ==="
npm run seed:local

echo
echo "=== seeding off-chain data (Supabase) ==="
# Optional: only works once real Supabase credentials are in apps/platform/.env.local.
if npm run seed:offchain; then
  echo "off-chain seed complete."
else
  echo "off-chain seed skipped — add your Supabase keys to apps/platform/.env.local, then rerun:"
  echo "  docker compose run --rm deployer npm run seed:offchain"
fi

echo
echo "deploy complete."
