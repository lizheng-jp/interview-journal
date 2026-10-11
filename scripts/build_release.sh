#!/usr/bin/env bash
# Build production CPU architecture locally, never on the shared production host.
set -euo pipefail
cd "$(dirname "$0")/.."
revision=$(git rev-parse --short=12 HEAD)
release_dir=".storage/releases/$revision"
mkdir -p "$release_dir"
chmod 700 "$release_dir"
web_image="interview-journal-web:release-$revision"
api_image="interview-journal-api:release-$revision"
docker build --platform linux/amd64 --build-arg INTERNAL_API_URL=http://api:8000 -t "$web_image" frontend
docker build --platform linux/amd64 -t "$api_image" backend
docker save "$web_image" "$api_image" | gzip > "$release_dir/images.tar.gz"
printf 'INTERVIEW_WEB_IMAGE=%s\nINTERVIEW_API_IMAGE=%s\n' "$web_image" "$api_image" > "$release_dir/images.env"
shasum -a 256 "$release_dir/images.tar.gz" > "$release_dir/images.sha256"
printf 'Release bundle: %s\n' "$release_dir"
