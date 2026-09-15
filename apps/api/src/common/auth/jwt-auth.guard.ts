import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JwtTokenService } from './jwt.service';
import type { RequestWithAuth } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: JwtTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & RequestWithAuth>();
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer (?<token>[A-Za-z0-9._~-]+)$/);
    if (!match?.groups?.token) {
      throw new UnauthorizedException('Authentication required.');
    }
    const tokenUser = this.tokens.verifyAccessToken(match.groups.token);
    const user = await this.prisma.user.findUnique({
      where: { id: tokenUser.id },
      select: { id: true, email: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE || user.email !== tokenUser.email) {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
    request.user = { id: user.id, email: user.email };
    return true;
  }
}
