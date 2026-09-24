import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { MembershipStatus, UserStatus, WorkspaceStatus } from '@prisma/client';
import { JwtTokenService } from '../../common/auth/jwt.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  REALTIME_CLIENT_EVENT,
  type RealtimeEntityType,
  type RealtimeEventEnvelope,
  type RealtimeEventType,
} from './realtime.types';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secretKeyPattern =
  /(password|passwd|jwt|otp|api[-_]?key|authorization|secret|token|cookie|raw[-_]?body)/i;
const payloadMaxBytes = 4096;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;
  private redisFanoutHealthy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: JwtTokenService,
  ) {}

  attachServer(server: Server) {
    this.server = server;
  }

  setRedisFanoutHealthy(healthy: boolean) {
    this.redisFanoutHealthy = healthy;
  }

  isRedisFanoutHealthy() {
    return this.redisFanoutHealthy;
  }

  async authenticateToken(token: string | undefined) {
    if (!token) return null;
    const tokenUser = (() => {
      try {
        return this.tokens.verifyAccessToken(token);
      } catch {
        return null;
      }
    })();
    if (!tokenUser) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: tokenUser.id },
      select: { id: true, email: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE || user.email !== tokenUser.email) {
      return null;
    }
    return { id: user.id, email: user.email };
  }

  async resolveWorkspaceMembership(userId: string, workspaceId: string) {
    if (!uuidPattern.test(workspaceId)) return null;
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: {
        id: true,
        status: true,
        workspace: { select: { id: true, status: true } },
      },
    });
    if (
      !membership ||
      membership.status !== MembershipStatus.ACTIVE ||
      membership.workspace.status !== WorkspaceStatus.ACTIVE
    ) {
      return null;
    }
    return { workspaceId: membership.workspace.id, membershipId: membership.id };
  }

  workspaceRoom(workspaceId: string) {
    return `workspace:${workspaceId}`;
  }

  memberRoom(workspaceId: string, membershipId: string) {
    return `member:${workspaceId}:${membershipId}`;
  }

  buildEvent(input: {
    eventType: RealtimeEventType;
    workspaceId: string;
    entityType?: RealtimeEntityType;
    entityId?: string | null;
    actorMembershipId?: string | null;
    payload?: Record<string, unknown>;
  }): RealtimeEventEnvelope {
    const payload = input.payload ?? {};
    assertSafePayload(payload);
    return {
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: input.eventType,
      workspaceId: input.workspaceId,
      occurredAt: new Date().toISOString(),
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      actorMembershipId: input.actorMembershipId ?? null,
      payload,
    };
  }

  publishWorkspace(input: Parameters<RealtimeService['buildEvent']>[0]): Promise<void> {
    return this.emit(this.workspaceRoom(input.workspaceId), this.buildEvent(input));
  }

  publishMember(
    workspaceId: string,
    membershipId: string,
    input: Omit<Parameters<RealtimeService['buildEvent']>[0], 'workspaceId'>,
  ): Promise<void> {
    return this.emit(
      this.memberRoom(workspaceId, membershipId),
      this.buildEvent({ ...input, workspaceId }),
    );
  }

  private emit(room: string, envelope: RealtimeEventEnvelope): Promise<void> {
    if (!this.server) return Promise.resolve();
    try {
      this.server.to(room).emit(REALTIME_CLIENT_EVENT, envelope);
    } catch (error) {
      this.logger.warn({
        message: 'Realtime publish failed; authoritative REST state remains available',
        eventType: envelope.eventType,
        workspaceId: envelope.workspaceId,
        entityType: envelope.entityType ?? null,
        entityId: envelope.entityId ?? null,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    return Promise.resolve();
  }
}

function assertSafePayload(payload: Record<string, unknown>) {
  assertSafeValue(payload, []);
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > payloadMaxBytes) {
    throw new Error('REALTIME_PAYLOAD_TOO_LARGE');
  }
}

function assertSafeValue(value: unknown, path: string[]) {
  if (path.some((key) => secretKeyPattern.test(key))) {
    throw new Error('REALTIME_PAYLOAD_SENSITIVE');
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValue(item, [...path, String(index)]));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (secretKeyPattern.test(key)) throw new Error('REALTIME_PAYLOAD_SENSITIVE');
      assertSafeValue(item, [...path, key]);
    }
    return;
  }
  throw new Error('REALTIME_PAYLOAD_UNSAFE');
}
