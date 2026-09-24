import { describe, expect, it } from 'vitest';
import { notificationsKeys } from '../services/workspace-notifications';

describe('Phase 12.1 notifications frontend keys', () => {
  it('scopes notification query keys by workspace and membership', () => {
    expect(notificationsKeys.unreadCount('workspace-1', 'membership-1')).toEqual([
      'workspace',
      'workspace-1',
      'membership',
      'membership-1',
      'notifications',
      'unread-count',
    ]);
    expect(notificationsKeys.list('workspace-1', 'membership-2', 'unread', 'TASK')).toEqual([
      'workspace',
      'workspace-1',
      'membership',
      'membership-2',
      'notifications',
      'list',
      'unread',
      'TASK',
    ]);
  });
});
