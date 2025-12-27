// Script to add test video to the backend database

const API_BASE = 'https://tortok-metadata-server-796842052654.us-central1.run.app';

// Test user credentials
const TEST_USER = {
  email: 'test@example.com',
  password: 'testpass123'
};

// Test video data
const TEST_VIDEO = {
  caption: 'Test P2P video streaming with WebTorrent! 🚀',
  magnetLink: 'magnet:?xt=urn:btih:a27e31b3f6baf0a2f21f65dbbaddfbd0c9cd58f7&dn=tortok-test-video&tr=wss://tracker.openwebtorrent.com&tr=wss://tracker.btorrent.xyz&tr=wss://tracker.webtorrent.dev',
  hlsUrl: 'http://localhost:8081/playlist.m3u8', // Fallback HTTP URL
  thumbnailUrl: 'https://picsum.photos/720/1280',
  durationSeconds: 15,
  width: 720,
  height: 1280,
  hashtags: ['webtorrent', 'p2p', 'tortok', 'test']
};

async function main() {
  console.log('🔑 Logging in as test user...');

  // Login
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(TEST_USER)
  });

  if (!loginRes.ok) {
    const error = await loginRes.text();
    console.error('Login failed:', error);
    process.exit(1);
  }

  const { token } = await loginRes.json();
  console.log('✅ Logged in successfully');

  // Create video
  console.log('\n📹 Creating test video...');
  const videoRes = await fetch(`${API_BASE}/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(TEST_VIDEO)
  });

  if (!videoRes.ok) {
    const error = await videoRes.text();
    console.error('Failed to create video:', error);
    process.exit(1);
  }

  const video = await videoRes.json();
  console.log('✅ Video created successfully!');
  console.log('\n📊 Video Details:');
  console.log('   ID:', video.id);
  console.log('   Caption:', video.caption);
  console.log('   Magnet Link:', video.magnetLink.substring(0, 60) + '...');
  console.log('   HLS URL:', video.hlsURL);
  console.log('   Duration:', video.durationSeconds, 'seconds');
  console.log('   Resolution:', video.width, 'x', video.height);
  console.log('   Hashtags:', video.hashtags.join(', '));

  // Verify it appears in feed
  console.log('\n📡 Verifying video appears in feed...');
  const feedRes = await fetch(`${API_BASE}/videos/feed`);
  const feed = await feedRes.json();

  const found = feed.videos.find(v => v.id === video.id);
  if (found) {
    console.log('✅ Video found in feed!');
  } else {
    console.log('⚠️ Video not found in feed yet');
  }

  console.log('\n🎉 Done! The video is now available in the TorTok feed.');
}

main().catch(console.error);
