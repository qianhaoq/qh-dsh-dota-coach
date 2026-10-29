# Redistributable fixtures

All match, account and event records in this directory are synthetic, created for this project's tests and distributed under the repository MIT license. Account numbers are placeholders. Hero/item constants are a small public Dota vocabulary and carry no player identity.

`tiny.dem` is a handcrafted 19-byte Source 2 header with a Stop message; it contains no match, player or entity data. `tiny.dem.bz2` compresses that exact byte sequence. Go tests generate zstd containers from synthetic bytes. The tiny demo verifies portable container and parser startup only; it does not stand in for full replay entity validation.

Actual OpenDota, video and full replay acceptance is an optional release smoke. Those downloads stay in temporary local directories, are removed on exit, and are never uploaded as CI artifacts.
