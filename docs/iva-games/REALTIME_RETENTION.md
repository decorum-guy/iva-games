# Realtime image retention and actual-store preflight

This implements the image compatibility contract in [REALTIME_PLATFORM §14](../game-design/REALTIME_PLATFORM.md). The evidence below comes from repository code, actual temporary SQLite databases and explicitly mocked registry/host commands. It does not assert that these host changes have been applied or that the new Docker checks have run successfully.

## Saved versions determine compatibility

`GET /api/realtime/v1/compatibility` reads the actual writer store through its `compatibilityManifests` operation. Its response has exactly four fields:

| Field | Meaning |
| --- | --- |
| `format` | Inventory schema `1`. |
| `buildRevision` | Full 40-character revision of the currently running image. |
| `current` | Current `runtime` and `client` SHA-256 content IDs. |
| `manifests` | Sorted, deduplicated saved manifest objects. |

Each manifest contains exactly `runtime`, `rules`, `content`, `protocol`, `serializer`, `bot`, `map`, `physics`, `prng` and `client`. The SQL predicate is the same as the resumable record list: `expires_at > now OR phase NOT IN ('finished', 'abandoned')`. Thus an expired active record remains covered until the runtime gives it a terminal outcome, while an expired terminal record does not require an executable worker for return.

The endpoint has `Cache-Control: no-store`. It exposes no match IDs, participant IDs, roster, owner hash, world, progress, statistics, tokens or timestamps. It reconstructs the allowed schema rather than returning record JSON. An unexpected manifest field or invalid identity makes the request fail closed.

## Build collector and recursive inheritance

`deploy/iva-games/prepare-realtime-image.py` requests the fixed public inventory URL without credentials. Redirects, malformed JSON, invalid schema, oversized responses, auth/rate-limit/server errors and network failures fail preparation. A non-JSON response or HTTP 404 is not evidence of an empty runtime store.

The only bootstrap path recognizes the independently observed legacy public portal. It requires all of these positive checks, each through a bounded, same-URL, non-redirecting public GET:

- The portal root is HTTP 200 `text/html` and matches the reviewed canonical template SHA-256 `b0b243d662c02857c7b822311be4e3c0a6264acc916f6c8488eb6b0a573c0e10`. Only the eight-character Vite filename tokens in the two exact tags below may vary.
- Compatibility is either an explicit 404 or HTTP 200 HTML byte-identical to that root.
- `/api/realtime/v1/health` is also HTTP 200 HTML byte-identical to the root. An actual realtime health response blocks this legacy path.
- `/health/live` is JSON with exactly `ok: true` and `service: "iva-platform"`.
- `/api/platform/v1/games` matches the explicit pre-realtime catalogue: available `platform-lab` (`lab-1`) and `district` (`district@0.4` / `district-territorial@1`), three unavailable chess registrations and planned `harbor`. Unknown, duplicate or additional games/fields, changed statuses or different active versions fail this proof.

Raw responses are compared **before** normalization: root and realtime health must be byte-identical, and an HTTP 200 compatibility body must equal both. Different simultaneous portal builds fail even when their canonical templates agree. The existing explicit-404 path still requires the root/health equality and every other positive proof; the 404 itself proves nothing about saved data.

Normalization requires exactly one match for each complete byte pattern:

```text
<script type="module" crossorigin src="/assets/index-([A-Za-z0-9_-]{8})\.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-([A-Za-z0-9_-]{8})\.css">
```

Only the two captured eight-byte tokens become `00000000` for hashing. All other HTML bytes, tag order, attributes, paths, origins and whitespace remain pinned. Duplicate/missing tags, invalid token length/alphabet, query strings and fragments fail. The original R4 full-body SHA-256 was `b0af43f9cda37d8dc17f8613df907719e4f6b537fa92830c9410066df7e7e9b5`; its historical evidence remains unchanged.

Only that recognized public legacy response produces an explicit empty bootstrap **build input**, with `bootstrapEvidence: "recognized-public-legacy-portal-v1"` in the collector's sanitized summary. It proves the observed public legacy routing, **not physical absence of saved server data**. Any different portal template or catalogue requires fresh review; an ordinary change of the two valid asset tokens does not. The existing actual-volume gate remains mandatory and rejects any saved dependency missing from the candidate image.

