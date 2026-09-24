import { UserStatus, WorkspaceStatus, MembershipStatus } from '@prisma/client';
import { RealtimeService } from './realtime.service';
import { REALTIME_CLIENT_EVENT } from './realtime.types';

describe('RealtimeService', () => {
  const tokens = { verifyAccessToken: jest.fn() };
  const prisma = {
    user: { findUnique: jest.fn() },
    workspaceMembership: { findUnique: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects missing, invalid, inactive, or mismatched socket tokens without logging token data', async () => {
    const service = new RealtimeService(prisma as never, tokens as never);
    await expect(service.authenticateToken(undefined)).resolves.toBeNull();

    tokens.verifyAccessToken.mockImplementationOnce(() => {
      throw new Error('invalid');
    });
    await expect(service.authenticateToken('bad-token')).resolves.toBeNull();

    tokens.verifyAccessToken.mockReturnValue({ id: 'user-1', email: 'user@example.com' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'other@example.com',
      status: UserStatus.ACTIVE,
    });
    await expect(service.authenticateToken('token')).resolves.toBeNull();

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      status: UserStatus.SUSPENDED,
    });
    await expect(service.authenticateToken('token')).resolves.toBeNull();
  });

  it('authenticates valid users and authorizes only active workspace memberships', async () => {
    const service = new RealtimeService(prisma as never, tokens as never);
    tokens.verifyAccessToken.mockReturnValue({ id: 'user-1', email: 'user@example.com' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      status: UserStatus.ACTIVE,
    });
    await expect(service.authenticateToken('token')).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.com',
    });

    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: 'member-1',
      status: MembershipStatus.ACTIVE,
      workspace: { id: '00000000-0000-4000-8000-000000000001', status: WorkspaceStatus.ACTIVE },
    });
    await expect(
      service.resolveWorkspaceMembership('user-1', '00000000-0000-4000-8000-000000000001'),
    ).resolves.toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      membershipId: 'member-1',
    });

    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: 'member-2',
      status: MembershipStatus.SUSPENDED,
      workspace: { id: '00000000-0000-4000-8000-000000000002', status: WorkspaceStatus.ACTIVE },
    });
    await expect(
      service.resolveWorkspaceMembership('user-1', '00000000-0000-4000-8000-000000000002'),
    ).resolves.toBeNull();
  });

  it('uses fixed workspace/member room names and rejects secret-shaped payloads', () => {
    const service = new RealtimeService(prisma as never, tokens as never);
    expect(service.workspaceRoom('workspace-1')).toBe('workspace:workspace-1');
    expect(service.memberRoom('workspace-1', 'member-1')).toBe('member:workspace-1:member-1');
    expect(() =>
      service.buildEvent({
        eventType: 'TASK_UPDATED',
        workspaceId: 'workspace-1',
        payload: { authorization: 'Bearer hidden' },
      }),
    ).toThrow('REALTIME_PAYLOAD_SENSITIVE');
  });

  it('publishes to targeted rooms and swallows transport failures after commits', async () => {
    const service = new RealtimeService(prisma as never, tokens as never);
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    service.attachServer({ to } as never);

    await service.publishWorkspace({
      eventType: 'TASK_UPDATED',
      workspaceId: 'workspace-1',
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { taskId: 'task-1' },
    });
    expect(to).toHaveBeenCalledWith('workspace:workspace-1');
    expect(emit).toHaveBeenCalledWith(
      REALTIME_CLIENT_EVENT,
      expect.objectContaining({ eventType: 'TASK_UPDATED', entityId: 'task-1' }),
    );

    to.mockImplementationOnce(() => {
      throw new Error('adapter down');
    });
    expect(() =>
      service.publishMember('workspace-1', 'member-1', {
        eventType: 'NOTIFICATION_CREATED',
        entityType: 'NOTIFICATION',
        entityId: 'notification-1',
        payload: { notificationId: 'notification-1' },
      }),
    ).not.toThrow();
  });

  it('tracks Redis fanout health without making it business authority', () => {
    const service = new RealtimeService(prisma as never, tokens as never);
    expect(service.isRedisFanoutHealthy()).toBe(false);
    service.setRedisFanoutHealthy(true);
    expect(service.isRedisFanoutHealthy()).toBe(true);
    service.setRedisFanoutHealthy(false);
    expect(service.isRedisFanoutHealthy()).toBe(false);
  });
});
