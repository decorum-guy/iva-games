# Capacity evidence and remaining acceptance

Status: **capacity not accepted**. Two pairs of one-room 60-second probes ran
on frozen commits `848c626481a8ada589fb7e3d742af1f47d028e73` and
`f3a8347a11241ffdea677ff5ec391f227907cb29`. In both pairs, six humans passed the
short gates; one human plus five bots failed step p99. No hour or retained
heavy-scene run was started. A subsequent single CPU diagnostic identified a
large serialization cost, without establishing the cause of those p99 failures.
The byte-compatible serialization correction passed targeted checks but awaits
a new compiled freeze and measurement without browser/profiler workload.

This review uses the recorded [five historical calibrations](load-calibrations.json),
the local R05 reports and diagnostic identified below, runtime/harness source and read-only
resource inspection. It is not a VPS
measurement. The requirements remain [REALTIME_PLATFORM §13 and §16](../../../docs/game-design/REALTIME_PLATFORM.md):
step p99 strictly below half the fixed step interval, commit p99 at most 50 ms,
30% compute headroom, 25% memory headroom, no overflowing queues, one hour at the
declared capacity, and a repeat with simultaneous heavy work.

## What the existing measurements establish

Each of the first five recorded runs used two rooms and twelve independent human protocol
clients, with ten seconds of warmup. None passed the complete local gate.

| Run | Measured seconds | Step p99 upper bound, ms | Commit p99 upper bound, ms | Peak server RSS, MiB | Maximum worker ELU | Maximum gateway ELU | Overload observed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 01 | 30.059 | 4 | 40 | 910.965 | 78.063% | 89.957% | Yes |
| 02 | 30.057 | 5 | 50 | 555.789 | 61.500% | 73.048% | No |
| 03 | 30.011 | 10 | 50 | 595.664 | 73.509% | 55.183% | Yes |
| 04 | 60.026 | 15 | 75 | 606.414 | 79.762% | 64.684% | Yes |
| 05 | 60.085 | 10 | 40 | 595.000 | 70.354% | 57.826% | No |

Artifacts/content changed across the series. Run 04 overlapped other physical
tests. Run 05 used an agreed pause in those tests, which does not establish
exclusive machine allocation. Its physics rate was approximately 59.97 steps
per second per room; the step-p99/headroom failure still applies. Stored step
histograms already have boundaries at 7, 8, 8.333333333333334, 9 and 10 ms.
The reported 10 ms bucket means **(9, 10] ms**; it cannot be relabelled as a
passing value below 8.333 ms.

The fifth run's sampled snapshot rate was about 17.73 Hz per connection over
the final 55 seconds. The gateway uses an independent 50 ms timer; it has no
`now + 50` deadline that quantizes snapshot publication to the physics pump.
It skips a connection while its previous snapshot request remains pending.
Recorded request durations include worker queue wait, projection/delta work,
serialization and delivery to the gateway; recent p99 values were about
77–214 ms, with a lifetime maximum of 318.472 ms. Twelve requests were pending
in seven of twelve samples. This supports queue/work pressure as an explanation;
it does not identify a deterministic pacing defect or a particular CPU hot
function. No pacing or histogram change follows from these data.

## R05 one-room preflight: completed, capacity still open

Frozen build `848c626481a8-74f5e12d10f0` has aggregate SHA-256
`74f5e12d10f0c96d670258a2cac56e7715747dcae6114911164c0129aca4423c`.
Before launch, all 325 served/compiled files and their exact file sets matched
`.qa/tyaga/R05-build-frozen.json`. Both fresh isolated runs used the unmodified
compiled output, Ridge, ten seconds of warmup, ordinary 30 Hz human inputs and
durable appearance actions. No renderer or separate local physics test ran
concurrently. All nine runtime threads were checked on CPUs 0–1 and all seven
generator threads on CPUs 2–8; neither mask is an exclusive host reservation.

| Profile | Measured seconds / steps | Whole-window step p99 upper, ms | Commit p99 upper, ms | Peak RSS, MiB | Maximum process CPU / two-CPU budget | Maximum worker / gateway ELU | Short result |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Six human clients | 60.019 / 3601 | 7 | 20 | 675.578 | 43.180% | 63.067% / 28.384% | PASS |
| One human, five bots | 60.013 / 3602 | 20 | 25 | 559.961 | 33.755% | 50.243% / 9.845% | FAIL: step p99 |

