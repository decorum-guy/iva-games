import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureUnpackSnapshot, classifyUnpackEvidence, recordUnpackSnapshot, summarizeUnpackEvidence, unexpectedNetworkErrors } from './realtime-network-errors.mjs';
test('never accepts rate, internal, schema, projection or unexpected epoch errors', () => {
  const errors = ['RATE_LIMIT','INTERNAL_ERROR','SERVER_ERROR','INVALID_INPUT','PROJECTION_FAILED','STALE_EPOCH'].map(code => ({code,silenceMs:15000}));
  assert.deepEqual(unexpectedNetworkErrors(errors,100),errors);
});
test('permits only liveness authority errors after an observed five-second loss stall', () => {
  for(const code of ['AUTH_EXPIRED','STALE_CONTROLLER','CONTROL_REQUIRED']) {
    const late={code,silenceMs:5000}; assert.deepEqual(unexpectedNetworkErrors([late],5),[]);
    assert.deepEqual(unexpectedNetworkErrors([late],0),[late]);
    const early={code,silenceMs:4999};assert.deepEqual(unexpectedNetworkErrors([early],5),[early]);
  }
});

// Pure diagnostic fixtures: these assertions do not run a game or a network.
function unpackFixture() {
  const actor = { id: 'character-one', participantId: 'one', kind: 'character', position: { x: 12, y: .875, z: 21 },
    rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: -.1 }, animation: 'idle', sockets: [] };
  const snapshot = { matchId: 'fixture-match', phase: 'running', epoch: 1, controllerGeneration: 1, snapshotSeq: 20, worldTick: 60, lastConsumedInputSeq: 8,
    view: { tick: 60, phase: 'running', mapId: 'tutorial', entities: [actor, { id: 'equipment-crate', kind: 'crate', position: { x: 12, y: 1, z: 18 }, mass: 200, sockets: [] }],
      inventory: [{ id: 'repair-1', state: 'stored' }], operations: [], interactions: [{ id: 'unpack-repair', enabled: true, action: { type: 'unpack', itemId: 'repair-1' } }], events: [] } };
  const args = { snapshot, participantId: 'one', itemId: 'repair-1', input: { moveZ: 0 }, inputSeq: 9,
    lastSentInput: { inputSeq: 9, payload: { moveZ: 0 }, sentAtMs: 10 }, observedAtMs: 11 };
  const evidence = { participantId: 'one', itemId: 'repair-1', targetId: 'equipment-crate', firstSend: true, firstAcknowledgement: null,
    firstOperation: null, terminalEvent: null, baselineEventId: 5, observations: [], events: [], observedSnapshots: 0, omittedSnapshots: 0, omittedEvents: 0 };
  recordUnpackSnapshot(evidence, captureUnpackSnapshot(args));
  return { snapshot, args, evidence };
}

test('a retained rejected actionAck fails explicitly even with no protocol error', () => {
  const { evidence } = unpackFixture();
  evidence.firstAcknowledgement = { observedAtMs: 12, frame: { type: 'actionAck', actionId: 'fixture-action', committedJournalSeq: 7, result: { ok: false, code: 'NO_SPACE' } } };
  const state = classifyUnpackEvidence(evidence);
  assert.equal(state.code, 'ACTION_REJECTED'); assert.equal(state.terminal, true); assert.equal(state.started, false);
  assert.match(state.message, /NO_SPACE/); assert.equal(evidence.firstAcknowledgement.frame.committedJournalSeq, 7);
});

test('only a new matching operation event cancels the started unpack', () => {
  const { snapshot, args, evidence } = unpackFixture();
  evidence.firstAcknowledgement = { frame: { result: { ok: true, code: 'STARTED' } } };
  snapshot.view.events = [
    { id: 5, type: 'operation-cancelled', participantId: 'one', entityId: 'equipment-crate', tick: 59 },
    { id: 6, type: 'operation-failed', participantId: 'two', entityId: 'equipment-crate', tick: 60 },
    { id: 7, type: 'operation-cancelled', participantId: 'one', entityId: 'other-object', tick: 60 },
  ];
  recordUnpackSnapshot(evidence, captureUnpackSnapshot(args));
  assert.equal(classifyUnpackEvidence(evidence).code, 'OPERATION_PENDING');
  snapshot.view.events.push({ id: 8, type: 'operation-cancelled', participantId: 'one', entityId: 'equipment-crate', tick: 61 });
  recordUnpackSnapshot(evidence, captureUnpackSnapshot(args));
  assert.equal(classifyUnpackEvidence(evidence).code, 'OPERATION_CANCELLED');
  assert.deepEqual(evidence.events.map(event => event.id), [8]); assert.equal(evidence.terminalEvent.tick, 61);
});

test('asynchronous completion failure preserves the actual event and start observation', () => {
  const { snapshot, args, evidence } = unpackFixture();
  snapshot.view.operations = [{ participantId: 'one', type: 'unpack', targetId: 'equipment-crate', progress: .5, duration: 1 }];
  recordUnpackSnapshot(evidence, captureUnpackSnapshot(args));
  snapshot.view.operations = [];
  snapshot.view.events = [{ id: 6, type: 'operation-failed', participantId: 'one', entityId: 'equipment-crate', tick: 121, message: { en: 'Clear some space', ru: 'Освободите место' } }];
  recordUnpackSnapshot(evidence, captureUnpackSnapshot(args));
  const state = classifyUnpackEvidence(evidence);
  assert.equal(state.code, 'OPERATION_FAILED'); assert.equal(state.started, true); assert.equal(state.acknowledgementObserved, false);
  assert.equal(evidence.firstOperation.operation.progress, .5); assert.match(state.message, /Clear some space/);
});

