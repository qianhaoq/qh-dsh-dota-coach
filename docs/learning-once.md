# Bounded local learning

Build with `pnpm build`, then run one task through the installed, exactly pinned dsh launcher:

```sh
node scripts/learn-once.mjs https://www.reddit.com/r/DotA2/comments/POST_ID/ /absolute/new-run-directory
```

Use a real lowercase Reddit post ID and a new state directory whose parent exists. The script creates an isolated headless profile, mounts the built coach and its optional `./public-source` provider, invokes dsh once and exits within 95 seconds. It uses the ordinary runtime model configuration internally; it has no model credentials or agent loop of its own. The optional provider is independent of coaching: other profiles may insert `@qianhaoq/dsh-dota-coach/public-source` to install `reddit_json`. Bili/YouTube seams still require their own installed providers; a title or search hit is not a transcript.

The learning profile's host policy permits at most twelve calls, one source fetch, one anonymous provider read, one fact candidate and KB reads. It denies export, principles, replay parsing, shell, scheduling and other tools. Source URL is bound to the requested post. The process deadline also bounds runtime failure. No recurring job is created. An external scheduler can invoke this command with a fresh directory after separate operational approval.

The source provider fetches only one public Reddit post body, without cookies, credentials or redirects. It retains the full body, source URL, capture time, publication time when available, evidence level, content hash and HTTP response hash. Multiple patch mentions yield `unknown`, not an inferred upgrade. Deleted/private/HTML/oversized material fails closed. Forum posts are author claims, not independently verified game mechanics. Videos still need full subtitles from the separate providers.

For a separate official provenance demonstration, the same launcher also accepts an exact English patch feed URL:

```sh
node scripts/learn-once.mjs 'https://www.dota2.com/datafeed/patchnotes?version=7.41f&language=english' /absolute/new-official-run-directory
```

The optional `official_patch_json` tool retains the complete structured response, collection time and hashes. It requires `success: true`, both exact patch identity fields, localized notes, and the fixed public endpoint; redirects, credentials, extra query parameters and oversized responses are rejected. This mode asks for one patch-identity reference candidate with no hero or tactical advice. Balance notes cannot answer fight/farm decisions, optimal builds or lane abandonment, and do not establish the patch of any match. The datafeed URL is deliberately outside the public tactical snapshot's article/video routes, so this reference is not promoted to site coaching. This demonstration is separate from historical forum advice and does not upgrade it to a newer patch.

After a curator reads the full material, `dota_kb` action `export` with explicit note IDs produces `export/site/knowledge.v1.json`. This is a separate action outside the learning profile. Promotion rechecks the durable body hash, source identity, public resource URL, excerpt status, patch and hero consistency. It does not certify the advice as true. Imported legacy material can have unknown completeness; this remains visible. Export only a short contextual summary, never raw bodies, user corpora or session records. Site imports schema `dota2.ai/site-knowledge@1`, rejects unsafe metadata, and only uses exact patch facts for the same hero. `7.41`, `7.41f` and OpenDota ID `60` are different values; no suffix mapping is inferred.

On failure, inspect `runtime.jsonl`, `diagnostics.log`, and the ordinary dsh session under the new directory. Some rc.3 headless failures leave an empty stdout projection; the persisted session is authoritative. A transport failure before tools means zero agent learning, regardless of tool-level offline tests. Do not copy credentials into evidence or enable new paid providers to work around failures.

The independently admitted tactical text endpoint is the public Steam Community guide `https://steamcommunity.com/sharedfiles/filedetails/?id=827490913`. Pass that exact URL to the launcher to use `steam_support_guide`. This provider accepts only that one URL, omits credentials, rejects redirects, limits bytes/time, checks Dota/title identity and requires all ten balanced guide sections. It never fetches images, embeds, comments or linked pages. It hashes the extracted full text and the response separately. Publication time is currently unknown; capture time is recorded. Its patch is deliberately `unknown`: a linked video's patch label is not the guide's patch identity. General support advice establishes no hero-specific applicability.

This run can create a short **candidate**, not publish it. A human curator must review the original candidate and actual body, record their identity, decision and rationale, and resolve attribution/permission and applicability before separately selecting note IDs for export. No republication permission has been established for this guide: do not export its raw body or long quotations. Unknown-patch facts fail export. Version-independent promotion requires a separate explicit curator rationale grounded in the content; a model or coding agent must not impersonate that human decision. The bounded runtime denies promotion even if another plugin installs the tool. Pending review is a real stop condition, not a completed end-to-end acceptance.