The bots' whole-window p99 is in **(16.667, 20] ms**, which fails the unchanged
strict limit of 8.333333333333334 ms. Its separate last-2,048-step sample has
exact p99 24.651636 ms, and its process-lifetime maximum is 82.915538 ms; these
are different windows, not interchangeable quantiles. This run does not
separate bot planning, physics, allocation/GC or scheduling costs, so no cause
is assigned. Lower aggregate CPU use does not cancel a failed tail-latency gate.

Both probes reported zero protocol/rate-limit/queue-overflow errors, no overload
frames and four durable action acknowledgements per human client. Human
controllers physically moved; the harness does not record individual bot
travel as a separate acceptance assertion. Both child runtimes drained with
exit 0. The bots harness returned 1 for the metric failure, not a server crash.
Published-world-age p99 bounds were 30/25 ms (humans/bots); uncommitted-age p99
bounds were 50/100 ms. Over the sampled final approximately 55 seconds, sent
full/delta rates were 19.552/18.967 Hz per connected human. These rates exclude
the first five measured seconds and do not measure browser rendering.

Actual server health and match-start manifests, identical across both runs:

- Runtime: `tyaga-runtime@1:949ee96dc027b6042b45a9a55e948b65430c0bfac7de179dc5be9defcc431952`.
- Client: `65bc616c33132399fd7a52f4d34d670e1c272775b1a3d3e78558a52a0ee3bc47`.
- Physics: `rapier3d-0.21.0:17cfa80eebd8de0291b948496dbffba724b98b489687f8272ca236a7bbf1dd4b:tyaga-solver-12-4-rope64-v9`.
- Rules `tyaga@0.1`, content `tyaga-expedition@4`, bots `tyaga-bots@2`, serializer `tyaga-world@1`, protocol `iva-realtime@1`; 60 Hz step / 20 Hz snapshot configuration.

Local evidence is preserved in `.qa/realtime-load/r05-n1-preflight-summary.json`,
`r05-preflight-artifact.json`, and the `r05-n1-humans-60` / `r05-n1-bots-60`
directories beneath `.qa/realtime-load/` (reports, configuration, five-second
samples and runtime logs). No old result or database was replaced.

