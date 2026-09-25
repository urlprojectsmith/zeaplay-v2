import { RealtimeGateway } from './realtime.gateway';
import {
  REALTIME_SUBSCRIBE_WORKSPACE,
  REALTIME_UNSUBSCRIBE_WORKSPACE,
  type RealtimeSocketData,
} from './realtime.types';

describe('RealtimeGateway', () => {
  const realtime = {
    authenticateToken: jest.fn(),
    resolveWorkspaceMembership: jest.fn(),
    workspaceRoom: jest.fn((workspaceId: string) => `workspace:${workspaceId}`),
    memberRoom: jest.fn(
      (workspaceId: string, membershipId: string) => `member:${workspaceId}:${membershipId}`,
    ),
    attachServer: jest.fn(),
    setRedisFanoutHealthy: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('authenticates sockets from auth payload only and never trusts query tokens', async () => {
    const gateway = new RealtimeGateway(realtime as never);
    const client = clientMock({ auth: { token: 'auth-token' }, query: { token: 'query-token' } });
    realtime.authenticateToken.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });

    await gateway.handleConnection(client as never);

    expect(realtime.authenticateToken).toHaveBeenCalledWith('auth-token');
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.data).toMatchObject({
      authToken: 'auth-token',
      user: { id: 'user-1', email: 'user@example.com' },
      rooms: [],
    });
    gateway.handleDisconnect(client as never);
  });

  it('disconnects unauthenticated sockets', async () => {
    const gateway = new RealtimeGateway(realtime as never);
    const client = clientMock({ auth: {}, query: { token: 'query-token' } });
    realtime.authenticateToken.mockResolvedValue(null);

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('re-authorizes subscribe requests and only joins server-generated rooms', async () => {
    const gateway = new RealtimeGateway(realtime as never);
    const client = clientMock({ auth: { token: 'token' } });
    client.data = {
      authToken: 'token',
      user: { id: 'user-1', email: 'user@example.com' },
      rooms: ['workspace:old'],
    } satisfies RealtimeSocketData;
    realtime.authenticateToken.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    realtime.resolveWorkspaceMembership.mockResolvedValue({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      membershipId: 'member-1',
    });

    const result = await gateway.subscribeWorkspace(
      client as never,
      {
        workspaceId: '00000000-0000-4000-8000-000000000001',
        room: 'workspace:attacker',
      } as never,
    );

    expect(result).toEqual({
      ok: true,
      workspaceId: '00000000-0000-4000-8000-000000000001',
      membershipId: 'member-1',
    });
    expect(client.leave).toHaveBeenCalledWith('workspace:old');
    expect(client.join).toHaveBeenCalledTimes(2);
    expect(client.join).toHaveBeenCalledWith('workspace:00000000-0000-4000-8000-000000000001');
    expect(client.join).toHaveBeenCalledWith(
      'member:00000000-0000-4000-8000-000000000001:member-1',
    );
    expect(client.join).not.toHaveBeenCalledWith('workspace:attacker');
  });

  it('disconnects and clears rooms when a connected socket token expires before subscribe', async () => {
    const gateway = new RealtimeGateway(realtime as never);
    const client = clientMock({ auth: { token: 'expired' } });
    client.data = {
      authToken: 'expired',
      user: { id: 'user-1', email: 'user@example.com' },
      rooms: ['workspace:old', 'member:old:member-1'],
    } satisfies RealtimeSocketData;
    realtime.authenticateToken.mockResolvedValue(null);

    const result = await gateway.subscribeWorkspace(client as never, {
      workspaceId: '00000000-0000-4000-8000-000000000001',
    });

    expect(result).toEqual({ ok: false, code: 'AUTH_REQUIRED' });
    expect(client.leave).toHaveBeenCalledWith('workspace:old');
    expect(client.leave).toHaveBeenCalledWith('member:old:member-1');
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(realtime.resolveWorkspaceMembership).not.toHaveBeenCalled();
  });

  it('removes workspace rooms during periodic recheck when hierarchy access is revoked', async () => {
    const gateway = new RealtimeGateway(realtime as never);
    const client = clientMock({ auth: { token: 'token' } });
    client.data = {
      authToken: 'token',
      user: { id: 'user-1', email: 'user@example.com' },
      workspaceId: '00000000-0000-4000-8000-000000000001',
      membershipId: 'member-1',
      rooms: [
        'workspace:00000000-0000-4000-8000-000000000001',
        'member:00000000-0000-4000-8000-000000000001:member-1',
      ],
    } satisfies RealtimeSocketData;
    realtime.authenticateToken.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    realtime.resolveWorkspaceMembership.mockResolvedValue(null);

    await (
      gateway as unknown as { refreshSocketAuth(client: unknown): Promise<unknown> }
    ).refreshSocketAuth(client);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.leave).toHaveBeenCalledWith('workspace:00000000-0000-4000-8000-000000000001');
    expect(client.leave).toHaveBeenCalledWith(
      'member:00000000-0000-4000-8000-000000000001:member-1',
    );
    const data = client.data as RealtimeSocketData;
    expect(data.workspaceId).toBeUndefined();
    expect(data.membershipId).toBeUndefined();
    expect(data.rooms).toEqual([]);
  });

  it('repairs stale member rooms during periodic recheck using server-generated room names', async () => {
    const gateway = new RealtimeGateway(realtime as never);
    const client = clientMock({ auth: { token: 'token' } });
    client.data = {
      authToken: 'token',
      user: { id: 'user-1', email: 'user@example.com' },
      workspaceId: '00000000-0000-4000-8000-000000000001',
      membershipId: 'old-member',
      rooms: ['workspace:00000000-0000-4000-8000-000000000001', 'member:stale'],
    } satisfies RealtimeSocketData;
    realtime.authenticateToken.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    realtime.resolveWorkspaceMembership.mockResolvedValue({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      membershipId: 'member-1',
    });

    await (
      gateway as unknown as { refreshSocketAuth(client: unknown): Promise<unknown> }
    ).refreshSocketAuth(client);

    expect(client.leave).toHaveBeenCalledWith('member:stale');
    expect(client.join).toHaveBeenCalledWith('workspace:00000000-0000-4000-8000-000000000001');
    expect(client.join).toHaveBeenCalledWith(
      'member:00000000-0000-4000-8000-000000000001:member-1',
    );
    expect((client.data as RealtimeSocketData).membershipId).toBe('member-1');
  });

  it('accepts only subscribe and unsubscribe control events', () => {
    expect(REALTIME_SUBSCRIBE_WORKSPACE).toBe('realtime:subscribe-workspace');
    expect(REALTIME_UNSUBSCRIBE_WORKSPACE).toBe('realtime:unsubscribe-workspace');
  });

  it('keeps one auth recheck timer per socket and clears it on disconnect', async () => {
    jest.useFakeTimers();
    const gateway = new RealtimeGateway(realtime as never);
    const client = clientMock({ auth: { token: 'auth-token' } });
    client.id = '00000000-0000-4000-8000-000000000001';
    realtime.authenticateToken.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });

    await gateway.handleConnection(client as never);
    await gateway.handleConnection(client as never);

    expect((gateway as unknown as { authTimers: Map<string, unknown> }).authTimers.size).toBe(1);

    gateway.handleDisconnect(client as never);

    expect((gateway as unknown as { authTimers: Map<string, unknown> }).authTimers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

function clientMock(handshake: { auth: Record<string, unknown>; query?: Record<string, unknown> }) {
  return {
    id: crypto.randomUUID(),
    handshake,
    data: {},
    join: jest.fn(),
    leave: jest.fn(),
    disconnect: jest.fn(),
  };
}
