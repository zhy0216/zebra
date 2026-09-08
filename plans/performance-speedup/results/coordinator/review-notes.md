# Coordinator review checklist
Original master f3263289; production baseline a856cab. Only plans differ at start.
Routing: Codex gpt-6-astra; 01/02/04/05 max, 03/06 xhigh. All inherit saved default.
README explicit integration order overrides finish-order default: 01, then 02/03/04/05 serial integration, then 06.
Workload lock wrapper applies to coordinator checks too. Never overlap measurements with queue checks/builds/install.
01 review: absolute module graph (including workspace aliases), separate processes, source and harness hashes, behavior-only means no timing loop; fresh consumed inputs; all original HTTP fixtures; failure cleanup; fixed A/A variability rules and load exclusions, complete raw data, actual Bun 1.4.0 and historical gate outcome.
02 review: parsePath normalization exactly matches splitPath; empty root and slash-only inputs; arbitrary HTTP methods; method fallback even with static index; fresh null-prototype params; bounded registration memory and independent costs.
03 review: content-type header snapshot including boundary case; signal raw reassignment and assignability of public fields; abort before read; helper errors and limits.
04 review: active stack vs cache-hit ordering when factories mutate bindings/scopes; falsy cached values; nearest scope; current binding lookup; disposal of resources created during cleanup.
05 review: thenable assimilation and synchronous exceptions; promise boundary and next guard; no boot-time listener snapshot; completion hooks/errors/cookies and HEAD cancel; deadline and drain accounting.
Each task: one commit, scope-only diff, archived only fully accepted, clean/no rebase; same agent rebases master then coordinator runs root typecheck/lint/test and diff-check before ff-only integration. Record per-task evidence.
06: full gates current AND minimum per CONTRIBUTING (frozen install/typecheck/lint/build/test/package smoke/core coverage/docs/browser bundles), final paired components+all HTTP, unchanged bench gate both runtime results separated. Reuse valid checks on unchanged final production. No unsupported global HTTP claim.
Cleanup: idle agent /exit, close only recorded workspace, git worktree remove, branch -d. Keep baseline archive until final measurements then remove only own resources. Append execution results and commit final plan documentation on master.
