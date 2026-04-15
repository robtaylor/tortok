import { device, element, by, expect, waitFor } from 'detox';
import { resetKeychainAndLaunch, login } from './helpers';

describe('Profile', () => {
  beforeEach(async () => {
    await resetKeychainAndLaunch();
    await login();
    // Wait for feed to load
    await waitFor(element(by.id('signInButton')))
      .not.toExist()
      .withTimeout(8000);
  });

  it('should display user info on profile tab', async () => {
    await device.enableSynchronization();
    await element(by.label('Profile, tab, 3 of 3')).tap();
    await device.disableSynchronization();

    // User details
    await waitFor(element(by.id('displayName')))
      .toBeVisible()
      .withTimeout(5000);
    await expect(element(by.id('username'))).toBeVisible();

    // Stats
    await expect(element(by.text('Followers'))).toBeVisible();
    await expect(element(by.text('Following'))).toBeVisible();
    await expect(element(by.text('Videos'))).toBeVisible();
  });

  it('should show logout button', async () => {
    await device.enableSynchronization();
    await element(by.label('Profile, tab, 3 of 3')).tap();
    await device.disableSynchronization();

    await waitFor(element(by.id('logoutButton')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('should logout and return to login screen', async () => {
    await device.enableSynchronization();
    await element(by.label('Profile, tab, 3 of 3')).tap();
    await device.disableSynchronization();

    await waitFor(element(by.id('logoutButton')))
      .toBeVisible()
      .withTimeout(5000);

    await device.enableSynchronization();
    await element(by.id('logoutButton')).tap();
    await device.disableSynchronization();

    // Should return to login screen
    await waitFor(element(by.text('Sign in to continue')))
      .toBeVisible()
      .withTimeout(5000);
  });
});
