import { element, by, waitFor } from 'detox';
import { freshLaunch, openTab, signInAndWaitForFeed, testNetwork } from './helpers';

describe('Navigation', () => {
  beforeAll(async () => {
    await freshLaunch();
    await signInAndWaitForFeed();
  });

  it('moves between all three tabs', async () => {
    await openTab('recordTab');
    await waitFor(element(by.text('Coming soon'))).toBeVisible().withTimeout(5000);

    await openTab('profileTab');
    await waitFor(element(by.text(`@${testNetwork().handle}`))).toBeVisible().withTimeout(5000);

    await openTab('homeTab');
    await waitFor(element(by.id('videoFeed'))).toBeVisible().withTimeout(5000);
  });
});
