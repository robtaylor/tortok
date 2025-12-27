# Federated Authentication in TorTok

## Overview

TorTok uses **instance-based federated authentication**, similar to Mastodon and other ActivityPub platforms. Users belong to a specific instance (metadata server) and authenticate with that instance, not a central authority.

## Key Concepts

### 1. Instance-Based Identity

Users have identities tied to their home instance:

```
@alice@tortok.social
@bob@videos.example.com
@carol@my-instance.net
```

**Format**: `@username@instance-domain`

This is similar to email addresses - your identity includes which server you're registered with.

### 2. Home Instance

- **Home Instance**: The metadata server where you created your account
- **Authentication**: Always happens against your home instance
- **Data Storage**: Your home instance stores your profile, videos metadata, followers
- **Federation**: Your home instance federates your data to other instances

## Authentication Flow

### Initial Setup: Choosing an Instance

When a user first opens TorTok:

```swift
// 1. User selects or enters their instance
struct InstanceSelectionView: View {
    @State private var instanceURL = ""

    var body: some View {
        VStack {
            Text("Choose your TorTok instance")

            // Popular instances
            ForEach(popularInstances) { instance in
                Button(instance.name) {
                    selectedInstance = instance.url
                }
            }

            // Custom instance
            TextField("Or enter instance URL", text: $instanceURL)

            Button("Continue") {
                navigateToLogin()
            }
        }
    }
}
```

Popular instances could be:
- `tortok.social` (main community instance)
- `videos.tech` (tech-focused instance)
- `localhost:3000` (self-hosted)

### Registration Flow

```
User -> iOS App -> Home Instance -> Database
```

**Steps**:

1. **User enters registration info**:
   ```swift
   struct RegisterView: View {
       @State private var username = ""
       @State private var email = ""
       @State private var password = ""

       func register() async {
           // Instance URL was selected earlier
           let instance = "https://tortok.social"

           let request = RegisterRequest(
               email: email,
               password: password,
               username: username,
               displayName: username
           )

           let response: AuthResponse = try await APIClient(baseURL: instance)
               .post("/auth/register", body: request)

           // Store credentials
           authManager.saveAuth(
               token: response.token,
               instanceURL: instance,
               user: response.user
           )
       }
   }
   ```

2. **Instance creates account**:
   ```typescript
   // Metadata server
   app.post('/auth/register', async (req, res) => {
       const { email, password, username } = req.body;

       // Check username is unique on this instance
       if (await usernameExists(username)) {
           return res.status(400).json({ error: 'Username taken' });
       }

       // Create account
       const user = await db.users.create({
           username,
           email,
           passwordHash: await bcrypt.hash(password, 10),
           instanceDomain: req.hostname, // e.g., 'tortok.social'
           createdAt: new Date()
       });

       // Generate JWT
       const token = jwt.sign(
           { userId: user.id, instance: req.hostname },
           JWT_SECRET,
           { expiresIn: '7d' }
       );

       res.json({ token, user });
   });
   ```

3. **App stores credentials**:
   ```swift
   class AuthManager {
       func saveAuth(token: String, instanceURL: String, user: User) {
           UserDefaults.standard.set(token, forKey: "auth_token")
           UserDefaults.standard.set(instanceURL, forKey: "instance_url")
           UserDefaults.standard.set(user.id.uuidString, forKey: "user_id")

           // Store in Keychain (more secure)
           KeychainHelper.save(token, key: "auth_token")
           KeychainHelper.save(instanceURL, key: "instance_url")
       }
   }
   ```

### Login Flow

```
User -> iOS App -> Home Instance -> Verify -> Return JWT
```

**Implementation**:

```swift
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var instanceURL: String?

    private var authToken: String?

    func login(username: String, password: String, instance: String) async throws {
        // Create API client for this instance
        let apiClient = APIClient(baseURL: instance)

        let request = LoginRequest(
            email: username,
            password: password
        )

        let response: AuthResponse = try await apiClient.post("/auth/login", body: request)

        // Store credentials
        self.authToken = response.token
        self.instanceURL = instance
        self.currentUser = response.user
        self.isAuthenticated = true

        // Persist to storage
        saveAuth(token: response.token, instanceURL: instance, user: response.user)
    }
}
```

**Server verification**:

```typescript
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    // Find user on this instance
    const user = await db.users.findOne({
        email,
        instanceDomain: req.hostname
    });

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT with instance claim
    const token = jwt.sign(
        {
            userId: user.id,
            instance: req.hostname,
            username: user.username
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    res.json({ token, user });
});
```

### Authenticated Requests

All API requests include the JWT token:

```swift
class APIClient {
    private var authToken: String?

    func get<T: Decodable>(_ path: String) async throws -> T {
        var headers = HTTPHeaders()
        headers.add(.contentType("application/json"))

        // Add auth token from user's home instance
        if let token = authToken {
            headers.add(.authorization(bearerToken: token))
        }

        let response = await session.request(
            baseURL + path,
            method: .get,
            headers: headers
        )

        return try await response.serializingDecodable(T.self).value
    }
}
```

**Server verifies token**:

