# Attested View Counting for Decentralized Video Platform

## Problem Statement

In a decentralized P2P video platform like TorTok, how do we create a trustworthy view counting system that can serve as a basis for creator payments, while maintaining:

- **Fraud resistance**: Prevent fake views, bots, and Sybil attacks
- **Privacy**: Don't reveal what individual users are watching
- **Decentralization**: Avoid single point of failure or control
- **Scalability**: Handle millions of views efficiently
- **Verifiability**: Anyone can audit the system

### Why This Is Hard

1. **No central authority** - Can't just trust a server to count views
2. **P2P streaming** - Video data flows peer-to-peer, not through a server
3. **Sybil attacks** - One person could create many fake identities
4. **Incentive to cheat** - If views = money, users/creators will try to game it
5. **Privacy requirements** - Can't track everything users watch
6. **Offline/mobile constraints** - iOS devices have limited background processing

## Proposed Approaches

### Approach 1: Server-Side Attestation (Simplest)

**How it works**:
```
User App → [JWT-signed view event] → Metadata Server → Increment counter
```

**Implementation**:
```swift
// In VideoPlayerView.swift
func recordView() async {
    let viewEvent = ViewEvent(
        videoId: video.id,
        timestamp: Date(),
        watchedDuration: playerDuration,
        quality: currentQuality,
        userId: authManager.currentUser.id
    )

    // Sign with user's JWT token
    try await apiClient.post("/videos/\(video.id)/views", body: viewEvent)
}
```

**Server validates**:
```typescript
// Metadata server
app.post('/videos/:id/views', authenticateJWT, async (req, res) => {
    const { videoId, watchedDuration } = req.body;
    const userId = req.user.id;

    // Anti-fraud checks
    if (watchedDuration < 3) return; // Must watch 3+ seconds
    if (await hasViewedRecently(userId, videoId, '1 hour')) return; // Rate limit
    if (await isSuspiciousUser(userId)) return; // Reputation check

    // Record view
    await db.incrementViewCount(videoId);
    await db.recordViewEvent(userId, videoId, watchedDuration);

    res.json({ success: true });
});
```

**Pros**:
- ✅ Simple to implement
- ✅ Efficient (single HTTP call)
- ✅ Can apply anti-fraud heuristics
- ✅ Works with existing infrastructure

**Cons**:
- ❌ Centralized (metadata server can manipulate counts)
- ❌ Server can be DDoS'd
- ❌ Requires trusting instance operators
- ❌ Privacy concerns (server knows what you watch)

**Anti-fraud measures**:
- Rate limiting (1 view per user per video per hour)
- Watch duration threshold (must watch 3+ seconds)
- User reputation scoring
- IP address analysis
- Device fingerprinting
- Behavioral analysis (viewing patterns)

---

### Approach 2: Cryptographic Proof-of-Viewing

**How it works**:

Client generates cryptographic proof that they actually watched the video, without revealing what they watched.

**Protocol**:

1. **Video Chunking**: HLS video is already split into 4-second chunks
2. **Challenge-Response**: Server issues random challenges during playback
3. **Commitment Scheme**: Client commits to chunks before downloading
4. **Zero-Knowledge Proof**: Client proves they downloaded chunks without revealing which video

**Implementation**:

```swift
// In P2PVideoPlayer.swift
class ProofOfViewingGenerator {
    private var chunkCommitments: [String: Data] = [:]

    // Before downloading chunk
    func commitToChunk(_ chunkIndex: Int, videoId: UUID) -> Data {
        let commitment = SHA256("\(videoId):\(chunkIndex):\(randomNonce())")
        chunkCommitments[chunkIndex] = commitment
        return commitment
    }

    // After downloading chunk
    func generateProof(chunk: Data, index: Int) -> ViewProof {
        let chunkHash = SHA256(chunk)
        let proof = ViewProof(
            commitment: chunkCommitments[index]!,
            chunkHash: chunkHash,
            timestamp: Date(),
            signature: sign(commitment + chunkHash)
        )
        return proof
    }

    // Generate aggregate proof for entire viewing session
    func finalizeViewingProof() -> AggregateViewProof {
        return AggregateViewProof(
            chunkProofs: chunkCommitments.values,
            totalDuration: calculateDuration(),
            merkleRoot: buildMerkleTree(chunkCommitments)
        )
    }
}
```

