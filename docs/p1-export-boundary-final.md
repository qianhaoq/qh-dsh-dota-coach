# P1 export boundary fix — 2026-11-09

Independent QA found that explicit legacy note IDs bypassed ontology curation: an unknown-patch principle with needs_recheck=false could enter the public snapshot.

buildSiteSnapshot now rejects every legacy principle. Only ontology principles satisfying the existing active + version_independent + curation + exportable checks can reach public summary/link export. dota_kb export shares this boundary and validates before writing. Host-authorized promotion and the approved historical principle remain unchanged. Fact exact-patch, hero, source hash and public provenance checks remain unchanged; no other records received curation.

Regression coverage in tests/site-export.test.ts creates an uncurated unknown-patch legacy principle with needs_recheck=false, rejects its direct and dota_kb exports, and verifies that a failed export preserves the previous snapshot. The existing host-authorized ontology promotion test still exports the short principle with attribution/link and survives reopen. General provenance fixtures now use exact-patch facts because uncurated principles are no longer valid positive export fixtures.

Validation:
- COREPACK_HOME=/tmp/ontology-corepack pnpm exec tsx --test tests/site-export.test.ts tests/ontology.test.ts — 11/11 passed.
- COREPACK_HOME=/tmp/ontology-corepack pnpm check — host/client typecheck, build and 81/81 tests passed.
- git diff --check — passed.

Logs: workspace evidence/p1-targeted.log and evidence/p1-coach-check.log. Site code/data were untouched, so site checks were not repeated. This records implementation verification, not independent QA approval. Both PRs remain draft + no-auto-merge; no qa-passed, merge, deployment, credentials access or #115 changes.
