#!/usr/bin/env sh
# Regenerates examples/*.md and examples/*.json with the provider configured in .env.
# Usage (inside Docker, nothing else needed):  sh scripts/generate-examples.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p examples
run() {
  name="$1"; shift
  docker compose run --rm -T backend node dist/cli.js "$@" --json > "examples/$name.json"
  docker compose run --rm -T backend node dist/cli.js "$@" > "examples/$name.txt"
  echo "wrote examples/$name.json and examples/$name.txt"
}
run 1-cafe "develop a cafe website"
run 2-railway "develop a website for railway ticket booking" --style technical
run 3-candles "online store for handmade candles with stripe checkout" --style short
