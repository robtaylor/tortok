import { element, by, expect, waitFor } from 'detox';
import { fill, freshLaunch, openTab, signInAndWaitForFeed, testNetwork, waitForFeed } from './helpers';

describe('Profile', () => {
  beforeAll(async () => {
    await freshLaunch();
    await signInAndWaitForFeed();
    await openTab('profileTab');
  });

  it("shows the signed-in account's handle and DID", async () => {
    const { handle, did } = testNetwork();
    await waitFor(element(by.id('username'))).toBeVisible().withTimeout(5000);
    await expect(element(by.text(`@${handle}`))).toBeVisible();
    await expect(element(by.text(did))).toBeVisible();
  });

  it('has a sign-out button', async () => {
    await expect(element(by.id('logoutButton'))).toBeVisible();
  });

  describe('AppView setting', () => {
    // The e2e build's default AppView is the local stack's backend.
    const DEFAULT = 'http://localhost:8080';
    // The same backend under another address, so switching to it still
    // serves the test feed.
    const OTHER = 'http://127.0.0.1:8080';

    it('shows the default AppView', async () => {
      await waitFor(element(by.id('appViewUrlField'))).toBeVisible().whileElement(by.id('profileScroll')).scroll(200, 'down');
      await expect(element(by.id('appViewUrlField'))).toHaveText(DEFAULT);
      await expect(element(by.id('appViewResetButton'))).not.toExist();
    });

    it('refuses an address that is not a URL', async () => {
      await fill('appViewUrlField', 'not an appview');
      // The error renders below the field, which may sit at the screen's
      // bottom edge, so scroll it into view before checking it's visible.
      await waitFor(element(by.id('appViewError'))).toExist().withTimeout(5000);
      await waitFor(element(by.id('appViewError'))).toBeVisible().whileElement(by.id('profileScroll')).scroll(100, 'down');
      await expect(element(by.id('appViewResetButton'))).not.toExist();
    });

    it('switches to another AppView, and the feed loads from it', async () => {
      await fill('appViewUrlField', OTHER);
      await waitFor(element(by.id('appViewResetButton'))).toExist().withTimeout(15000);
      await expect(element(by.id('appViewError'))).not.toExist();

      await openTab('homeTab');
      await waitForFeed();
      await openTab('profileTab');
      await waitFor(element(by.id('appViewUrlField'))).toHaveText(OTHER).withTimeout(5000);
    });

    it('goes back to the default', async () => {
      await waitFor(element(by.id('appViewResetButton'))).toBeVisible().whileElement(by.id('profileScroll')).scroll(200, 'down');
      await element(by.id('appViewResetButton')).tap();
      await waitFor(element(by.id('appViewUrlField'))).toHaveText(DEFAULT).withTimeout(5000);
      await expect(element(by.id('appViewResetButton'))).not.toExist();
    });
  });
});
