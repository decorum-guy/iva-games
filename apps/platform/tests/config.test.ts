import { describe, expect, it } from 'vitest';
import { loadPlatformConfig } from '../src/config';

describe('Production release configuration', () => {
  it.each(['false', '0', 'true'])('ignores obsolete DISTRICT_TERRITORIAL_ENABLED=%s from an existing host', value => {
    const env = { NODE_ENV: 'production', PORTAL_ORIGIN: 'https://iva-games.example.test', MAIL_MODE: 'disabled' };
    const current = loadPlatformConfig(env);
    expect(loadPlatformConfig({ ...env, DISTRICT_TERRITORIAL_ENABLED: value })).toEqual(current);
    expect(current).not.toHaveProperty('territorialDistrict');
  });
});
