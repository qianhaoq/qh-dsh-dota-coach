# Changelog

## 0.6.3 — A2UI replay review

- AI-authored A2UI v0.9.1 compositions for phase reports and follow-up answers, with a validated Dota review catalog and a React renderer.
- Open a linked workspace for tactical replay, timestamp seeking, recorded choices, alternatives, resource prerequisites and supporting records; inspect the ten-player match scoreboard in the same view.
- Cached reviews receive a separately persisted presentation without regenerating their analysis. Unsupported UI falls back to verified report cards.
- Strict component/reference/action validation, bounded trees and safe data paths. No model-generated HTML or executable frontend code.

## 0.5.0 — Interactive reading cards

- Show one decision per compact card with switchable action, advice and outcome views. Open full reasoning, prerequisites, evidence or replay only when requested.
- Fold phase narratives and practice editing; keep essential resource conditions visible as a clear action. Preserve full existing reports without regenerating them.
- Show short answer cards first, with longer explanations on demand. Request concise conclusions and at most three action steps from the model.
- Extract legacy previews at complete sentence boundaries, preserving negations, conditions and numeric precision; never silently cut a tactical prerequisite.

## 0.4.1 — Complete match review and continued coaching

- Choose a recent match or enter its match/replay ID once. Automatically fetch, parse and analyze it; show the complete conclusions when every phase is ready. Open cached reports without regeneration and resume interrupted preparation.
- Replace the ornate workspace with a graphite interface, a single Dota red accent, consistent line icons, responsive phase navigation and replay details on demand.
- Cover duration-aware phases with recorded actions, decision-time resource constraints, conditional alternatives, measured outcomes and explicit tradeoffs. Persist focus, risk preference, detail level and optional intention.
- Compute cooldown, mana, control, charge and inventory constraints before model analysis. Keep healing sources and death/respawn windows separate from HP changes, and validate citations per decision.
- Discuss the whole match, a phase or a moment inside the report. Explicit timestamps retrieve their own player-side scene; questions, replies and citations persist with the review.
- Deduplicate discussion submissions, preserve drafts, stop/retry individual answers and isolate reply failures from the completed report. Give conversation and practice panels distinct React keys.
- Recover from local DSH transport failures with readable connection state and canonical progress restoration. Preserve previous notes, reviews and one adopted practice goal per review.

## 0.2.1

- Constrain question choices to explicit intention categories, preventing unverified visibility and ability-use instructions from being presented as player intentions. Existing unanswered sessions receive safe localized intent labels.

## 0.2.0

- Replace the primary dashboard with an immersive Coach / Journal workspace, preserving source management and advanced tools.
- Add durable guided sessions, evidence-linked explanations, question-first review, correction, resume, completed-moment revisits and an editable single practice card.
- Reuse DSH model routes through one shared bridge for coaching and MemOS, without separate model credentials.
- Add a v3 native-clock tactical index with HP/mana, inventory, cooldowns, unit-state flags, combat events and ward lifecycle, stored in bounded compressed windows.
- Gate omniscient scenes until after answering; preserve unknown visibility and suppress unobservable enemy states. Combat-event flags do not establish continuous unit vision.
- Preserve existing records and legacy traces, validate citations/time checks, deduplicate checkins, and exclude games without a practice opportunity.

## 0.1.3

- Initialize the MemOS core explicitly and persist the DSH-owned memory configuration so health reports the active multilingual model.
- Set the memory namespace at bootstrap so repeating review learning after a worker reload finds the original trace.

## 0.1.2

- Dispatch source-provider calls through both the published single-call API and the batch API used by later DSH source builds, preserving scope, step admission and deferred context.
- Report the installed package version in `dota_status` instead of the prototype's hardcoded version.
- Cover model-visible title parameters before and after reload, evidence-linked note creation and denied source dispatch.
- Document profile activation and recovery from the prototype's invalid tool schema.

## 0.1.1

- Preserve original collection times separately for cached hero statistics, matchups and item popularity.
- Retrieve a review's training goal directly by its link, including records older than the 200-item list page.
- Make release installation acceptance infer the current package version.

## 0.1.0

- Evidence-linked source, knowledge, review and training records in SQLite with idempotent legacy backup/import.
- MemOS Local public core integration, multilingual local semantic retrieval, durable indexing and candidate experience learning through DSH's model.
- Twelve official tools, generated Typert Remote and four embedded React tabs sharing one Host service.
- Identity-aware replay extraction, building-ID alignment and explicit unknown ward lifecycle.
- Bounded atomic replay downloads, owned cancellation and reload cleanup.
- Platform packages, bundled runtime dependencies, MIT license and synthetic-fixture CI.

Migration from the prototype: readable `source_record_id` is required for new knowledge; SQLite owns new records. Unknown legacy sources remain unverified. Failed alignment no longer merges positions. The default personal account and path-based host dependency fallback are removed.
