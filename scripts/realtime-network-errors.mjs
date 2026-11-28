/** Continuous input expiry at 250ms is silent neutralization. Only a detected
 * five-second network absence can legitimately end controller authority. */
export function unexpectedNetworkErrors(errors, lossPercent = 0) {
  const afterAbsence = new Set(['AUTH_EXPIRED', 'STALE_CONTROLLER', 'CONTROL_REQUIRED']);
  return errors.filter(error => !(lossPercent > 0 && Number.isFinite(error.silenceMs) && error.silenceMs >= 5000 && afterAbsence.has(error.code)));
}

const copy = value => value === undefined ? null : structuredClone(value);
const pose = entity => entity ? Object.fromEntries([
  'id', 'kind', 'participantId', 'position', 'rotation', 'size', 'velocity',
  'angularVelocity', 'mass', 'animation', 'state', 'sockets',
].filter(key => entity[key] !== undefined).map(key => [key, copy(entity[key])])) : null;

/** Public, credential-free evidence. Grounded state is not in the public view;
 * animation is retained as observed, never promoted to an invented grounded flag. */
export function captureUnpackSnapshot({ snapshot, participantId, itemId, position, input, inputSeq, lastSentInput, observedAtMs }) {
  const view = snapshot?.view, entities = view?.entities ?? [];
  const actor = entities.find(entity => entity.participantId === participantId);
  const crate = entities.find(entity => entity.id === 'equipment-crate');
  const item = entities.filter(entity => entity.id === itemId);
  const points = [actor?.position, position].filter(Boolean);
  const nearby = entities.filter(entity => entity.participantId || entity.id === 'equipment-crate' || entity.id === itemId || points.some(point =>
    entity.position && Math.hypot(entity.position.x - point.x, entity.position.y - point.y, entity.position.z - point.z) <= 5));
  return {
    observedAtMs,
    snapshot: snapshot ? Object.fromEntries([
      'matchId', 'phase', 'pauseReason', 'hasControl', 'epoch', 'controllerGeneration',
      'snapshotSeq', 'worldTick', 'lastConsumedInputSeq',
    ].filter(key => snapshot[key] !== undefined).map(key => [key, copy(snapshot[key])])) : null,
    world: view ? { tick: view.tick, phase: view.phase, mapId: view.mapId } : null,
    input: { desired: copy(input), latestSequence: inputSeq, lastSent: copy(lastSentInput) },
    actor: pose(actor), crate: pose(crate), nearbyEntities: nearby.map(pose),
    item: { inventory: copy(view?.inventory?.find(value => value.id === itemId)), entityCount: item.length, entities: item.map(pose) },
    operations: copy(view?.operations?.filter(operation => operation.participantId === participantId) ?? []),
    interactions: copy(view?.interactions?.filter(interaction => interaction.action?.type === 'unpack' && interaction.action.itemId === itemId) ?? []),
    events: copy(view?.events ?? []),
  };
}

/** Keep at most 256 public observations for the ten-second initial action.
 * The first state, first ACK, and terminal event live outside this bounded tail. */
export function recordUnpackSnapshot(evidence, observation) {
  evidence.latest = observation;
  evidence.observedSnapshots += 1;
  evidence.observations.push(observation);
  if (evidence.observations.length > 256) {
    evidence.observations.shift(); evidence.omittedSnapshots += 1;
  }
  const operation = observation.operations.find(value => value.type === 'unpack' && value.targetId === evidence.targetId);
  if (operation && !evidence.firstOperation) evidence.firstOperation = copy({ snapshot: observation.snapshot, operation });
  const relevant = observation.events.filter(event => event.id > evidence.baselineEventId && event.participantId === evidence.participantId &&
    (event.entityId === evidence.targetId || event.entityId === evidence.itemId));
  for (const event of relevant) {
    if (!evidence.events.some(value => value.id === event.id)) {
      evidence.events.push(copy(event));
      if (evidence.events.length > 256) { evidence.events.shift(); evidence.omittedEvents += 1; }
    }
    if (!evidence.terminalEvent && ['operation-cancelled', 'operation-failed'].includes(event.type) && event.entityId === evidence.targetId) evidence.terminalEvent = copy(event);
  }
}

