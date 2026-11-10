import { element, by, expect, waitFor } from 'detox';
import { freshLaunch, relaunch, signIn, signInAndWaitForFeed, testNetwork, waitForLoginScreen } from './helpers';

// Sign-in in e2e builds goes through the app-password form against the
// throwaway test PDS. The real atproto OAuth flow (system browser) is not
// driven here.
describe('Sign-in', () => {
  // One fresh install for the file; the tests before the last never sign in,
  // so a relaunch keeps them signed out without reinstalling.
  beforeAll(async () => {
    await freshLaunch();
  });

  beforeEach(async () => {
    await relaunch();
  });

  it('shows the login screen on a fresh install', async () => {
    await waitForLoginScreen();
    await expect(element(by.text('TorTok'))).toBeVisible();
    await expect(element(by.id('handleTextField'))).toBeVisible();
  });

  it('asks for a handle when Bluesky sign-in is submitted empty', async () => {
    await waitForLoginScreen();
    await element(by.id('handleTextField')).replaceText('');
    await element(by.id('handleTextField')).tapReturnKey();
    await element(by.id('signInButton')).tap();
    await waitFor(element(by.id('errorMessage'))).toBeVisible().withTimeout(5000);
  });

  it('rejects a wrong app password', async () => {
    await signIn(testNetwork(), 'wrong-password');
    await waitFor(element(by.id('errorMessage'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('signInButton'))).toBeVisible();
  });

  it('signs in and lands on the feed', async () => {
    await signInAndWaitForFeed();
  });
});
