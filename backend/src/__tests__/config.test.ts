import { bridgeThresholds, envBool } from '../config';

describe('envBool', () => {
  const NAME = 'TORTOK_TEST_FLAG';
  afterEach(() => { delete process.env[NAME]; });

  it('is the fallback when unset', () => {
    expect(envBool(NAME, false)).toBe(false);
    expect(envBool(NAME, true)).toBe(true);
  });

  it('reads true and false', () => {
    process.env[NAME] = 'true';
    expect(envBool(NAME, false)).toBe(true);
    process.env[NAME] = 'false';
    expect(envBool(NAME, true)).toBe(false);
  });

  it.each(['1', 'yes', 'TRUE', ''])('refuses %j rather than guessing', (raw) => {
    process.env[NAME] = raw;
    expect(() => envBool(NAME, false)).toThrow(`${NAME} must be true or false`);
  });
});

describe('bridgeThresholds', () => {
  const NAMES = ['BRIDGE_MIN_LIKES', 'BRIDGE_MIN_REPOSTS', 'BRIDGE_MIN_FOLLOWERS', 'BRIDGE_QUALIFY_DAYS'];
  // Before each as well as after: a developer's shell may set these.
  const clear = () => { for (const n of NAMES) delete process.env[n]; };
  beforeEach(clear);
  afterEach(clear);

  it("defaults to Decision 0023's thresholds", () => {
    expect(bridgeThresholds()).toEqual({ minLikes: 50, minReposts: 10, minFollowers: 5000, qualifyDays: 7 });
  });

  it('reads each from the environment', () => {
    NAMES.forEach((n, i) => { process.env[n] = String(i + 1); });
    expect(bridgeThresholds()).toEqual({ minLikes: 1, minReposts: 2, minFollowers: 3, qualifyDays: 4 });
  });

  it.each(['0', '-5', 'many', ''])('refuses %j rather than guessing', (raw) => {
    process.env.BRIDGE_MIN_LIKES = raw;
    expect(() => bridgeThresholds()).toThrow('BRIDGE_MIN_LIKES must be a positive number');
  });
});