The same commit's [actual CI netem job](https://github.com/decorum-guy/iva-games/actions/runs/46177267482/job/141078691148)
passed 24/24 impairment profiles and 1/5/15-second 100% loss intervals, with
matching runtime/client hashes. Its [three-image workflow](https://github.com/decorum-guy/iva-games/actions/runs/46177267552)
also passed. Those independent results do not resolve the local bots-p99
failure or substitute for the unexecuted hour/heavy repeat. See the
[runtime README](../README.md#recorded-ci-evidence) for exact image/log evidence.

## Second preflight and scoped serialization correction

Commit `f3a8347a11241ffdea677ff5ec391f227907cb29` used frozen build
`f3a8347a1124-b000f0e55429`, aggregate SHA-256
`b000f0e55429c39cf54e1ee4a010c782401e332c4eaaa2d675d60f8116bf6a4b`.
All 325 files and complete file sets matched before running. The actual runtime
was `tyaga-runtime@1:d421c2aec4e299cb171ca303ca1df74263851ee50046b5e810fe1b0dbe4fad8c`;
client hash remained `65bc616c33132399fd7a52f4d34d670e1c272775b1a3d3e78558a52a0ee3bc47`.
Health/start identified solver `v10`, bots `@3`, content `@4`, 60 Hz physics and
20 Hz snapshots. Runtime threads used CPUs 0–1, generator 2–8, the same 1 GiB
reference, and no concurrent local renderer/physics test. Both new directories
preserve the first preflight's evidence.

| Profile | Measured seconds / steps | Whole-window step p99 upper, ms | Commit p99 upper, ms | Peak RSS, MiB | Maximum process CPU / two-CPU budget | Short result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Six human clients | 60.012 / 3600 | 8 | 20 | 617.836 | 45.216% | PASS |
| One human, five bots | 60.015 / 3601 | 10 | 20 | 584.633 | 32.021% | FAIL: step p99 |

The bots' p99 bucket is **(9, 10] ms**, above the strict 8.333333 ms requirement.
Separate last-2,048-step p99 values were 9.676266/10.408713 ms (humans/bots);
process maxima were 63.786115/84.934381 ms. These different windows are retained,
not substituted for the complete-window criterion. Both runs had no overload,
protocol/rate-limit or queue-overflow errors and child runtimes drained with
exit 0. Sent snapshots averaged 19.405/19.600 Hz over the sampled final roughly
55 seconds. Evidence: `.qa/realtime-load/r05-preflight-02-summary.json` and
`r05-preflight-02-n1-{humans,bots}-60` beneath `.qa/realtime-load/`. Heavy
preparation was not built; heavy/hour counts stayed zero after the failure.

One separately authorized **diagnostic** profiled the exact `f3a8347` archived
simulation worker: runtime CPUs 4–5, generator 6–7, 50 seconds plus warmup, with
a browser and another runtime active elsewhere on the shared executor.
Inspector sampled 35.119 seconds (28,670 samples). Of non-idle sample-weighted
time, synchronous persistence stacks occupied 59.78%, game `physicsStep` 23.16%,
bot public views 5.41%, bot decisions 1.76% and GC 2.84%. `groundPath` occupied
10.859 ms across the profile. `TyagaWorld.serialize` had 6,404.585 ms inclusive
and 5,087.300 ms self; SHA hashing had 1,525.475 ms inclusive. Inclusive values
overlap. GC observer events totalled 318.914 ms, maximum 25.058 ms, without an
exact correspondence to prior slow steps. Sample-weighted elapsed time is not
independently measured CPU time or per-step attribution. The step timer ends
before serialization/writer await, so this cost cannot simply be subtracted
from step p99; allocation/GC pressure is a hypothesis, not an established cause.

The final saved world contained 793,503 bytes, including 730,336 bytes of
physics base64 and 63,002 bytes of state. A private read-only proof preserved
exact bytes and stored SHA-256 for two snapshots and the initial checkpoint.
A short encoding-plus-SHA diagnostic on CPUs 4–5, 288 iterations per variant
in rotated order, measured 5.370 ms for the old encoder, 3.407 ms for framing
and 2.782 ms for framing plus a Buffer view. SHA cost includes deferred string
flattening; Rapier capture was outside this micro-diagnostic. Its 48.2% change
is not a simulation or p99 improvement, and the host browser remained active.

The approved source correction changes only `TyagaWorld.serialize` and a small
encoder helper: preserve JSON field order and escaped hash, insert the safe
Buffer-produced base64 directly, and avoid an extra copy of the fresh binary
snapshot. Game-state JSON, full physics content, SHA-256, envelope/schema,
writer barrier, persistence frequency and solver remain unchanged. Physics
`v10`, bots `@3` and serializer `tyaga-world@1` stay unchanged; a future compiled
worker obtains its own actual runtime digest.

Fourteen targeted tests passed on CPUs 4–5: all byte values/padding/nonzero
offsets; escaped Unicode/control characters/property order; real Rapier
legacy-byte restoration/replay; bot-controller restoration; and the runtime's
unpack receipt, crate mass and SQLite recovery. Game TypeScript and targeted
ESLint passed. Game source hash:
`bec106223d39317f92ee1c139ddf2f999f451d3900736e0a50eb77145312c970`.
No shared build or further capacity probe followed this correction. Raw profile,
GC and private proof: `.qa/realtime-load/r05-preflight-02-bots-cpuprofile/`.
Targeted log: `.qa/tyaga/serialization-optimization-01-tests.log`. Both prior
capacity failures remain unchanged; compiled remeasurement is still required.

## Resource reference and limits of the local gate

`cpuHeadroom30Percent` in the five historical reports is an **event-loop
utilization** check: the maximum measured five-second activity fraction of
either gateway or simulation worker must be at most 70%. ELU is not a physical
CPU allocation or a measurement of spare host CPU. The current harness names this
check `eventLoopHeadroom30Percent` and separately records process CPU
microseconds and `cpuCoreEquivalents`, including the runtime's threads.
Load-generator memory/CPU is separate and also recorded.

The recorded machine reported nine available logical CPUs and 10,451,427,328
bytes of RAM. A later read-only inspection still allowed affinity to CPUs 0–8,
but exposed no `cpu.max`, `cpu.stat`, `memory.max` or `memory.high` files at the
visible cgroup root. A guaranteed CPU quota and a dedicated memory allocation
are therefore **unknown**. The examples below use `--memory-mib 1024`, the same
explicit 1 GiB reference as the previous probes. Its RSS threshold is 768 MiB;
the option does not impose a container limit or claim that 1 GiB was allocated.

The R05 probes declared **two logical CPUs for the runtime**, with
`--server-cpus 0,1`. The harness launches only its own child through `taskset`,
verifies its actual process/thread masks at startup and every sample, and
requires the load generator to use disjoint CPUs. Its separate
`processCpuHeadroom30Percent` check uses:

`runtime process CPU microsecond delta / (wall-second delta × 1e6 × 2) < 0.70`.

Without an explicit verified CPU budget that check does not pass. The commands
pin the generator to CPUs 2–8; all masks and CPU samples are recorded. An actual
small Node child and worker confirmed inherited affinity in a focused test;
the two real-Rapier probes above then verified it for all runtime threads.

A passing local report can establish consumption relative to this explicit
two-CPU affinity budget and the recorded memory reference. It does not reserve
those CPUs from other host work, impose a cgroup quota, or establish production
capacity. Record the actual hosting allocation and measure there before making
that deployment claim. The chosen CPUs must be rechecked if the executor's
available mask changes.

## Prepared maximum scenes

[heavy-seed.ts](heavy-seed.ts) is QA-only source; the product does not import it.
It arranges bodies once in a **new isolated** database and saves through the
normal engine. The unchanged compiled worker restores that world. During
measurement only authenticated WebSocket inputs/actions operate the machinery;
there are no pose writes, victory flags or periodic fixture resets.

| Scene | Rooms / controllers | Normal loaded assembly | Simultaneous cable work | Explicit stress-only additions |
| --- | --- | --- | --- | --- |
| `ferry` | 1 / 6 humans | Actual Quarry truck, equipment and three cargoes plus six 80 kg crew: 3059 kg payload, 3779 kg including the 720 kg ferry; capacity 3500 kg payload | Two physical mooring cables, 24 contact segments each; ordinary propulsion/steering against the restraints | Two fixed winch supports at (39; −2; 54) and (79; −2; 70), which are absent from ordinary map stock |
| `lift` | 1 / 6 humans | Actual Ridge truck, equipment and three cargoes plus six crew: 3417 kg payload, 3937 kg including the 520 kg platform/barriers; capacity 3800 kg payload | Two 18 m hanging cables, 24 contact segments each, while ordinary lift controls alternate full upward/downward travel | Two fixed overhead winches and two extra ordinary 24 kg beams outside the loaded platform |
| `paired` | 2 / 12 humans | Both scenes together | Both sets together | All additions above; this is not a one-room run |

Two normal winch sources permit two cables, each at most 18 m, using contact
segments no longer than 0.75 m: at most **48 contact segments**, plus two drum
collars and two terminal hooks. `rope64` denotes additional Rapier solver
iterations, not a cable/segment budget. The ferry fixture uses actual
`ring-rear`/`ring-front` sockets. It verifies endpoint distances before creating
links and records the resulting lengths; its two 24-segment cables need not
both be exactly 18 m. Its extra fixed supports are not presented as a legal
inventory arrangement. Original inventory and normal assembly masses are
asserted unchanged. Every physical body/collider/joint count is recorded.
The far mooring drum faces the deck; the overhead drums face downward. The
fixture must also satisfy the candidate's new source-body cable-path check
after the game owner freezes that change; no older reader is substituted.

The fixture's stability and the ordinary `operate` action have **not** been
accepted by a run. Each probe fails if the loaded truck/crate/cargo/crew leave
the machinery, a cable detaches/breaks, the 48-segment workload disappears,
the operator is inactive, rescue/failure occurs, or a capacity is exceeded.
The report also requires observed full payload, nonzero cable tension, and
actual movement after warmup: ferry displacement over 0.1 m or lift travel over
5.5 m. This prevents an hour of an idle/broken scene from passing. Initial
settling is excluded from these movement/tension checks. A failed fixture must
be repaired and recalibrated; it cannot be counted as a passed heavy repeat.

## Commands after the new candidate is frozen

These are future commands, not authorization to rerun after the recorded
failure. Run them sequentially from the repository root, after the active renderers
and other physics tests have exited. The root agent must first identify the
new runtime/client artifact. Do not run them against an old R04/R05 output merely
because its files exist. Keep that candidate unchanged for the entire series;
`configuration.json` records worker/client manifests and entry hashes.

Start with two short probes, each with ten additional seconds of warmup:

```bash
taskset -c 2-8 node scripts/realtime-load.mjs --server-cpus 0,1 --seconds 60 --rooms 1 --profile humans --scene normal --map ridge --memory-mib 1024 --output .qa/realtime-load/next-n1-humans-60
taskset -c 2-8 node scripts/realtime-load.mjs --server-cpus 0,1 --seconds 60 --rooms 1 --profile bots --scene normal --map ridge --memory-mib 1024 --output .qa/realtime-load/next-n1-bots-60
```

`humans` means six authenticated independent controllers; `bots` means one
human and five real game bots. Neither is a rendered-browser test. If either
short probe fails, stop before the hour and investigate the measured failure.
Do not lower physics frequency, disable bots, relax thresholds, or accept two
rooms from these one-room results. Other normal maps can be selected explicitly
with `--map valley` or `--map quarry` when checking which scene is limiting.

After both normal and heavy short probes pass, run the one-hour probe on the
final accepted candidate using the profile selected from the measured short
results. The following is the six-human command; use `--profile bots` and a
new output directory if bots are the limiting profile. Record the reason for
that selection and the coverage limits while retaining both short reports.
Section 16 requires one hour at the declared capacity and a heavy repeat;
it does not automatically require every Cartesian combination of profile/map
to run for an hour. Any extra duration must resolve a concrete remaining risk.

```bash
taskset -c 2-8 node scripts/realtime-load.mjs --server-cpus 0,1 --seconds 3600 --rooms 1 --profile humans --scene normal --map ridge --memory-mib 1024 --output .qa/realtime-load/next-n1-humans-hour
```

Compile the separate fixture preparation module from the **same frozen game
source**. It writes only its private QA directory, not `dist-realtime` or a
browser build. The runner rejects a prepared-world manifest that differs from
the actual worker's game/rules/content/physics/runtime artifact.

```bash
npx vite build --config scripts/vite.realtime-heavy.config.ts
taskset -c 2-8 node scripts/realtime-load.mjs --server-cpus 0,1 --seconds 60 --rooms 1 --profile humans --scene ferry --memory-mib 1024 --output .qa/realtime-load/next-n1-ferry-60
taskset -c 2-8 node scripts/realtime-load.mjs --server-cpus 0,1 --seconds 60 --rooms 1 --profile humans --scene lift --memory-mib 1024 --output .qa/realtime-load/next-n1-lift-60
```

Only stable, correctly loaded short scenes allow selection of the heavy hour.
Both mechanisms retain their separate short checks; one room cannot contain
both maps. Choose the more demanding measured scene for the heavy repeat,
document the measurements and coverage limits, and run only the corresponding
command below. The initial plan is one normal hour plus one heavy hour, not
both alternatives by default. No heavy choice is established by the current
failed normal preflight.

```bash
taskset -c 2-8 node scripts/realtime-load.mjs --server-cpus 0,1 --seconds 3600 --rooms 1 --profile humans --scene ferry --memory-mib 1024 --output .qa/realtime-load/next-n1-ferry-hour
taskset -c 2-8 node scripts/realtime-load.mjs --server-cpus 0,1 --seconds 3600 --rooms 1 --profile humans --scene lift --memory-mib 1024 --output .qa/realtime-load/next-n1-lift-hour
```

Every output directory must be new; the harness refuses to overwrite saved
evidence or reuse a database. Each command creates only its own port, keys,
SQLite, archives and child runtime. To stop a run, send Ctrl-C to its own
terminal/session (allocate a PTY when using the executor). The harness handles
SIGINT/SIGTERM, records an incomplete result, closes its own sockets, requests
durable shutdown of its own child, and uses SIGKILL only if that child exceeds
the 32-second drain deadline. Do not kill PIDs discovered in another executor
namespace or use a broad process-name kill.

Inspect `report.json`, `configuration.json`, `measurements.jsonl`,
`runtime.log`, and for heavy scenes `data/heavy-fixture.json`. Five-second
samples retain step/commit/serialization histograms, snapshot age, snapshot
request duration, full/delta/resync counts, input and socket queues, lag/ELU,
server and load-generator CPU/RSS, and SQLite growth. Check the complete-hour
flag, all independent gates and a clean durable shutdown. A process exit of
zero after a 60-second probe is not an hour, and a passed build is not a
capacity measurement or a public release.