For a nonempty inventory the collector:

1. Resolves `ghcr.io/decorum-guy/iva-games-realtime:<buildRevision>` to a SHA-256 image digest.
2. Checks the immutable image's OCI source and revision labels against this repository and the exact inventory revision.
3. Pulls by `repository@sha256:…`, then checks the local image labels again.
4. Creates its own uniquely named, never-started container with networking disabled and copies `/app/retention` from it.
5. Verifies the copied seal, current identities, revision and coverage of every inventory manifest. The image build subsequently verifies every byte and reader.
6. Atomically produces the build input. A preexisting output directory is not silently replaced. The collector removes only its own temporary container and staging directory.

The copied bundle contains the previous image's current artifacts **and all of its retained ancestors**. Even if no saved room used the previous current version at inventory time, that version is carried: a room created before drain must still be covered. Nothing is pruned by an N−1 policy. This implementation conservatively retains the whole chain; it has no garbage collector. Image size can grow across releases. A later pruning mechanism must prove that it preserves every still-active or resumable dependency.

The Docker build uses a [named context](https://docs.docker.com/build/concepts/context/#named-contexts) so repository ignore rules cannot silently omit an inherited client asset:

```sh
python3 -B deploy/iva-games/prepare-realtime-image.py
docker build --file Dockerfile.realtime \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-context realtime-retained=deploy/iva-games/retained-input/current \
  --tag iva-games-realtime:checked .
```

The release-image workflow performs collection in both its check and publish jobs using the existing registry token. It keeps immutable revision tags, the existing deploy lock and the existing SSH command interface. No new SSH permission, host key or administrative path is introduced. The collector is included in realtime image input fingerprints; chess and platform input selection remain separate.

## Sealed image and reader registry

`retention-cli.js seal` runs after compiling the current server and client. The result contains `bundle.json`, `artifacts/<runtime-hash>/` and `content/<client-hash>/`. The seal is a SHA-256 of canonical metadata. Every declared directory and file is checked independently; a seal alone is insufficient. Unlisted files, symbolic links, missing archives, changed bytes, different source identities and malformed registries are rejected.

Current runtime identity includes the established `main.js`, `simulation-worker.js` and `store-worker.js` entries, all additional root JavaScript entries (including `checkpoint-worker.js` and `retention-cli.js`) and every executable dependency chunk. Original format-1 archives retain their original ordered file inventory and hash; they are not rewritten to pretend to contain a new worker.

Client identity includes all recursively collected regular files, with no extension allowlist. Images, audio, fonts, JavaScript module workers and nested asset directories participate in the content hash. Copy and preflight verification re-read bytes even if the HTTP content cache previously validated that ID.

The explicit registry currently accepts:

| Reader dimension | Accepted value |
| --- | --- |
| Store reader | `realtime-sqlite-record-1`, SQLite `user_version=0`, `application_id=0` and the required existing columns. |
| Rules / content | `forpost-0.1` / `forpost-content-1`. |
| Protocol / serializer | `1` / `forpost-world-1`. |
| Bot / map | `forpost-bot-0.1` / `forpost-maps-0.1`. |
| Physics / PRNG | `forpost-kinematic-1` / `xorshift32-1`. |

Additive tables and columns do not invalidate the existing store reader. The startup queue table is additive. Unknown store versions or game serializer versions fail even if the executable bytes happen to be present. The image's registry must match its compiled `SUPPORTED_READERS`; no future serializer or second game reader is claimed.

The image retains `USER node`. Its bundle is copied with node ownership, preserving private archive permissions. `REALTIME_RETENTION_DIRECTORY=/app/retention` makes startup verify the bundle against the actual current code/client and then check the actual store before constructing the listening service. The check also runs when `NODE_ENV=test`; test mode does not bypass a configured bundle. Production executes and serves image-bundle archives, so persistent archives cannot conceal an incomplete candidate image. Existing persistent archives are left untouched.

## Final host gate

`activation.py` first successfully drains the existing realtime service. Before stopping or replacing that service it:

1. Validates the candidate's fixed repository, immutable digest and OCI source/revision labels.
2. Resolves the explicitly configured external realtime volume from the actual release's Compose configuration.
3. Checks that this named volume exists, then checks the existing container's `/data` mount points to that exact volume. A typo must not cause Docker to create an empty substitute.
4. Starts a unique verifier from the candidate image with `--network none`, `--read-only`, a read-only `volume-nocopy` mount, no capabilities and `no-new-privileges`.
5. Runs `retention-cli.js check-store` against `/data/realtime.sqlite`. This opens SQLite read-only, checks database integrity/schema and reads a transactional snapshot of the required manifest set. It constructs no writer and performs no schema migration.
6. Requires a successful report with the candidate revision and sealed bundle identity before proceeding to backup and service replacement.

If drain or preflight fails, promotion attempts to resume the previous service and does not replace it. Initial activation also resumes an already-running service if its preflight or startup fails. The verifier cleanup targets only the unique verifier container; it never removes the data volume or service container.

The first provisioning path explicitly allows an absent database only when its **actual mounted parent directory exists and is completely empty**. An existing incompatible store, an orphaned WAL or any other directory content still fails. Neither HTTP 404 nor recognized legacy-portal bootstrap during build can grant this permission. Startup repeats the same actual-store checks before accepting new rooms.

## Rollback after candidate writes

An otherwise eligible realtime rollback drains a running candidate, then runs the **previous image's** verifier against the current persistent store. It must cover every format and exact runtime/client dependency written so far. A previous image that lacks the new artifact is rejected; source compatibility fingerprints cannot substitute for this test. On rejection the running candidate is resumed where possible and pending deployment evidence is retained for a compatible forward fix.

The database is never restored from the pre-update backup to make old code fit. Existing backups remain recovery evidence under the established backup protocol. The compatibility fingerprint requirements for unrelated services are unchanged.

## Verification and boundaries

### R4 collector defect and narrow correction

CI build `51748ae944081b5a33a08a630b42b31310b09546` reached the old collector in realtime-image job `141062235811` and hour-profile job `141062235867`. Both stopped with `Unexpected compatibility response` **before Docker build**. No image smoke or hour workload ran in those jobs.

Ordinary unauthenticated public reads independently confirmed the cause: `/api/realtime/v1/compatibility`, `/api/realtime/v1/health` and `/` each returned HTTP 200, `text/html; charset=utf-8`, the same 598 bytes and the SHA-256 pinned above. The page is the existing portal shell. `/health/live` returned the exact platform JSON, and the public catalogue returned the six legacy entries described above. One separate `/health/ready` request timed out; that request is not evidence and is not accepted as a fallback.

The corrected collector narrows both HTML and the former bare-404 path to the positive proof above. The JSON inventory/image inheritance path, sealed archive readers, actual host-volume preflight and rollback checks are unchanged. Focused local verification passed 15 Python unit tests and AST syntax for both changed Python files. The observed 200-HTML response is included as an exact regression fixture; fixture-based success is not Docker or host acceptance. Unknown identical HTML, actual realtime health, new registrations, auth/network errors at every proof step, redirects, oversized responses and incomplete proof remain errors.

Executed local checks on 28 November 2026, before the parent's combined build:

| Command/check | Actual result |
| --- | --- |
| `npx vitest run --config apps/realtime-server/vitest.config.ts tests/artifacts.test.ts tests/content.test.ts tests/retention.test.ts --maxWorkers=1` | 11 tests passed in 3 files; final focused run 1.72 s. |
| `python3 -B -m unittest test_activation test_realtime_retention test_realtime_preflight` from `deploy/iva-games` | 49 tests passed; final focused run 2.266 s. |
| `npx tsc --noEmit -p tsconfig.json` | Passed at the retention implementation checkpoint. The subsequent change added a typed client-worker test and Python/shell/docs; the combined final check remains the parent's gate. |
| Focused ESLint on the changed retention, archive, main/server, Vite and test TypeScript files | Passed after the final focused tests were added. |
| Release workflow YAML parse, `bash -n deploy/iva-games/verify-realtime-image.sh`, `git diff --check` | Passed. |
| Actual new image build/container smoke, actual host preflight and public deployment | Not executed by this subtask; pending combined CI/host acceptance. |

Test sources cover these concrete cases:

| Source | Checked behavior |
| --- | --- |
| `apps/realtime-server/tests/retention.test.ts` | Real temporary SQLite manifest selection and privacy; three-generation recursive bundle; absent dependencies; unsafe rollback; bootstrap cannot bypass an existing store; explicit reader failure; byte tamper and cached-content revalidation; source revision mismatch; no DB/WAL byte changes during a successful read-only check. |
| `apps/realtime-server/tests/artifacts.test.ts` | Exact archive identities and legacy format-1 compatibility when adding new current workers. |
| `apps/realtime-server/tests/content.test.ts` | Current/retained client isolation; nested worker bytes affect identity and survive recursive copying. |
| `deploy/iva-games/test_realtime_retention.py` | HTTP/registry/container calls are mocked: bootstrap versus errors, provenance, immutable digest use, recursive bundle coverage, malformed metadata, own-resource cleanup and refusal to replace prior evidence. |
| `deploy/iva-games/test_realtime_preflight.py` | Docker/Compose calls are mocked: actual volume identity, read-only/no-network arguments, source labels, explicit first provisioning and cleanup after failure. |
| `deploy/iva-games/test_activation.py` | Existing deployment isolation plus failed drain/preflight/startup resume paths and compatibility-checked rollback without DB restoration. |

`verify-realtime-image.sh` now requires the real candidate container to check its empty isolated volume before first startup, publish a sanitized inventory matching real SQLite after creating a practice match, pass an independent read-only verifier after drain, then restart and verify the retained match and store again. The script is part of the existing image job. Merely adding that script is not a report of a successful Docker run.

No production host files, Docker volumes, SSH keys or permissions were changed by this implementation. Applying the updated host activation code remains an administrative integration step at the existing access boundary. Public deployment, final browser acceptance and measured production capacity remain separate gates.

### R5 collector fingerprint defect and canonical correction

R5 checked merge `9ebeb9e75054876409d81e615743254a1ba976ac`, tree `7b3bfe3688c52a5da1833e18a288fe7cd75d6db5` (PR head `defb53049ffc594a42c01eb61cdc0a8667f4d756`). [Realtime image job 141073353167](https://github.com/decorum-guy/iva-games/actions/runs/46175575334/job/141073353167) and [hour job 141073352875](https://github.com/decorum-guy/iva-games/actions/runs/46175575314/job/141073352875) both reached the new legacy proof but stopped at `Unrecognized legacy portal response`. Docker builds, container checks and the hour workload were skipped. Those jobs did not produce new runtime/client image identities or a load result.

A separate actual public read after the failure returned identical 598-byte bodies at root, compatibility and realtime health, with raw SHA-256 `3054b8f086c2457bf9b5be8a5af65a302e846b3effd23040fa19391fa3bfbc10`. Comparing that body with the saved R4 observation proved that only bytes `[438,446)` (JS token `gq6eTcFQ` → `CdXmSpou`) and `[520,528)` (CSS token `BhwHI1bQ` → `DBb4t3H1`) differed. Every other byte was equal. The failed CI log did not retain its HTTP body; the independently observed later response must not be presented as that missing body.

The canonical rule above fixes this verified rebuild variation without accepting arbitrary HTML. Both actual observations are regression fixtures. Additional synthetic filenames test the permitted alphabet; they are not claimed deployed builds. Negative cases cover semantic/structure changes, duplicate/missing/reordered tags, path/origin changes, invalid length/alphabet and inconsistent raw bodies. Existing JSON inventory, auth/network/redirect refusal, exact health/catalogue checks, four-field build input, recursive archive validation and actual host-volume gates remain intact.

Focused verification after this correction passed **20 Python tests**, AST syntax for both Python files and `git diff --check`. A new ordinary unauthenticated `fetch_inventory()` completed successfully in **20.250 seconds**, through all five real public GETs: it positively recognized the legacy response and returned no realtime inventory. It did not generate build input or run Docker, host preflight, deployment or a load test. Sanitized source and execution evidence is in [realtime-canonical-bootstrap-fix-2026-11-28.json](evidence/realtime-canonical-bootstrap-fix-2026-11-28.json). A new image/CI run remains required.