/** A rejected game action is an actionAck, not a protocol error frame. Keep
 * that distinction and the deliberately lost ACK test instead of timing out. */
export function classifyUnpackEvidence(evidence, timedOut = false) {
  const ack = evidence.firstAcknowledgement?.frame;
  const itemIsWorld = evidence.latest?.item.inventory?.state === 'world';
  const started = ack?.result?.code === 'STARTED' || Boolean(evidence.firstOperation) || Boolean(evidence.terminalEvent) || evidence.events.some(event => event.type === 'operation-start');
  const state = (code, terminal, message) => ({ code, terminal, started, itemIsWorld, acknowledgementObserved: Boolean(ack), message });
  if (evidence.firstSend === false) return state('ACTION_NOT_SENT', true, 'Initial unpack action was not sent by the client');
  if (ack && ack.result?.ok !== true) return state('ACTION_REJECTED', true, `Initial unpack action was rejected: ${ack.result?.code ?? 'missing result'}`);
  if (evidence.terminalEvent) {
    const failed = evidence.terminalEvent.type === 'operation-failed';
    return state(failed ? 'OPERATION_FAILED' : 'OPERATION_CANCELLED', true,
      `Initial unpack ${failed ? 'failed' : 'was cancelled'} after starting${evidence.terminalEvent.message?.en ? `: ${evidence.terminalEvent.message.en}` : ''}`);
  }
  if (itemIsWorld && ack) return state('COMPLETE', true, 'Initial unpack completed with the first acknowledgement retained');
  if (timedOut) {
    if (!ack) return state('ACKNOWLEDGEMENT_MISSING', true, `Initial unpack acknowledgement was not observed; item state is ${evidence.latest?.item.inventory?.state ?? 'unknown'}`);
    const operation = evidence.latest?.operations.find(value => value.type === 'unpack' && value.targetId === evidence.targetId);
    if (operation) return state('OPERATION_INCOMPLETE', true, 'Initial unpack was accepted but the operation did not finish before the unchanged deadline');
    return state('ITEM_NOT_UNPACKED', true, 'Initial unpack was accepted, but no active operation, terminal failure event, or unpacked item was observed at the deadline');
  }
  return state(started ? 'OPERATION_PENDING' : 'ACKNOWLEDGEMENT_PENDING', false, 'Initial unpack evidence is still pending');
}

/** Console output is a small allowlisted summary. Full copied observations
 * remain in the report file, which is preserved independently by CI. */
export function summarizeUnpackEvidence(evidence) {
  if (!evidence) return null;
  const acknowledgement = evidence.firstAcknowledgement;
  const ack = acknowledgement?.frame;
  const terminal = evidence.terminalEvent;
  return {
    actionId: evidence.actionId ?? null, participantId: evidence.participantId, itemId: evidence.itemId,
    firstSend: evidence.firstSend, classification: copy(evidence.classification),
    firstAcknowledgement: ack ? {
      observedAtMs: acknowledgement.observedAtMs, actionId: ack.actionId, epoch: ack.epoch,
      committedJournalSeq: ack.committedJournalSeq, result: { ok: ack.result?.ok, code: ack.result?.code },
    } : null,
    evidenceCounts: { observedSnapshots: evidence.observedSnapshots, retainedSnapshots: evidence.observations.length,
      omittedSnapshots: evidence.omittedSnapshots, retainedEvents: evidence.events.length, omittedEvents: evidence.omittedEvents },
    firstOperation: evidence.firstOperation ? { worldTick: evidence.firstOperation.snapshot?.worldTick, operation: copy(evidence.firstOperation.operation) } : null,
    terminalEvent: terminal ? { id: terminal.id, type: terminal.type, tick: terminal.tick, entityId: terminal.entityId, participantId: terminal.participantId } : null,
    before: evidence.before ? { worldTick: evidence.before.snapshot?.worldTick, itemState: evidence.before.item.inventory?.state, crateMass: evidence.before.crate?.mass } : null,
    after: evidence.after ? { worldTick: evidence.after.snapshot?.worldTick, itemState: evidence.after.item.inventory?.state,
      entityCount: evidence.after.item.entityCount, crateMass: evidence.after.crate?.mass } : null,
  };
}
