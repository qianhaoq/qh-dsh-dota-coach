#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
output_dir=${1:-"$repo_root/dist/replay-extractor"}
mkdir -p "$output_dir"
output_dir=$(cd -- "$output_dir" && pwd)
cd "$repo_root/packages/coach/go"
export CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOTOOLCHAIN=go1.27.3
# No absolute source paths, timestamp, or working-tree-dependent VCS stamp.
go build -mod=readonly -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o "$output_dir/dota-extract" .
cd "$output_dir"
sha256sum dota-extract > dota-extract.sha256
printf 'source_commit=%s\n' "$(git -C "$repo_root" rev-parse HEAD)" > build-source.txt
cat dota-extract.sha256
