import { device, element, by, expect, waitFor } from 'detox';
import { resetKeychainAndLaunch, login } from './helpers';

describe('Navigation', () => {
  beforeEach(async () => {
    await resetKeychainAndLaunch();
    await login();
    await waitFor(element(by.id('signInButton')))
      .not.toExist()
      .withTimeout(8000);
  });

  it('should navigate between all tabs', async () => {
    // Start on Home — should see feed content
    await waitFor(element(by.text('@testuser3')))
      .toBeVisible()
      .withTimeout(10000);

    // Navigate to Record tab
    await device.enableSynchronization();
    await element(by.label('Record, tab, 2 of 3')).tap();
    await device.disableSynchronization();
    await waitFor(element(by.text('Coming soon')))
      .toBeVisible()
      .withTimeout(5000);

    // Navigate to Profile tab
    await device.enableSynchronization();
    await element(by.label('Profile, tab, 3 of 3')).tap();
    await device.disableSynchronization();
    await waitFor(element(by.text('Followers')))
      .toBeVisible()
      .withTimeout(5000);

    // Navigate back to Home tab
    await device.enableSynchronization();
    await element(by.label('Home, tab, 1 of 3')).tap();
    await device.disableSynchronization();
    await waitFor(element(by.text('@testuser3')))
      .toBeVisible()
      .withTimeout(5000);
  });
});
