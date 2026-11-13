import { element, by, expect, waitFor } from 'detox';
import { freshLaunch, signInAndWaitForFeed, swipeFeedUntil, tapVideoUntil, waitForActiveVideo } from './helpers';

// Several feed items are rendered at once; the active one carries
// activeVideo* test IDs (see VideoItem in app/(tabs)/index.tsx).
const caption = (text: string) => element(by.id('activeVideoCaption').and(by.text(text)));
// test-network/start.mjs gives the test account this profile display name.
const AUTHOR = 'Alice Test';

// The main UX: the five test clips, published as app.tortok.video.post
// records to the test PDS and indexed by the backend's ingest
// (scripts/e2e-up.sh), newest first, played over WebTorrent from the local
// webseed and seeder. The test account's handle (alice.test) can't verify,
// so the author shows as its display name.
describe('Feed', () => {
  beforeAll(async () => {
    await freshLaunch();
    await signInAndWaitForFeed();
  });

  it('shows the first clip with its author and caption', async () => {
    await waitFor(element(by.id('activeVideoAuthor').and(by.text(AUTHOR)))).toBeVisible().withTimeout(10000);
    await expect(caption('Big Buck Bunny — opening shot')).toBeVisible();
  });

  it('plays the first clip', async () => {
    await waitForActiveVideo('playing');
  });

  it('pauses and resumes on tap', async () => {
    await tapVideoUntil('paused');
    await tapVideoUntil('playing');
  });

  it('swipes to the next clip, which plays', async () => {
    await element(by.id('videoFeed')).swipe('up', 'fast', 0.8);
    await waitFor(caption('Big Buck Bunny — butterfly scene')).toBeVisible().withTimeout(10000);
    await waitForActiveVideo('playing');
  });

  it('swipes back to the first clip, which plays again', async () => {
    await element(by.id('videoFeed')).swipe('down', 'fast', 0.8);
    await waitFor(caption('Big Buck Bunny — opening shot')).toBeVisible().withTimeout(10000);
    await waitForActiveVideo('playing');
  });

  // The e2e stack adds one bridged Bluesky post (scripts/e2e-up.sh), older
  // than the clips so it's last, playing a local HLS fixture in place of
  // Bluesky's video service (test-content/hls/).
  it('reaches the bridged Bluesky post, badged, which plays over HLS', async () => {
    // It's the sixth item: at most five swipes from the first.
    await swipeFeedUntil(caption('A clip from Bluesky'), 5);
    await expect(element(by.id('activeVideoAuthor').and(by.text('@bridged.bsky.social')))).toBeVisible();
    await expect(element(by.id('activeVideoBlueskyBadge'))).toBeVisible();
    await waitForActiveVideo('playing');
  });
});
