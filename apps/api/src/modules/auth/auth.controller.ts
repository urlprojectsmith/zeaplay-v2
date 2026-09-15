import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { validateEnvironment, type Environment } from '@zea-play/config';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../common/auth/auth.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly env = validateEnvironment(process.env);

  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto.email, dto.password, requestMeta(request));
    setAuthCookies(response, this.env, result.refreshToken, result.csrfToken);
    return withoutRefreshToken(result);
  }

  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = readCookie(request, this.env.REFRESH_TOKEN_COOKIE_NAME);
    const csrfToken = request.header('x-csrf-token');
    if (!refreshToken || !csrfToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    const result = await this.auth.refresh(refreshToken, csrfToken, requestMeta(request));
    setAuthCookies(response, this.env, result.refreshToken, result.csrfToken);
    return withoutRefreshToken(result);
  }

  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = readCookie(request, this.env.REFRESH_TOKEN_COOKIE_NAME);
    const csrfToken = request.header('x-csrf-token');
    if (refreshToken && !csrfToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    clearAuthCookies(response, this.env);
    return this.auth.logout(user.id, refreshToken, csrfToken, requestMeta(request));
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}

type AuthCookieEnvironment = Pick<
  Environment,
  | 'APP_ENV'
  | 'NODE_ENV'
  | 'REFRESH_TOKEN_COOKIE_NAME'
  | 'CSRF_COOKIE_NAME'
  | 'AUTH_COOKIE_DOMAIN'
  | 'REFRESH_TOKEN_TTL_SECONDS'
>;

function setAuthCookies(
  response: Response,
  env: AuthCookieEnvironment,
  refreshToken: string,
  csrfToken: string,
) {
  const secure = env.APP_ENV === 'production' || env.NODE_ENV === 'production';
  const maxAge = env.REFRESH_TOKEN_TTL_SECONDS * 1000;
  const domain = env.AUTH_COOKIE_DOMAIN || undefined;
  response.cookie(env.REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge,
    domain,
  });
  response.cookie(env.CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
    domain,
  });
}

function clearAuthCookies(response: Response, env: AuthCookieEnvironment) {
  const secure = env.APP_ENV === 'production' || env.NODE_ENV === 'production';
  const domain = env.AUTH_COOKIE_DOMAIN || undefined;
  response.clearCookie(env.REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/v1/auth',
    domain,
  });
  response.clearCookie(env.CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    domain,
  });
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.cookie ?? '';
  for (const segment of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = segment.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function withoutRefreshToken<T extends { refreshToken: string }>(result: T) {
  const safe: Partial<T> = { ...result };
  delete safe.refreshToken;
  return safe;
}

function requestMeta(request: Request) {
  return {
    ipAddress: request.ip,
    userAgent: request.get('user-agent'),
  };
}
