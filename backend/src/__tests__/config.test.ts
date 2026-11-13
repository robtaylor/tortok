import { envBool } from '../config';

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