**Server verification**:
```typescript
async function verifyViewProof(proof: AggregateViewProof, videoId: string): Promise<boolean> {
    // 1. Verify Merkle tree of chunks
    if (!verifyMerkleRoot(proof.merkleRoot, proof.chunkProofs)) {
        return false;
    }

    // 2. Verify chunk commitments match video chunks
    const videoChunks = await getVideoChunkHashes(videoId);
    if (!chunksMatch(proof.chunkProofs, videoChunks)) {
        return false;
    }

    // 3. Verify minimum watch duration (3+ seconds)
    if (proof.totalDuration < 3) {
        return false;
    }

    // 4. Verify cryptographic signatures
    if (!verifySignature(proof)) {
        return false;
    }

    return true;
}
```

**Pros**:
- ✅ Cryptographically verifiable
- ✅ Can't fake without actually downloading chunks
- ✅ Privacy-preserving (zero-knowledge)
- ✅ Decentralized verification

**Cons**:
- ❌ Complex implementation
- ❌ Computational overhead (battery drain)
- ❌ Still need to prevent Sybil attacks
- ❌ Requires careful crypto design

---

### Approach 3: Multi-Party Attestation (Torrent Swarm Verification)

**How it works**:

Use other peers in the torrent swarm to attest that viewing occurred.

**Protocol**:

1. When User A watches a video, they're connected to 5-10 peers in the swarm
2. User A requests "view attestation" from 3+ random peers
3. Peers verify that User A actually downloaded chunks (they can see upload stats)
4. Peers sign attestation messages
5. User A submits attestations to metadata server
6. View only counts if 3+ independent peers attest

**Implementation**:

```swift
// In TorrentEngine.swift
class SwarmAttestationManager {
    func requestViewAttestation(videoId: UUID) async throws -> [PeerAttestation] {
        let peers = torrentEngine.getPeersForVideo(videoId)
        let randomPeers = peers.randomSample(count: 5)

        var attestations: [PeerAttestation] = []

        for peer in randomPeers {
            // Request attestation from peer
            let request = AttestationRequest(
                videoId: videoId,
                userId: authManager.currentUser.id,
                timestamp: Date()
            )

            if let attestation = try? await peer.requestAttestation(request) {
                attestations.append(attestation)
            }
        }

        return attestations
    }
}

struct PeerAttestation {
    let peerId: String
    let videoId: UUID
    let viewerId: UUID
    let bytesUploaded: Int64  // Peer confirms they uploaded chunks to viewer
    let timestamp: Date
    let signature: Data       // Peer's cryptographic signature
}
```

**Peer-side implementation**:
```swift
// Each peer can attest to uploads
func handleAttestationRequest(_ request: AttestationRequest) -> PeerAttestation? {
    // Check if we actually uploaded data to this user
    guard let uploadStats = getUploadStatsFor(userId: request.userId, videoId: request.videoId) else {
        return nil
    }

    // Only attest if we uploaded significant data (>100KB)
    guard uploadStats.bytesUploaded > 100_000 else {
        return nil
    }

    // Create signed attestation
    return PeerAttestation(
        peerId: myPeerId,
        videoId: request.videoId,
        viewerId: request.userId,
        bytesUploaded: uploadStats.bytesUploaded,
        timestamp: Date(),
        signature: signWithPrivateKey(uploadStats)
    )
}
```

**Server validation**:
```typescript
async function validateViewWithAttestations(
    videoId: string,
    userId: string,
    attestations: PeerAttestation[]
): Promise<boolean> {
    // Need at least 3 independent attestations
    if (attestations.length < 3) return false;

    // Verify each attestation signature
    for (const att of attestations) {
        if (!verifyPeerSignature(att)) return false;
    }

    // Verify peers are independent (different IP ranges)
    if (!peersAreIndependent(attestations)) return false;

    // Verify total bytes uploaded is reasonable for video size
    const totalBytes = attestations.reduce((sum, a) => sum + a.bytesUploaded, 0);
    const videoSize = await getVideoSize(videoId);
    if (totalBytes < videoSize * 0.8) return false; // Downloaded at least 80%

    // Check attestation freshness (within 1 hour)
    const now = Date.now();
    if (attestations.some(a => now - a.timestamp > 3600000)) return false;

    return true;
}
```

**Pros**:
- ✅ Decentralized verification
- ✅ Hard to fake (need real peers to cooperate)
- ✅ Leverages existing P2P infrastructure
- ✅ Verifiable by third parties

