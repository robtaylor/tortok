import { element, by, waitFor } from 'detox';
import { freshLaunch, openTab, relaunch, signInAndWaitForFeed, waitForFeed, waitForLoginScreen } from './helpers';

describe('Session', () => {
  it('keeps the session across a relaunch', async () => {
    await freshLaunch();
    await signInAndWaitForFeed();
    await relaunch();
    await waitForFeed();
  });

  it('signs out, and stays signed out after a relaunch', async () => {
    await freshLaunch();
    await signInAndWaitForFeed();
    await openTab('profileTab');
    await waitFor(element(by.id('logoutButton'))).toBeVisible().withTimeout(5000);
    await element(by.id('logoutButton')).tap();
    await waitForLoginScreen(10000);

    await relaunch();
    await waitForLoginScreen();
  });
});
