import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { validateEnvironment } from '@zea-play/config';
import { createRedisOptions } from '../../infrastructure/redis/redis-options';
import { RealtimeService } from './realtime.service';
import {
  REALTIME_SUBSCRIBE_WORKSPACE,
  REALTIME_UNSUBSCRIBE_WORKSPACE,
  type RealtimeSocketData,
} from './realtime.types';

const subscribeWindowMs = 10_000;
const subscribeMaxPerWindow = 20;
const authRecheckMs = 60_000;

@WebSocketGateway({ namespace: '/realtime', cors: { credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly env = validateEnvironment(process.env);
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private readonly authTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly realtime: RealtimeService) {}

  async afterInit(server: Server) {
    this.realtime.attachServer(server);
    if (process.env.NODE_ENV === 'test') {
      this.realtime.setRedisFanoutHealthy(false);
      return;
    }
    try {
      this.pubClient = new Redis(
        this.env.REDIS_REALTIME_URL,
        createRedisOptions('realtime-socket'),
      );
      this.subClient = this.pubClient.duplicate();
      await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
      server.adapter(createAdapter(this.pubClient, this.subClient));
      this.realtime.setRedisFanoutHealthy(true);
      this.logger.log('Realtime Redis adapter configured');
    } catch (error) {
      this.realtime.setRedisFanoutHealthy(false);
      this.logger.warn({
        message: 'Realtime Redis adapter degraded; process-local sockets remain usable',
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  async handleConnection(client: Socket) {
    const token = tokenFromHandshake(client);
    const user = await this.realtime.authenticateToken(token).catch(() => null);
    if (!user) {
      client.disconnect(true);
      return;
    }
    client.data = { ...(client.data as RealtimeSocketData), authToken: token, user, rooms: [] };
    this.startAuthRecheck(client);
  }

  handleDisconnect(client: Socket) {
    this.stopAuthRecheck(client);
    const data = client.data as RealtimeSocketData;
    data.rooms = [];
  }

  @SubscribeMessage(REALTIME_SUBSCRIBE_WORKSPACE)
  async subscribeWorkspace(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workspaceId?: unknown },
  ) {
    if (!this.consumeSubscriptionToken(client)) return { ok: false, code: 'RATE_LIMITED' };
    const data = client.data as RealtimeSocketData;
    if (!data.user) {
      client.disconnect(true);
      return { ok: false, code: 'AUTH_REQUIRED' };
    }
    const user = await this.refreshSocketAuth(client);
    if (!user) return { ok: false, code: 'AUTH_REQUIRED' };
    if (typeof body?.workspaceId !== 'string') return { ok: false, code: 'INVALID_WORKSPACE' };
    const membership = await this.realtime.resolveWorkspaceMembership(user.id, body.workspaceId);
    if (!membership) return { ok: false, code: 'WORKSPACE_ACCESS_DENIED' };
    await this.leaveCurrentRooms(client);
    const rooms = [
      this.realtime.workspaceRoom(membership.workspaceId),
      this.realtime.memberRoom(membership.workspaceId, membership.membershipId),
    ];
    for (const room of rooms) await client.join(room);
    data.workspaceId = membership.workspaceId;
    data.membershipId = membership.membershipId;
    data.rooms = rooms;
    return { ok: true, workspaceId: membership.workspaceId, membershipId: membership.membershipId };
  }

  @SubscribeMessage(REALTIME_UNSUBSCRIBE_WORKSPACE)
  async unsubscribeWorkspace(@ConnectedSocket() client: Socket) {
    await this.leaveCurrentRooms(client);
    return { ok: true };
  }

  private async leaveCurrentRooms(client: Socket) {
    const data = client.data as RealtimeSocketData;
    for (const room of data.rooms ?? []) {
      await client.leave(room);
    }
    data.rooms = [];
    data.workspaceId = undefined;
    data.membershipId = undefined;
  }

  private startAuthRecheck(client: Socket) {
    this.stopAuthRecheck(client);
    const timer = setInterval(() => {
      void this.refreshSocketAuth(client);
    }, authRecheckMs);
    timer.unref?.();
    this.authTimers.set(client.id, timer);
  }

  private stopAuthRecheck(client: Socket) {
    const timer = this.authTimers.get(client.id);
    if (timer) clearInterval(timer);
    this.authTimers.delete(client.id);
  }

  private async refreshSocketAuth(client: Socket) {
    const data = client.data as RealtimeSocketData;
    const user = await this.realtime.authenticateToken(data.authToken).catch(() => null);
    if (!user) {
      await this.leaveCurrentRooms(client);
      client.disconnect(true);
      return null;
    }
    data.user = user;
    return user;
  }

  private consumeSubscriptionToken(client: Socket) {
    const data = client.data as RealtimeSocketData;
    const now = Date.now();
    const current = data.rate;
    if (!current || now - current.windowStartedAt > subscribeWindowMs) {
      data.rate = { windowStartedAt: now, count: 1 };
      return true;
    }
    current.count += 1;
    return current.count <= subscribeMaxPerWindow;
  }
}

function tokenFromHandshake(client: Socket) {
  const token = client.handshake.auth?.token;
  return typeof token === 'string' ? token : undefined;
}