```typescript
function authenticateJWT(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Verify token is for this instance
        if (decoded.instance !== req.hostname) {
            return res.status(401).json({ error: 'Token from wrong instance' });
        }

        req.user = { id: decoded.userId, username: decoded.username };
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}
```

## Cross-Instance Interactions

### Following Users on Other Instances

When `@alice@tortok.social` wants to follow `@bob@videos.example.com`:

```
Alice's App -> tortok.social -> videos.example.com -> Confirm Follow
```

**App implementation**:

```swift
func followUser(username: String, instance: String) async throws {
    // User's full handle: @bob@videos.example.com
    let fullHandle = "@\(username)@\(instance)"

    // Request to Alice's home instance
    let _: EmptyResponse = try await apiClient.post(
        "/users/follow",
        body: ["handle": fullHandle]
    )
}
```

**Alice's instance (tortok.social)**:

```typescript
app.post('/users/follow', authenticateJWT, async (req, res) => {
    const { handle } = req.body; // @bob@videos.example.com
    const [_, username, instanceDomain] = handle.match(/@(\w+)@([\w\.]+)/);

    if (instanceDomain === req.hostname) {
        // Local follow (same instance)
        await createLocalFollow(req.user.id, username);
    } else {
        // Remote follow (different instance)
        await createRemoteFo(req.user.id, username, instanceDomain);

        // Notify Bob's instance via ActivityPub
        await federatedFollow(req.user.id, username, instanceDomain);
    }

    res.json({ success: true });
});

async function federatedFollow(followerId, targetUsername, targetInstance) {
    // ActivityPub Follow activity
    const activity = {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Follow",
        "actor": `https://${req.hostname}/users/${followerId}`,
        "object": `https://${targetInstance}/users/${targetUsername}`
    };

    // Send to Bob's instance
    await axios.post(
        `https://${targetInstance}/inbox`,
        activity,
        {
            headers: {
                'Content-Type': 'application/activity+json'
            }
        }
    );
}
```

**Bob's instance (videos.example.com)** receives the follow:

```typescript
app.post('/inbox', async (req, res) => {
    const activity = req.body;

    if (activity.type === 'Follow') {
        // Extract follower info
        const followerURL = activity.actor; // https://tortok.social/users/alice
        const followerInstance = new URL(followerURL).hostname;

        // Fetch follower profile from their instance
        const followerProfile = await axios.get(followerURL, {
            headers: { 'Accept': 'application/activity+json' }
        });

        // Create follower relationship in local DB
        await db.follows.create({
            followerId: followerProfile.id,
            followedId: extractLocalUserId(activity.object),
            followerInstance: followerInstance,
            isRemote: true
        });

        // Send Accept activity back
        await sendAcceptActivity(activity);
    }

    res.status(202).json({ success: true });
});
```

### Viewing Videos from Other Instances

When viewing a video from another instance:

```swift
struct Video {
    let id: UUID
    let user: User
    let magnetLink: String      // P2P - works across instances!
    let hlsURL: URL?            // HTTP fallback - instance-specific
    let instanceURL: String     // Which instance this video is from
}

func loadVideo(_ video: Video) async {
    if video.instanceURL == authManager.instanceURL {
        // Local video - use home instance API
        try await videoPlayer.loadVideo(video, p2pEnabled: true)
    } else {
        // Remote video - use P2P (magnet link)
        // HTTP fallback goes to origin instance
        try await videoPlayer.loadVideo(video, p2pEnabled: true)
    }
}
```

**Key insight**: P2P (magnet links) work across instances! Only metadata needs to federate.

## Instance Discovery

Users need to find and choose an instance. Options:

### 1. Curated List

```swift
struct Instance: Identifiable {
    let id: UUID
    let name: String
    let domain: String
    let description: String
    let userCount: Int
    let isOpenRegistration: Bool
}

let popularInstances = [
    Instance(
        name: "TorTok Social",
        domain: "tortok.social",
        description: "General purpose community instance",
        userCount: 10000,
        isOpenRegistration: true
    ),
    Instance(
        name: "Tech Videos",
        domain: "videos.tech",
        description: "Technology and programming content",
        userCount: 5000,
        isOpenRegistration: true
    )
]
```

### 2. Instance API Discovery

Each instance exposes metadata:

```typescript
app.get('/.well-known/tortok', (req, res) => {
    res.json({
        name: "TorTok Social",
        version: "1.0.0",
        description: "General purpose TorTok instance",
        registrationOpen: true,
        userCount: await db.users.count(),
        videoCount: await db.videos.count(),
        federationEnabled: true,
        supportedProtocols: ["activitypub", "tortok-federation-v1"]
    });
});
```

App can verify instance before login:

```swift
func verifyInstance(_ url: String) async throws -> InstanceInfo {
    let apiClient = APIClient(baseURL: url)
    let info: InstanceInfo = try await apiClient.get("/.well-known/tortok")

    guard info.registrationOpen else {
        throw AuthError.registrationClosed
    }

    return info
}
```

## Security Considerations

### 1. Instance Impersonation Prevention

**Problem**: Malicious instance claims to be `tortok.social`

**Solution**: Use HTTPS + domain verification

```swift
func verifyInstanceDomain(_ instanceURL: String) -> Bool {
    guard let url = URL(string: instanceURL),
          let host = url.host,
          url.scheme == "https" else {
        return false
    }

    // Optional: Check against known instance list
    // Optional: Verify SSL certificate
    return true
}
```

### 2. Token Security

**Best practices**:
- Store tokens in iOS Keychain (not UserDefaults)
- Use HTTPS for all API calls
- Implement token refresh
- Short token expiry (7 days)

```swift
class KeychainHelper {
    static func save(_ value: String, key: String) {
        let data = value.data(using: .utf8)!

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]

        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true
        ]

        var result: AnyObject?
        SecItemCopyMatching(query as CFDictionary, &result)

        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
