import { describe, expect, it } from 'vitest';
import { advanceTutorial, createTutorial, startTutorialThreat, tutorialFrame } from '../src/territorial/tutorial';

describe('territorial practice', () => {
  it('plays the opening, production, exchange, building, applied aid and tactic and can replay', () => {
    let session = createTutorial();
    const initial = structuredClone(session);
    const steps = [];
    while (session.step !== 'complete') {
      const frame = tutorialFrame(session);
      steps.push(frame.step);
      expect(frame.body.ru.length * frame.body.en.length).toBeGreaterThan(0);
      if (frame.target) expect(advanceTutorial(session, 'another-place')).toBe(session);
      const next = advanceTutorial(session, frame.target?.id);
      if (session.step === 'production') {
        expect(next.state.lastRoll).toEqual([4, 2]);
        expect(next.state.players.apprentice.hand.wool).toBeGreaterThan(session.state.players.apprentice.hand.wool);
      }
      if (session.step === 'trade') expect(next.state.players.apprentice.hand.grain).toBe(session.state.players.apprentice.hand.grain + 1);
      if (session.step === 'build') expect(next.state.news.messages.at(-1)).toMatchObject({ templateId: 'G02', stage: 'applied' });
      if (session.step === 'tactic') expect(next.state.players.apprentice.cards).toHaveLength(0);
      session = next;
    }
    expect(steps).toEqual(['place', 'opening-road', 'production', 'road', 'trade', 'build', 'good-news', 'tactic', 'score']);
    expect(tutorialFrame(session).view.you.points).toBe(3);
    expect(createTutorial()).toEqual(initial);
  });
  it('protects manually through two whole rounds and discloses only the applied outcome', () => {
    let session = startTutorialThreat();
    const frame = tutorialFrame(session);
    expect(frame.target).toBeUndefined();
    expect(frame.view.threats).toHaveLength(1);
    expect(frame.view.threats[0]).toMatchObject({ stage: 'confirmed', dueRound: 9, zone: 'pine-cape' });
    expect(frame.view.threats[0]).not.toHaveProperty('changes');
    expect(advanceTutorial(session, 'somewhere')).toBe(session);
    const own = Object.entries(frame.view.buildings).find(([, b]) => b.level === 2 && b.ownerId === frame.view.you.participantId)![0];
    session = advanceTutorial(session, own);
    expect(session.step).toBe('advance-round');
    expect(session.state.players.apprentice.hand.brick).toBe(frame.view.you.hand.brick - 1);
    session = advanceTutorial(session);
    expect(session.step).toBe('advance-round');
    expect(session.state.round).toBe(8);
    session = advanceTutorial(session);
    expect(session.step).toBe('threat-result');
    expect(session.state.round).toBe(9);
    expect(tutorialFrame(session).view.news.at(-1)).toMatchObject({ stage: 'applied', changes: [
      { kind: 'protected', ownerId: frame.view.you.participantId, nodeId: own },
    ] });
    expect(advanceTutorial(session).step).toBe('complete');
  });
});
