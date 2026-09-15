import { Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import type { AuthenticatedUser } from './auth.types';

interface AccessTokenPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtTokenService {
  private readonly env = validateEnvironment(process.env);

  signAccessToken(user: AuthenticatedUser) {
    return jwt.sign({ sub: user.id, email: user.email }, this.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      issuer: 'zea-play-api',
      audience: 'zea-play-web',
      jwtid: randomUUID(),
    });
  }

  verifyAccessToken(token: string): AuthenticatedUser {
    try {
      const payload = jwt.verify(token, this.env.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: 'zea-play-api',
        audience: 'zea-play-web',
      }) as AccessTokenPayload;
      return { id: payload.sub, email: payload.email };
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }

  createRefreshToken() {
    return randomBytes(48).toString('base64url');
  }

  createCsrfToken() {
    return randomBytes(32).toString('base64url');
  }

  createTokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  createRefreshExpiry() {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000);
  }
}
