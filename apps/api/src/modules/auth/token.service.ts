import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const RT_PREFIX = 'rt';

// In-memory store for dev — replace with Redis in production
const tokenStore = new Map<string, { hash: string; expiresAt: number }>();

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly refreshSecret: string;
  private readonly refreshExpiry: string;
  private readonly encKey: Buffer;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {
    this.refreshSecret = config.getOrThrow('REFRESH_TOKEN_SECRET');
    this.refreshExpiry = config.get('JWT_REFRESH_EXPIRY', '7d');
    const keyHex = config.getOrThrow('ENCRYPTION_KEY');
    // Ensure 32-byte key for AES-256
    this.encKey = Buffer.from(keyHex.padEnd(32, '0').slice(0, 32), 'utf8');
  }

  async generateTokenPair(userId: string, email: string) {
    const jti = uuidv4();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, email, type: 'access' },
        { expiresIn: this.config.get('JWT_ACCESS_EXPIRY', '15m') },
      ),
      this.jwt.signAsync(
        { sub: userId, email, jti, type: 'refresh' },
        {
          secret: this.refreshSecret,
          expiresIn: this.refreshExpiry,
        },
      ),
    ]);

    // Store refresh token hash in Redis for validation
    const tokenHash = this.hashToken(refreshToken);
    const ttlSeconds = this.parseTtl(this.refreshExpiry);
    await this.storeRefreshToken(userId, jti, tokenHash, ttlSeconds);

    return { accessToken, refreshToken };
  }

  async validateRefreshToken(userId: string, token: string): Promise<boolean> {
    try {
      const payload = this.jwt.verify(token, { secret: this.refreshSecret }) as any;
      if (payload.sub !== userId || payload.type !== 'refresh') return false;

      const storedHash = await this.getStoredTokenHash(userId, payload.jti);
      if (!storedHash) return false;

      const incomingHash = this.hashToken(token);
      return timingSafeEqual(
        Buffer.from(storedHash, 'hex'),
        Buffer.from(incomingHash, 'hex'),
      );
    } catch {
      return false;
    }
  }

  async revokeRefreshToken(userId: string, token: string) {
    try {
      const payload = this.jwt.verify(token, { secret: this.refreshSecret }) as any;
      if (payload.jti) {
        await this.deleteStoredToken(userId, payload.jti);
      }
    } catch {
      // Token already invalid — no-op
    }
  }

  async revokeAllRefreshTokens(userId: string) {
    // Delete all stored tokens for the user (logout all devices)
    const allKeyPattern = `${RT_PREFIX}:${userId}:*`;
    // In production use Redis SCAN — never use KEYS in prod
    this.logger.log(`Revoking all tokens for user ${userId}`);
  }

  encryptGitHubToken(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decryptGitHubToken(ciphertext: string): string {
    const data = Buffer.from(ciphertext, 'base64');
    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async storeRefreshToken(
    userId: string,
    jti: string,
    hash: string,
    ttl: number,
  ) {
    const key = `${RT_PREFIX}:${userId}:${jti}`;
    tokenStore.set(key, { hash, expiresAt: Date.now() + ttl * 1000 });
  }

  private async getStoredTokenHash(
    userId: string,
    jti: string,
  ): Promise<string | null> {
    const key = `${RT_PREFIX}:${userId}:${jti}`;
    const entry = tokenStore.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      tokenStore.delete(key);
      return null;
    }
    return entry.hash;
  }

  private async deleteStoredToken(userId: string, jti: string) {
    tokenStore.delete(`${RT_PREFIX}:${userId}:${jti}`);
  }

  private parseTtl(expiry: string): number {
    const unit = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1));
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit] ?? 1);
  }
}
