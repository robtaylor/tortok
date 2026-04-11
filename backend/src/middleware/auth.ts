import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';

// JWT_SECRET is mandatory. A missing secret used to fall back to a
// hard-coded development string, which is an obvious footgun if the
// env var ever goes missing in production — every token would verify
// against a value anyone reading the repo already knows (S1 in the
// Phase 0a punch list). Fail loudly at import time instead.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Refusing to start with an insecure default. ' +
      'Set JWT_SECRET in the environment (see .env.example).'
  );
}
// Local non-null alias so the rest of the module doesn't have to
// re-narrow the type on every use.
const SECRET: string = JWT_SECRET;

export interface AuthPayload {
  userId: string;
  username: string;
  instance: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

/**
 * Middleware to verify JWT token
 */
export function authenticateJWT(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'No authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const decoded = jwt.verify(token, SECRET) as AuthPayload;

    // Verify token is for this instance
    const instanceDomain = process.env.INSTANCE_DOMAIN || 'localhost';
    if (decoded.instance !== instanceDomain) {
      res.status(401).json({ error: 'Token from wrong instance' });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Generate JWT token
 */
export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as SignOptions);
}

/**
 * Optional authentication (doesn't fail if no token)
 */
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, SECRET) as AuthPayload;
    req.user = decoded;
  } catch (error) {
    // Invalid token, but continue anyway (optional auth)
  }

  next();
}
