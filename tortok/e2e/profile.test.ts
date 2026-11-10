import { element, by, expect, waitFor } from 'detox';
import { freshLaunch, openTab, signInAndWaitForFeed, testNetwork } from './helpers';

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
});
