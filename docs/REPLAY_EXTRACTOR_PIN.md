# Reproducible replay extractor pin

The Linux amd64 static extractor used by the site's offline async acceptance run
is built from coach source commit
`aa67b52d70d43a8dd2057fadb59061c4532f69ea`, based on merged main
`2ef250f73b6459ea0cdc0c593a9e85de2e1d6aee`.

Measured local binary SHA-256:

```text
e7de32e0c115618d0f17dc7074c55f1a66037eabec9ddef6f9db623d5ce4c18c  dota-extract
```

This is a locally built artifact checksum, **not** a pushed image or registry
digest. Two local builds (before and after committing the same source) produced
the same bytes. No image was built/pushed and no official replay CDN was probed.
The site acceptance run injected the already-held 908 compressed bytes.

Reproduce from a clean checkout of the pinned source:

```bash
scripts/build-replay-extractor.sh /tmp/replay-extractor
cd /tmp/replay-extractor
sha256sum -c dota-extract.sha256
file dota-extract
```

The script fixes Go `1.27.3`, `CGO_ENABLED=0`, `GOOS=linux`, `GOARCH=amd64`,
`-mod=readonly`, `-trimpath`, `-buildvcs=false`, and empty build ID, and strips
symbols/debug tables. Go module versions/checksums remain pinned in `go.mod`
and `go.sum`. Use the same Go toolchain; dependency/toolchain caches or an
approved module mirror are needed on an offline build host. No CDN replay
access is part of the build.

The output includes `dota-extract.sha256` and `build-source.txt`. Verify both
against the reviewed pin before supplying the binary as the site's
`Dockerfile.replay-worker` `EXTRACTOR_PATH` build argument. Store the source
commit and binary SHA separately from the eventual container image digest.
Changing Go, dependencies, flags or source requires a fresh measured SHA and
contract tests; never silently replace a pinned binary.

Uncompressed input is reported as `format: raw`, aligned with the site enum.
Older binaries emitting `dem` are normalized by the site adapter. zstd/bzip2
content sniffing remains independent of filenames. Existing tests plus the raw
format assertion exercise this contract. Trace v4 retains extractor match ID,
slot/hero metadata and horn-relative pause-adjusted clock semantics.

Validation: `go test ./...` in `packages/coach/go`; script build and checksum
comparison; the site offline submit/worker QA against existing 908 bytes.
