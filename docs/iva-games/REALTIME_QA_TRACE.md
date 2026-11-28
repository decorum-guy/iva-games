# Bounded runtime correlation for QA

This is source documentation, not evidence that a latency or capacity gate passed.

`REALTIME_QA_TRACE=1` enables capture only when `NODE_ENV=development`. Production,
test and other environments remain disabled. The existing isolated Forpost QA
server sets development explicitly. No HTTP or WebSocket API is added.

The main runtime holds at most 2048 fixed-width numeric rows. Capture stops after
60 seconds or at the first existing overload decision. Each recorder operation
also checks the monotonic deadline, so a delayed timer cannot extend the window.
An overload freezes the
numeric boundary before the ordinary durable pause. One JSON report is emitted
to stderr after the pause is persisted and the ordinary phase messages are sent.
A failed pause is labeled failed; a timed-out capture is `window-expired`, never an
overload reproduction. Shutdown before either boundary is labeled separately.
The complete emitted JSON, including its newline, is capped at 256 KiB. Counters
describe evicted prefix rows, output truncation, updates to evicted rows, incomplete
spans and missing tick/commit links. An empty or incomplete retained window does
not establish complete causality. `triggerTickSeq` comes from the specific tick
after which schedule checked the backlog, not the latest globally allocated row.
An absent, evicted or output-truncated triggering tick is explicitly unknown.

Rows have the fixed columns included in the report. `kind=1` describes one actual
runtime step: due/start times, worker completion, its explicit commit RPC sequence,
commit completion and backlog. `dueUs` converts the existing `performance.now()`
deadline into the recorder's monotonic clock. It includes the small time spent
calling the recorder; it is not an exact kernel scheduling deadline.
`kind=2` describes one writer RPC: allowed operation
code, process-local RPC sequence, optional batch sequence, send/receive/execution/
acknowledgement times and success/error boolean. Sequence allocation order is not
claimed to be execution order; timestamps and the explicit RPC link establish it.
All clocks use the same process monotonic origin, passed to the writer. Intermediate
service calls and other rooms cannot change a tick's commit link.

Every StoreQueue operation is timed, including bridge replay protection, ticket
consumption, admission changes and reads. Commit rows sharing a batch sequence
share one execution span; their times must not be added as independent transactions.
Only numeric timing metadata is added to existing internal worker replies. No extra
writer transaction, IPC stream, scheduling wait or flush cadence is introduced.

The report contains no payload, world, room/user/ticket identifiers, arguments,
results, error text, key or filesystem path. Operation names come from a fixed
whitelist. Revision and artifact identity accept only the existing hash formats.
Late replies cannot modify a frozen report. The default path allocates no collector
or diagnostic timer. Enabled timing includes instrumentation overhead.

This capture measures whole writer operations. It does not identify fsync duration
or correlate individual checkpoint calls. Existing cumulative checkpoint telemetry
keeps that limitation. FULL, the publication barrier, overload threshold, fixed
step interval and maximum catch-up work are unchanged. A completed diagnostic is
not browser acceptance, an hour of load, production storage validation or a claim
that SERVER_BUSY during preparation has been fixed.
