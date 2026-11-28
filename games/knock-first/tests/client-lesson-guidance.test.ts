import { describe, expect, it } from 'vitest';
import { createMission, viewForParticipant } from '../src';
import { lessonGuidance } from '../src/client/lessonGuidance';

const participants = [{ participantId: 'learner', displayName: 'Learner', kind: 'human' as const },
  { participantId: 'partner', displayName: 'Partner', kind: 'bot' as const }];

describe('lesson orientation without extending ordinary information', () => {
  it('does not provide a target in an ordinary mission', () => {
    const mission = createMission({ participants });
    expect(lessonGuidance(viewForParticipant(mission, 'learner'), 'ru')).toBeNull();
  });

  it('does not point to hidden battery coordinates while teaching the carry exercise', () => {
    const mission = createMission({ participants, settings: { tutorial: true } });
    mission.tutorial!.step = 5;
    const first = viewForParticipant(mission, 'learner');
    expect(first.batteries).toEqual([]);
    const guide = lessonGuidance(first, 'en');
    for (const battery of mission.batteries) battery.position.x += 0.5;
    const changed = viewForParticipant(mission, 'learner');
    expect(changed.batteries).toEqual([]);
    expect(lessonGuidance(changed, 'en')).toEqual(guide);
    expect(guide?.label).toContain('Dry Bypass');
  });

  it('stops pointing at the battery when the learner is already holding a handle', () => {
    const mission = createMission({ participants, settings: { tutorial: true } });
    mission.tutorial!.step = 5;
    const view = viewForParticipant(mission, 'learner');
    view.self.carrying = 'battery-1';
    expect(lessonGuidance(view, 'ru')).toBeNull();
  });
});