```

### 3. Cross-Instance Request Verification

When instance A makes a request to instance B:

```typescript
// Instance B verifies the request is really from Instance A
async function verifyInstanceSignature(req) {
    const signature = req.headers['signature'];
    const instanceDomain = extractInstanceFromSignature(signature);

    // Fetch instance A's public key
    const publicKey = await fetchInstancePublicKey(instanceDomain);

    // Verify signature
    return crypto.verify(
        req.body,
        signature,
        publicKey
    );
}
```

## Migration Between Instances

Users should be able to move their account:

```swift
func migrateToInstance(newInstance: String) async throws {
    // 1. Create account on new instance
    let newAccount = try await registerOnNewInstance(newInstance)

    // 2. Export data from old instance
    let exportData = try await apiClient.get("/users/export")

    // 3. Import to new instance
    try await newAPIClient.post("/users/import", body: exportData)

    // 4. Notify followers of move
    try await apiClient.post("/users/migrate", body: [
        "newInstance": newInstance,
        "newUsername": newAccount.username
    ])

    // 5. Update app credentials
    authManager.updateInstance(newInstance, token: newAccount.token)
}
```

Old instance notifies followers:

```typescript
app.post('/users/migrate', authenticateJWT, async (req, res) => {
    const { newInstance, newUsername } = req.body;

    // Get user's followers
    const followers = await db.follows.findAll({
        followedId: req.user.id
    });

    // Send Move activity to all followers' instances
    for (const follower of followers) {
        if (follower.isRemote) {
            await federatedMove(req.user, newInstance, newUsername, follower.followerInstance);
        }
    }

    res.json({ success: true });
});
```

## Current Implementation Status

### ✅ What's Implemented

- Basic JWT authentication
- Instance URL configuration (hardcoded for now)
- Token storage
- Authenticated API requests

### ⚠️ What's Stubbed

- Instance selection UI
- Federation protocol
- Cross-instance following
- Instance discovery

### ❌ Not Implemented Yet

- ActivityPub integration
- Instance migration
- Keychain storage
- Token refresh

## Next Steps

### Phase 1: Local Authentication (MVP)
1. ✅ Basic JWT auth with single instance
2. ✅ Token storage
3. ⚠️ Move to Keychain storage
4. ⚠️ Add token refresh

### Phase 2: Multi-Instance Support
1. Add instance selection on first launch
2. Store instance URL with credentials
3. Support multiple accounts (different instances)
4. Account switcher UI

### Phase 3: Federation
1. Implement ActivityPub inbox/outbox
2. Cross-instance following
3. Federated feed (see posts from other instances)
4. Instance discovery API

### Phase 4: Advanced Features
1. Account migration
2. Instance blocking/allowlisting
3. Federated search
4. Instance moderation tools

## Example: Complete Login Flow

Here's what happens when a user logs in:

```swift
// 1. User selects instance (first time only)
let instanceURL = "https://tortok.social"

// 2. User enters credentials
let username = "alice"
let password = "password123"

// 3. App sends login request to user's instance
let apiClient = APIClient(baseURL: instanceURL)
let request = LoginRequest(email: username, password: password)
let response: AuthResponse = try await apiClient.post("/auth/login", body: request)

// 4. Instance verifies and returns JWT
// response.token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
// response.user = User(id: ..., username: "alice", ...)

// 5. App stores credentials
KeychainHelper.save(response.token, key: "auth_token")
UserDefaults.standard.set(instanceURL, key: "instance_url")
UserDefaults.standard.set(response.user.username, key: "username")

// 6. App updates state
authManager.isAuthenticated = true
authManager.currentUser = response.user
authManager.instanceURL = instanceURL

// 7. User can now make authenticated requests to their instance
// All subsequent API calls include: Authorization: Bearer <token>
```

## Conclusion

TorTok's federated authentication model:

- **Decentralized**: No single auth provider
- **Instance-based**: Users belong to specific servers
- **Interoperable**: Can interact across instances
- **Portable**: Can migrate between instances
- **Secure**: Standard JWT + HTTPS

This gives users:
- **Choice**: Pick or run your own instance
- **Control**: Own your data
- **Privacy**: No central surveillance
- **Resilience**: No single point of failure

The P2P video delivery works seamlessly across instances because magnet links are universal - only metadata needs to federate!
