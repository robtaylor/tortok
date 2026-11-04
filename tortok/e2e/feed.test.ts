import { device, element, by, expect, waitFor } from 'detox';
import { resetKeychainAndLaunch, login } from './helpers';

describe('Feed', () => {
  beforeEach(async () => {
    await resetKeychainAndLaunch();
    await login();
  });

  it('should display video with user overlay', async () => {
    // Video content should be visible with overlays
    await waitFor(element(by.text('@testuser')))
      .toBeVisible()
      .withTimeout(10000);

    // Feed is the Big Buck Bunny test clips published by
    // scripts/seed-prod-test-content.mjs; bbb-01 is newest, so it is first.
    await expect(element(by.text('Big Buck Bunny — opening shot #bbb #test'))).toBeVisible();
    await expect(element(by.text('#bbb #test'))).toBeVisible();
  });

  it('should show like button with count', async () => {
    await waitFor(element(by.text('@testuser')))
      .toBeVisible()
      .withTimeout(10000);

    // Like count should be visible (starts at 0)
    await expect(element(by.text('0'))).toBeVisible();
  });
});
