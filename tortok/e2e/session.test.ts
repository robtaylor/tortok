import { device, element, by, expect, waitFor } from 'detox';
import { resetKeychainAndLaunch, login, waitForApp } from './helpers';

describe('Session Persistence', () => {
  it('should persist login across app restarts', async () => {
    // Fresh install + login
    await resetKeychainAndLaunch();
    await login();

    await waitFor(element(by.id('signInButton')))
      .not.toExist()
      .withTimeout(8000);

    // Relaunch without clearing state (no keychain reset)
    await device.disableSynchronization();
    await device.launchApp({ newInstance: true });

    // Should still be logged in — no login screen
    await waitFor(element(by.text('Sign in to continue')))
      .not.toBeVisible()
      .withTimeout(8000);
  });

  it('should clear session on logout', async () => {
    // Login
    await resetKeychainAndLaunch();
    await login();

    await waitFor(element(by.id('signInButton')))
      .not.toExist()
      .withTimeout(8000);

    // Logout — enable sync for tab/button taps to wait for animations
    await device.enableSynchronization();
    await element(by.label('Profile, tab, 3 of 3')).tap();
    await device.disableSynchronization();
    await waitFor(element(by.id('logoutButton')))
      .toBeVisible()
      .withTimeout(5000);
    await device.enableSynchronization();
    await element(by.id('logoutButton')).tap();
    await device.disableSynchronization();

    await waitFor(element(by.text('Sign in to continue')))
      .toBeVisible()
      .withTimeout(5000);

    // Relaunch — should still be logged out
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.text('Sign in to continue')))
      .toBeVisible()
      .withTimeout(8000);
  });
});
