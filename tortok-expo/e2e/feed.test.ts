import { device, element, by, expect, waitFor } from 'detox';
import { resetKeychainAndLaunch, login } from './helpers';

describe('Feed', () => {
  beforeEach(async () => {
    await resetKeychainAndLaunch();
    await login();
  });

  it('should display video with user overlay', async () => {
    // Video content should be visible with overlays
    await waitFor(element(by.text('@testuser3')))
      .toBeVisible()
      .withTimeout(10000);

    await expect(element(by.text('Test video from R2 #tortok #test'))).toBeVisible();
    await expect(element(by.text('#tortok #test'))).toBeVisible();
  });

  it('should show like button with count', async () => {
    await waitFor(element(by.text('@testuser3')))
      .toBeVisible()
      .withTimeout(10000);

    // Like count should be visible (starts at 0)
    await expect(element(by.text('0'))).toBeVisible();
  });
});
