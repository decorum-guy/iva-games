import { describe, expect, it } from 'vitest';
import { formatMissionTime } from '../src/client/copy';

describe('mission countdown display', () => {
  it.each([
    [840, '14:00'],
    [840 - 1 / 30, '14:00'],
    [60, '01:00'],
    [60 - 1 / 30, '01:00'],
    [59, '00:59'],
    [1 / 30, '00:01'],
    [0, '00:00'],
    [-1 / 30, '00:00'],
  ] as const)('formats a server time of %s without a :60 component', (seconds, expected) => {
    expect(formatMissionTime(seconds)).toBe(expected);
  });
});