**Cons**:
- ❌ Requires peer cooperation
- ❌ Complex coordination
- ❌ Privacy concerns (peers know who's watching)
- ❌ Vulnerable if attacker controls many peers
- ❌ Doesn't work for HTTP fallback viewing

---

### Approach 4: Blockchain Settlement (Web3 Integration)

**How it works**:

View events are aggregated and settled on a blockchain for transparent, immutable payments.

**Architecture**:

```
[User App] → [View Event] → [Metadata Server] → [Aggregator] → [Smart Contract] → [Creator Wallet]
```

**Flow**:

1. **Viewing**: User watches video, app generates proof (Approach 2)
2. **Server validation**: Metadata server validates proof and stores view
3. **Hourly aggregation**: Every hour, aggregate view counts per video
4. **Blockchain commit**: Submit aggregated counts to smart contract
5. **Payment distribution**: Smart contract distributes payments to creators

**Smart Contract** (Solidity):
```solidity
// ViewCountOracle.sol
contract ViewCountOracle {
    mapping(bytes32 => uint256) public videoViewCounts;
    mapping(bytes32 => address) public videoCreators;
    mapping(address => uint256) public creatorEarnings;

    address public trustedOracle; // Metadata server address
    uint256 public viewPaymentRate = 0.001 ether; // $0.001 per view

    // Oracle submits view counts every hour
    function submitViewCounts(
        bytes32[] calldata videoIds,
        uint256[] calldata viewCounts,
        bytes calldata signature
    ) external {
        require(msg.sender == trustedOracle, "Unauthorized");
        require(verifySignature(videoIds, viewCounts, signature), "Invalid signature");

        for (uint i = 0; i < videoIds.length; i++) {
            bytes32 videoId = videoIds[i];
            uint256 newViews = viewCounts[i];

            // Update view count
            videoViewCounts[videoId] += newViews;

            // Calculate earnings
            address creator = videoCreators[videoId];
            uint256 earnings = newViews * viewPaymentRate;
            creatorEarnings[creator] += earnings;
        }
    }

    // Creators withdraw earnings
    function withdrawEarnings() external {
        uint256 amount = creatorEarnings[msg.sender];
        require(amount > 0, "No earnings");

        creatorEarnings[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }
}
```

**Metadata server aggregator**:
```typescript
// Every hour, aggregate and submit to blockchain
cron.schedule('0 * * * *', async () => {
    // Get view counts for last hour
    const viewCounts = await db.query(`
        SELECT video_id, COUNT(*) as views
        FROM view_events
        WHERE created_at > NOW() - INTERVAL '1 hour'
        AND verified = true
        GROUP BY video_id
    `);

    // Prepare blockchain submission
    const videoIds = viewCounts.map(v => v.video_id);
    const counts = viewCounts.map(v => v.views);
    const signature = await signWithOracleKey(videoIds, counts);

    // Submit to smart contract
    const tx = await viewCountOracle.submitViewCounts(videoIds, counts, signature);
    await tx.wait();

    console.log(`Submitted ${viewCounts.length} video view counts to blockchain`);
});
```

**Pros**:
- ✅ Transparent and auditable
- ✅ Immutable payment records
- ✅ Automated payment distribution
- ✅ Trustless (smart contract enforces rules)
- ✅ Creator sovereignty (direct wallet payments)

**Cons**:
- ❌ Gas fees for transactions
- ❌ Blockchain throughput limits
- ❌ Complexity (need crypto wallets)
- ❌ Still requires trusted oracle (metadata server)
- ❌ Environmental concerns (if using PoW chain)

**Best chains for this**:
- **Polygon** (low fees, EVM compatible)
- **Arbitrum** (Ethereum L2, cheap)
- **Solana** (high throughput, low fees)
- **Base** (Coinbase L2, good UX)

---

## Recommended Approach for TorTok MVP

### Hybrid Multi-Layer System

Combine approaches for security, practicality, and progressive decentralization:

**Layer 1: Client-Side Attestation** (Approach 2)
- App generates cryptographic proof of viewing
- Proves chunks were downloaded
- Privacy-preserving

**Layer 2: Server-Side Validation** (Approach 1)
- Metadata server validates proofs
- Applies anti-fraud heuristics
- Rate limiting and reputation

**Layer 3: Periodic Blockchain Settlement** (Approach 4)
- Hourly aggregation to smart contract
- Transparent payment distribution
- Auditable by anyone

**Layer 4: Community Governance** (Future)
- Instance operators vote on suspicious accounts
- Staking mechanism (instances stake tokens, lose if fraudulent)
- Distributed fraud detection

### Implementation Phases

#### Phase 1: MVP (Weeks 1-4)
```
Simple server-side counting with anti-fraud:
- JWT-authenticated view events
- Rate limiting (1 view/user/video/hour)
- Watch duration threshold (3+ seconds)
- Basic reputation system
```

#### Phase 2: Enhanced Security (Weeks 5-8)
```
Add cryptographic proofs:
- Chunk commitment scheme
- Merkle tree verification
- Zero-knowledge proofs
```

#### Phase 3: Blockchain Integration (Weeks 9-12)
```
Deploy smart contract on Polygon:
- Hourly view count aggregation
- Creator payment distribution
- Transparent audit logs
```

#### Phase 4: Full Decentralization (Months 4-6)
```
Add swarm attestation:
- Multi-party verification
- Distributed trust model
- Instance staking and slashing
```

---

## Technical Implementation Details

### View Event Data Structure

```swift
// Models/ViewEvent.swift
struct ViewEvent: Codable {
    let id: UUID
    let videoId: UUID
    let userId: UUID

    // Viewing metrics
    let watchedDuration: TimeInterval  // Seconds watched
    let quality: String                // 720p, 480p, 360p
    let completionRate: Double         // 0.0 - 1.0

    // Client attestation
    let chunkProof: ChunkProof?        // Cryptographic proof
    let deviceFingerprint: String      // Anti-fraud

    // Metadata
    let timestamp: Date
    let source: ViewSource             // P2P, HTTP, cache
    let clientVersion: String

    // Signature
    let signature: Data                // Signed by user's key
}

struct ChunkProof: Codable {
    let merkleRoot: Data
    let chunkCommitments: [Data]
    let chunkCount: Int
    let totalBytes: Int64
}

enum ViewSource: String, Codable {
    case p2pDownload = "p2p"
    case httpFallback = "http"
    case localCache = "cache"
}
```

### Anti-Fraud Detection

```swift
// Services/AntifraudService.swift
class AntifraudService {
    func validateViewEvent(_ event: ViewEvent) async -> ValidationResult {
        var score = 1.0
        var reasons: [String] = []

        // Check 1: Watch duration
        if event.watchedDuration < 3.0 {
            score *= 0.1
            reasons.append("Too short (<3s)")
        }

        // Check 2: Rate limiting
        if await hasViewedRecently(event.userId, event.videoId, within: .hour(1)) {
            score *= 0.0
            reasons.append("Duplicate view within 1 hour")
        }

        // Check 3: User reputation
        let reputation = await getUserReputation(event.userId)
        score *= reputation
        if reputation < 0.5 {
            reasons.append("Low user reputation: \(reputation)")
        }

        // Check 4: Completion rate (should be 0-1)
        if event.completionRate < 0 || event.completionRate > 1.05 {
            score *= 0.1
            reasons.append("Invalid completion rate: \(event.completionRate)")
        }

        // Check 5: Device fingerprint uniqueness
        if await isDeviceFingerprintSuspicious(event.deviceFingerprint) {
            score *= 0.5
            reasons.append("Suspicious device fingerprint")
        }

        // Check 6: Verify cryptographic proof
        if let proof = event.chunkProof {
            if !await verifyChunkProof(proof, for: event.videoId) {
                score *= 0.0
                reasons.append("Invalid chunk proof")
            }
        }

        // Check 7: Temporal patterns (binge watching is ok, but not too fast)
        let viewingRate = await getRecentViewingRate(event.userId)
        if viewingRate > 10 { // More than 10 videos per hour
            score *= 0.5
            reasons.append("Suspicious viewing rate: \(viewingRate)/hour")
        }

        return ValidationResult(
            isValid: score > 0.7,
            score: score,
            reasons: reasons
        )
    }
}
```

### Privacy-Preserving Analytics

To provide creators with analytics without revealing individual viewing habits:

```typescript
// Aggregate analytics only
async function getVideoAnalytics(videoId: string): Promise<Analytics> {
    return {
        totalViews: await getTotalViews(videoId),
        uniqueViewers: await getUniqueViewerCount(videoId),  // Count only, no IDs

        // Aggregated metrics (no individual user data)
        avgWatchDuration: await getAvgWatchDuration(videoId),
        completionRate: await getCompletionRate(videoId),

        // Temporal distribution (hourly buckets)
        viewsByHour: await getViewDistribution(videoId, 'hour'),

        // Geographic distribution (country level only, no city)
        viewsByCountry: await getViewsByCountry(videoId),

        // Source distribution
        viewsBySource: await getViewsBySource(videoId), // P2P vs HTTP

        // Retention curve (no user identification)
        retentionCurve: await getRetentionCurve(videoId)
    };
}
```

---

## Economics: Payment Model

### Pay-Per-View Options

**Option 1: Fixed Rate**
- $0.001 per view (roughly YouTube's rate)
- Simple, predictable
- Funded by: ads, subscriptions, or cryptocurrency

**Option 2: Engagement-Weighted**
```
Payment = BaseRate * EngagementMultiplier

EngagementMultiplier = (
    0.4 * CompletionRate +      // Did they finish watching?
    0.3 * LikeBonus +            // Did they like it?
    0.2 * ShareBonus +           // Did they share it?
    0.1 * CommentBonus           // Did they comment?
)
```

**Option 3: Staking & Curation**
- Users stake tokens on videos they think will be popular
- Early supporters get rewards when video becomes popular
- Creates curation incentive

### Funding Mechanisms

1. **User Subscriptions**: $5/month for ad-free + creator support
2. **Advertisements**: Optional ads in free tier (creators get 70% of ad revenue)
3. **Cryptocurrency**: Platform token for payments and governance
4. **Instance Fees**: Instance operators charge nominal fees ($1/month)
5. **Tipping**: Direct creator tips via crypto wallets

---

## Privacy Considerations

### User Privacy

- **No tracking**: Don't store individual viewing history beyond 24 hours
- **Aggregate only**: Only expose aggregate analytics to creators
- **Pseudonymity**: Users can watch without revealing identity
- **Local storage**: Keep viewing history on-device only

### Creator Privacy

- **Earnings privacy**: Don't reveal creator earnings publicly (optional transparency)
- **Viewer privacy**: Can't see who specifically watched (only aggregate stats)

### Compliance

- **GDPR**: Right to deletion, data export, consent
- **CCPA**: California privacy law compliance
- **COPPA**: Age verification for payments

---

## Attack Vectors & Mitigations

### Attack 1: View Botting
**Attack**: Create many fake accounts to boost views
**Mitigation**:
- Device fingerprinting
- IP rate limiting
- Captcha for new accounts
- Reputation system (new accounts have lower weight)
- Cost of attack (Sybil resistance via staking)

### Attack 2: Collusion
**Attack**: Users collude to attest fake views
**Mitigation**:
- Random peer selection for attestation
- Reputation-weighted attestations
- Slashing for fraudulent attestations

### Attack 3: Replay Attacks
**Attack**: Resubmit valid proofs multiple times
**Mitigation**:
- Nonce/timestamp in proofs
- Server-side deduplication
- Proof freshness checks (max 5 minutes old)

### Attack 4: Creator Self-Views
**Attack**: Creator watches own video repeatedly
**Mitigation**:
- Detect and exclude self-views
- Social graph analysis (watching own videos is suspicious)
- Require minimum unique viewers for payment

---

## Open Questions for Discussion

1. **Privacy vs. Fraud Prevention**: How much tracking is acceptable?
2. **Payment Threshold**: Minimum views before payout (avoid spam)?
3. **Instance Trust**: How much to trust instance operators?
4. **Blockchain Choice**: Which chain for settlement?
5. **Token Economics**: Native token or use existing stablecoins?
6. **Governance**: Who decides on fraud disputes?

---

## Next Steps for Implementation

### Week 1-2: Design & Prototyping
- [ ] Finalize technical approach
- [ ] Design database schema for view events
- [ ] Create cryptographic proof protocol spec
- [ ] Design smart contract interface

### Week 3-4: MVP Implementation
- [ ] Implement basic server-side view counting
- [ ] Add anti-fraud heuristics
- [ ] Create admin dashboard for monitoring
- [ ] Set up analytics aggregation

### Week 5-6: Enhanced Security
- [ ] Implement chunk proof generation in iOS app
- [ ] Add server-side proof verification
- [ ] Deploy reputation system
- [ ] Launch beta with trusted users

### Week 7-8: Blockchain Integration
- [ ] Deploy smart contract to testnet
- [ ] Implement view count aggregation
- [ ] Test payment distribution
- [ ] Integrate with creator wallet flow

### Week 9+: Refinement
- [ ] Monitor for fraud patterns
- [ ] Tune anti-fraud parameters
- [ ] Add swarm attestation (if needed)
- [ ] Community governance system

---

## Conclusion

Attested view counting in a decentralized system requires layered security:

1. **Cryptographic proofs** make it hard to fake views
2. **Server-side validation** applies practical anti-fraud measures
3. **Blockchain settlement** provides transparency and auditability
4. **Community governance** handles edge cases and disputes

For TorTok MVP, start with **simple server-side counting** (Approach 1) with robust anti-fraud, then progressively add cryptographic proofs and blockchain settlement as the system matures.

The key insight: **Perfect fraud prevention is impossible, but we can make fraud expensive enough that it's not worth it.**
