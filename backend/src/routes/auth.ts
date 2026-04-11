import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db';
import { AuthRequest, authenticateJWT, generateToken } from '../middleware/auth';
import { validate, schemas } from '../middleware/validate';

const router = Router();

/**
 * POST /auth/register
 * Register a new user
 */
router.post('/register', validate(schemas.register), async (req: AuthRequest, res: Response) => {
  try {
    const { username, email, password, displayName } = req.body;
    const instanceDomain = process.env.INSTANCE_DOMAIN || 'localhost';

    // Check if username exists on this instance
    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1 AND instance_domain = $2',
      [username, instanceDomain]
    );

    if (existingUser.length > 0) {
      res.status(400).json({ error: 'Username already taken on this instance' });
      return;
    }

    // Check if email exists on this instance
    const existingEmail = await query(
      'SELECT id FROM users WHERE email = $1 AND instance_domain = $2',
      [email, instanceDomain]
    );

    if (existingEmail.length > 0) {
      res.status(400).json({ error: 'Email already registered on this instance' });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const users = await query<any>(
      `INSERT INTO users (username, display_name, email, password_hash, instance_domain)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, display_name, email, avatar_url, bio,
                 follower_count, following_count, video_count, created_at`,
      [username, displayName, email, passwordHash, instanceDomain]
    );

    const user = users[0];

    // Generate JWT
    const token = generateToken({
      userId: user.id,
      username: user.username,
      instance: instanceDomain,
    });

    res.status(201).json({
      token,
      refreshToken: token, // TODO: Implement proper refresh tokens
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        avatarURL: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count || 0,
        followingCount: user.following_count || 0,
        videoCount: user.video_count || 0,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/login
 * Login existing user
 */
router.post('/login', validate(schemas.login), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;
    const instanceDomain = process.env.INSTANCE_DOMAIN || 'localhost';

    // Find user
    const users = await query<any>(
      `SELECT id, username, display_name, email, password_hash, avatar_url, bio,
              follower_count, following_count, video_count, created_at
       FROM users
       WHERE email = $1 AND instance_domain = $2`,
      [email, instanceDomain]
    );

    if (users.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = users[0];

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Generate JWT
    const token = generateToken({
      userId: user.id,
      username: user.username,
      instance: instanceDomain,
    });

    res.json({
      token,
      refreshToken: token, // TODO: Implement proper refresh tokens
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        avatarURL: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count || 0,
        followingCount: user.following_count || 0,
        videoCount: user.video_count || 0,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /auth/me
 * Get current user. authenticateJWT must run at the route level — mounting
 * it on the parent `app.use('/auth/me', ...)` after `app.use('/auth', ...)`
 * is a no-op because the sub-router already terminated the request (B1).
 */
router.get('/me', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    // authenticateJWT guarantees req.user is set; the explicit null check
    // below is belt-and-braces.
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const users = await query<any>(
      `SELECT id, username, display_name, email, avatar_url, bio,
              follower_count, following_count, video_count, created_at
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (users.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = users[0];

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
      avatarURL: user.avatar_url,
      bio: user.bio,
      followerCount: user.follower_count || 0,
      followingCount: user.following_count || 0,
      videoCount: user.video_count || 0,
      createdAt: user.created_at,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