test('completion still requires both the world item and the retained first acknowledgement', () => {
  const { snapshot, args, evidence } = unpackFixture();
  evidence.firstAcknowledgement = { frame: { result: { ok: true, code: 'STARTED' } } };
  assert.equal(classifyUnpackEvidence(evidence).terminal, false);
  snapshot.view.inventory[0].state = 'world';
  snapshot.view.entities.push({ id: 'repair-1', kind: 'repair', position: { x: 12, y: .25, z: 22.2 }, mass: 6 });
  recordUnpackSnapshot(evidence, captureUnpackSnapshot(args));
  assert.equal(classifyUnpackEvidence(evidence).code, 'COMPLETE'); assert.equal(evidence.latest.item.entityCount, 1);
  evidence.firstAcknowledgement = null;
  assert.equal(classifyUnpackEvidence(evidence).terminal, false);
  assert.equal(classifyUnpackEvidence(evidence, true).code, 'ACKNOWLEDGEMENT_MISSING');
});

test('send suppression and distinct deadline states are not described as the same failure', () => {
  const { snapshot, args, evidence } = unpackFixture();
  evidence.firstSend = false; assert.equal(classifyUnpackEvidence(evidence).code, 'ACTION_NOT_SENT');
  evidence.firstSend = true; assert.equal(classifyUnpackEvidence(evidence, true).code, 'ACKNOWLEDGEMENT_MISSING');
  evidence.firstAcknowledgement = { frame: { result: { ok: true, code: 'STARTED' } } };
  assert.equal(classifyUnpackEvidence(evidence, true).code, 'ITEM_NOT_UNPACKED');
  snapshot.view.operations = [{ participantId: 'one', type: 'unpack', targetId: 'equipment-crate', progress: .9, duration: 1 }];
  recordUnpackSnapshot(evidence, captureUnpackSnapshot(args));
  assert.equal(classifyUnpackEvidence(evidence, true).code, 'OPERATION_INCOMPLETE');
});

test('evidence copies exact public poses and consumed input while excluding unselected credentials', () => {
  const { snapshot, args } = unpackFixture();
  snapshot.ticket = 'do-not-copy'; snapshot.view.privateSigningKey = 'do-not-copy';
  const observation = captureUnpackSnapshot(args);
  assert.equal(observation.snapshot.lastConsumedInputSeq, 8); assert.equal(observation.input.lastSent.inputSeq, 9);
  assert.deepEqual(observation.actor.velocity, { x: 0, y: 0, z: -.1 });
  assert.equal(Object.hasOwn(observation.actor, 'grounded'), false);
  snapshot.view.entities[0].position.x = 99; args.lastSentInput.payload.moveZ = 1;
  assert.equal(observation.actor.position.x, 12); assert.equal(observation.input.lastSent.payload.moveZ, 0);
  assert.equal(JSON.stringify(observation).includes('do-not-copy'), false);
});

test('bounded history reports omissions but retains the first ACK and terminal failure', () => {
  const { snapshot, args, evidence } = unpackFixture();
  evidence.firstAcknowledgement = { frame: { result: { ok: true, code: 'STARTED' }, committedJournalSeq: 8 } };
  snapshot.view.events = [{ id: 6, type: 'operation-cancelled', participantId: 'one', entityId: 'equipment-crate', tick: 61 }];
  recordUnpackSnapshot(evidence, captureUnpackSnapshot(args));
  snapshot.view.events = [];
  for (let index = 0; index < 260; index++) { snapshot.snapshotSeq++; recordUnpackSnapshot(evidence, captureUnpackSnapshot(args)); }
  assert.equal(evidence.observedSnapshots, 262); assert.equal(evidence.observations.length, 256); assert.equal(evidence.omittedSnapshots, 6);
  assert.equal(evidence.firstAcknowledgement.frame.committedJournalSeq, 8); assert.equal(evidence.terminalEvent.id, 6);
  assert.equal(classifyUnpackEvidence(evidence).code, 'OPERATION_CANCELLED');
});

test('console summary stays small and allowlisted while the full report remains unchanged', () => {
  const { evidence } = unpackFixture();
  evidence.actionId = 'fixture-action';
  evidence.firstAcknowledgement = { observedAtMs: 12, frame: { actionId: 'fixture-action', epoch: 1, committedJournalSeq: 7,
    result: { ok: false, code: 'NO_SPACE', message: { en: 'Unabridged message' } }, unknownCredential: 'do-not-copy' } };
  evidence.classification = classifyUnpackEvidence(evidence);
  evidence.before = evidence.latest; evidence.after = evidence.latest;
  evidence.observations = Array.from({ length: 256 }, () => ({ ...evidence.latest, extraLargeField: 'x'.repeat(4096) }));
  evidence.observedSnapshots = 260; evidence.omittedSnapshots = 4;
  const fullBefore = JSON.stringify(evidence), summary = summarizeUnpackEvidence(evidence), encoded = JSON.stringify(summary);
  assert.ok(encoded.length < 1500); assert.equal(encoded.includes('do-not-copy'), false); assert.equal(encoded.includes('extraLargeField'), false);
  assert.equal(summary.firstAcknowledgement.committedJournalSeq, 7); assert.equal(summary.firstAcknowledgement.result.code, 'NO_SPACE');
  assert.equal(summary.evidenceCounts.retainedSnapshots, 256); assert.equal(summary.evidenceCounts.omittedSnapshots, 4);
  assert.equal(summary.classification.code, 'ACTION_REJECTED'); assert.equal(JSON.stringify(evidence), fullBefore);
  assert.equal(summarizeUnpackEvidence(null), null);
});
