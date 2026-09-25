import { describe, expect, it } from 'vitest';
import { isWorkspaceRealtimePath } from '../contexts/realtime-provider';

describe('phase 14.6.9 notification realtime shell isolation', () => {
  it('enables realtime workspace room subscriptions only on Workspace routes', () => {
    expect(isWorkspaceRealtimePath('/workspace')).toBe(true);
    expect(isWorkspaceRealtimePath('/workspace/calendar')).toBe(true);
    expect(isWorkspaceRealtimePath('/workspace/tasks/123')).toBe(true);

    expect(isWorkspaceRealtimePath('/agency')).toBe(false);
    expect(isWorkspaceRealtimePath('/agency/settings')).toBe(false);
    expect(isWorkspaceRealtimePath('/super-agency')).toBe(false);
    expect(isWorkspaceRealtimePath('/super-agency/agencies/agency-1')).toBe(false);
    expect(isWorkspaceRealtimePath('/workspaces')).toBe(false);
  });
});
