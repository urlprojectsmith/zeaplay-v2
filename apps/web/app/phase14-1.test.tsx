import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSettingsPage } from '../components/workspace/WorkspaceSettingsPage';
import { LanguageProvider } from '../contexts/language-provider';
import { useSessionStore } from '../stores/session';

const getWorkspaceSettings = vi.fn();
const updateWorkspaceSettings = vi.fn();
const listWorkspaceRoles = vi.fn();
const getCloudProviders = vi.fn();
const getCloudConnections = vi.fn();
const getWorkspaceNotificationPreferences = vi.fn();
const updateWorkspaceNotificationPreferences = vi.fn();
const listWorkspaceApiKeys = vi.fn();
const createWorkspaceApiKey = vi.fn();
const revokeWorkspaceApiKey = vi.fn();
const listWorkspaceWebhooks = vi.fn();
const createWorkspaceWebhook = vi.fn();
const disableWorkspaceWebhook = vi.fn();
const rotateWorkspaceWebhookSecret = vi.fn();
const sendWorkspaceWebhookTest = vi.fn();
const listWorkspaceWebhookDeliveries = vi.fn();
const retryWorkspaceWebhookDelivery = vi.fn();
const listWorkspaceInboundWebhooks = vi.fn();
const createWorkspaceInboundWebhook = vi.fn();
const rotateWorkspaceInboundWebhookSecret = vi.fn();
const disableWorkspaceInboundWebhook = vi.fn();
const listWorkspaceInboundWebhookEvents = vi.fn();
const clipboardWriteText = vi.fn();

vi.mock('../services/workspace-management', () => ({
  getWorkspaceSettings: (...args: unknown[]) => getWorkspaceSettings(...args),
  updateWorkspaceSettings: (...args: unknown[]) => updateWorkspaceSettings(...args),
}));

vi.mock('../services/workspace-roles', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-roles')>(
    '../services/workspace-roles',
  );
  return {
    ...actual,
    listWorkspaceRoles: (...args: unknown[]) => listWorkspaceRoles(...args),
  };
});

vi.mock('../services/workspace-cloud-drives', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-cloud-drives')>(
    '../services/workspace-cloud-drives',
  );
  return {
    ...actual,
    getCloudProviders: (...args: unknown[]) => getCloudProviders(...args),
    getCloudConnections: (...args: unknown[]) => getCloudConnections(...args),
  };
});

vi.mock('../services/workspace-notifications', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-notifications')>(
    '../services/workspace-notifications',
  );
  return {
    ...actual,
    getWorkspaceNotificationPreferences: (...args: unknown[]) =>
      getWorkspaceNotificationPreferences(...args),
    updateWorkspaceNotificationPreferences: (...args: unknown[]) =>
      updateWorkspaceNotificationPreferences(...args),
  };
});

vi.mock('../services/workspace-api-keys', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-api-keys')>(
    '../services/workspace-api-keys',
  );
  return {
    ...actual,
    listWorkspaceApiKeys: (...args: unknown[]) => listWorkspaceApiKeys(...args),
    createWorkspaceApiKey: (...args: unknown[]) => createWorkspaceApiKey(...args),
    revokeWorkspaceApiKey: (...args: unknown[]) => revokeWorkspaceApiKey(...args),
  };
});

vi.mock('../services/workspace-webhooks', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-webhooks')>(
    '../services/workspace-webhooks',
  );
  return {
    ...actual,
    listWorkspaceWebhooks: (...args: unknown[]) => listWorkspaceWebhooks(...args),
    createWorkspaceWebhook: (...args: unknown[]) => createWorkspaceWebhook(...args),
    disableWorkspaceWebhook: (...args: unknown[]) => disableWorkspaceWebhook(...args),
    rotateWorkspaceWebhookSecret: (...args: unknown[]) => rotateWorkspaceWebhookSecret(...args),
    sendWorkspaceWebhookTest: (...args: unknown[]) => sendWorkspaceWebhookTest(...args),
    listWorkspaceWebhookDeliveries: (...args: unknown[]) => listWorkspaceWebhookDeliveries(...args),
    retryWorkspaceWebhookDelivery: (...args: unknown[]) => retryWorkspaceWebhookDelivery(...args),
  };
});

vi.mock('../services/workspace-inbound-webhooks', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-inbound-webhooks')>(
    '../services/workspace-inbound-webhooks',
  );
  return {
    ...actual,
    listWorkspaceInboundWebhooks: (...args: unknown[]) => listWorkspaceInboundWebhooks(...args),
    createWorkspaceInboundWebhook: (...args: unknown[]) => createWorkspaceInboundWebhook(...args),
    rotateWorkspaceInboundWebhookSecret: (...args: unknown[]) =>
      rotateWorkspaceInboundWebhookSecret(...args),
    disableWorkspaceInboundWebhook: (...args: unknown[]) => disableWorkspaceInboundWebhook(...args),
    listWorkspaceInboundWebhookEvents: (...args: unknown[]) =>
      listWorkspaceInboundWebhookEvents(...args),
  };
});

Object.assign(navigator, {
  clipboard: {
    writeText: clipboardWriteText,
  },
});

describe('Phase 14.1 API key settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'user-1', email: 'user@zeaplay.test' },
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'agency-member-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace',
              slug: 'workspace',
              timezone: 'UTC',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'member-1',
            },
          ],
        },
      ],
    });
    getWorkspaceSettings.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      timezone: 'UTC',
    });
    getCloudProviders.mockResolvedValue([]);
    getCloudConnections.mockResolvedValue([]);
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-owner',
        key: 'OWNER',
        name: 'Owner',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: null,
        permissions: [
          { id: 'permission-api-keys-view', key: 'api_keys.view' },
          { id: 'permission-api-keys-create', key: 'api_keys.create' },
          { id: 'permission-api-keys-manage', key: 'api_keys.manage' },
          { id: 'permission-webhooks-view', key: 'webhooks.view' },
          { id: 'permission-webhooks-create', key: 'webhooks.create' },
          { id: 'permission-webhooks-manage', key: 'webhooks.manage' },
          { id: 'permission-webhooks-retry', key: 'webhooks.retry' },
          { id: 'permission-inbound-webhooks-view', key: 'inbound_webhooks.view' },
          { id: 'permission-inbound-webhooks-create', key: 'inbound_webhooks.create' },
          { id: 'permission-inbound-webhooks-manage', key: 'inbound_webhooks.manage' },
        ],
        createdAt: '2026-09-24T00:00:00.000Z',
        updatedAt: '2026-09-24T00:00:00.000Z',
      },
    ]);
    getWorkspaceNotificationPreferences.mockResolvedValue([]);
    updateWorkspaceSettings.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace',
      timezone: 'UTC',
    });
    updateWorkspaceNotificationPreferences.mockResolvedValue([]);
    listWorkspaceApiKeys.mockResolvedValue({
      items: [
        {
          id: 'api-key-1',
          name: 'Existing key',
          maskedKey: 'zea_live_existing_...',
          status: 'ACTIVE',
          scopes: ['tasks.read'],
          lastUsedAt: null,
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    createWorkspaceApiKey.mockResolvedValue({
      id: 'api-key-2',
      name: 'Build bot',
      maskedKey: 'zea_live_new_...',
      status: 'ACTIVE',
      scopes: ['tasks.read', 'projects.write'],
      lastUsedAt: null,
      plaintextApiKey: 'zea_live_new_secret',
    });
    revokeWorkspaceApiKey.mockResolvedValue({ id: 'api-key-1', status: 'REVOKED' });
    listWorkspaceWebhooks.mockResolvedValue({
      items: [
        {
          id: 'webhook-1',
          name: 'Deploy hook',
          endpointUrl: 'https://hooks.example.com/zea',
          status: 'ACTIVE',
          eventTypes: ['task.created'],
          lastSuccessAt: null,
          lastFailureAt: null,
          createdAt: '2026-09-24T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    createWorkspaceWebhook.mockResolvedValue({
      id: 'webhook-2',
      name: 'Audit hook',
      endpointUrl: 'https://hooks.example.com/audit',
      status: 'ACTIVE',
      eventTypes: ['task.created'],
      lastSuccessAt: null,
      lastFailureAt: null,
      createdAt: '2026-09-24T00:00:00.000Z',
      plaintextSecret: 'whsec_visible_once',
    });
    disableWorkspaceWebhook.mockResolvedValue({ id: 'webhook-1', status: 'DISABLED' });
    rotateWorkspaceWebhookSecret.mockResolvedValue({
      id: 'webhook-1',
      plaintextSecret: 'whsec_rotated_once',
    });
    sendWorkspaceWebhookTest.mockResolvedValue({ deliveryId: 'delivery-1' });
    listWorkspaceWebhookDeliveries.mockResolvedValue({
      items: [
        {
          id: 'delivery-1',
          eventId: 'event-1',
          subscriptionId: 'webhook-1',
          status: 'FAILED',
          attemptCount: 1,
          nextAttemptAt: null,
          lastAttemptAt: '2026-09-24T00:00:00.000Z',
          deliveredAt: null,
          httpStatus: 500,
          safeErrorCode: 'HTTP_RETRYABLE_STATUS',
          responseDurationMs: 120,
          responseSnippet: null,
          createdAt: '2026-09-24T00:00:00.000Z',
          event: {
            id: 'event-1',
            eventType: 'task.created',
            eventVersion: 1,
            createdAt: '2026-09-24T00:00:00.000Z',
          },
        },
      ],
      total: 1,
    });
    retryWorkspaceWebhookDelivery.mockResolvedValue({ id: 'delivery-1', status: 'PENDING' });
    listWorkspaceInboundWebhooks.mockResolvedValue({
      items: [
        {
          id: 'inbound-1',
          workspaceId: 'workspace-1',
          name: 'CRM inbound',
          publicIdentifier: 'iw_existing',
          endpointUrl: 'http://localhost:4000/api/v1/inbound/iw_existing',
          type: 'GENERIC_HMAC_V1',
          status: 'ACTIVE',
          lastReceivedAt: null,
          lastVerifiedAt: null,
          lastFailureAt: null,
          createdAt: '2026-09-24T00:00:00.000Z',
          updatedAt: '2026-09-24T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    createWorkspaceInboundWebhook.mockResolvedValue({
      id: 'inbound-2',
      workspaceId: 'workspace-1',
      name: 'Orders inbound',
      publicIdentifier: 'iw_new',
      endpointUrl: 'http://localhost:4000/api/v1/inbound/iw_new',
      type: 'GENERIC_HMAC_V1',
      status: 'ACTIVE',
      lastReceivedAt: null,
      lastVerifiedAt: null,
      lastFailureAt: null,
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
      plaintextSecret: 'ziwhsec_visible_once',
    });
    rotateWorkspaceInboundWebhookSecret.mockResolvedValue({
      id: 'inbound-1',
      endpointUrl: 'http://localhost:4000/api/v1/inbound/iw_existing',
      plaintextSecret: 'ziwhsec_rotated_once',
    });
    disableWorkspaceInboundWebhook.mockResolvedValue({ id: 'inbound-1', status: 'DISABLED' });
    listWorkspaceInboundWebhookEvents.mockResolvedValue({
      items: [
        {
          id: 'inbound-event-1',
          workspaceId: 'workspace-1',
          sourceId: 'inbound-1',
          externalEventId: 'crm-event-1',
          eventType: 'crm.contact.created',
          eventVersion: '1',
          status: 'NORMALIZED',
          normalizedType: 'crm.contact.created',
          receivedAt: '2026-09-24T00:00:00.000Z',
          verifiedAt: '2026-09-24T00:00:00.000Z',
          normalizedAt: '2026-09-24T00:00:00.000Z',
          safeErrorCode: null,
          correlationId: null,
          createdAt: '2026-09-24T00:00:00.000Z',
        },
      ],
      total: 1,
    });
  });

  it('creates an API key, shows the plaintext once, copies explicitly, and can revoke', async () => {
    renderSettings();

    expect(await screen.findByRole('heading', { name: 'API Keys' })).toBeInTheDocument();
    expect(await screen.findByText('Existing key')).toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText('Name', { selector: 'input' })[0]!, {
      target: { value: 'Build bot' },
    });
    fireEvent.click(screen.getByLabelText('Write projects'));
    fireEvent.click(screen.getByRole('button', { name: 'Create API Key' }));

    await screen.findByText('This key will only be shown once.');
    expect(screen.getByText('zea_live_new_secret')).toBeInTheDocument();
    expect(createWorkspaceApiKey).toHaveBeenCalledWith('workspace-1', {
      name: 'Build bot',
      scopes: ['projects.write', 'tasks.read'],
      expiresAt: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy Key' }));
    expect(clipboardWriteText).toHaveBeenCalledWith('zea_live_new_secret');
    fireEvent.click(screen.getByRole('button', { name: 'I have saved this key' }));
    await waitFor(() => expect(screen.queryByText('zea_live_new_secret')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(revokeWorkspaceApiKey).toHaveBeenCalledWith('workspace-1', 'api-key-1'),
    );
  });

  it('creates a webhook, shows the signing secret once, and opens delivery history', async () => {
    renderSettings();

    expect(await screen.findByRole('heading', { name: 'Webhooks' })).toBeInTheDocument();
    expect(await screen.findByText('Deploy hook')).toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText('Name', { selector: 'input' })[1]!, {
      target: { value: 'Audit hook' },
    });
    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://hooks.example.com/audit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Webhook' }));

    await screen.findByText('This signing secret will only be shown once.');
    expect(screen.getByText('whsec_visible_once')).toBeInTheDocument();
    expect(createWorkspaceWebhook).toHaveBeenCalledWith('workspace-1', {
      name: 'Audit hook',
      endpointUrl: 'https://hooks.example.com/audit',
      eventTypes: ['task.created'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'View Deliveries' }));
    expect(await screen.findByText('HTTP_RETRYABLE_STATUS')).toBeInTheDocument();
  });

  it('creates an inbound webhook, clears the one-time secret, and opens event history', async () => {
    renderSettings();

    expect(await screen.findByRole('heading', { name: 'Inbound Webhooks' })).toBeInTheDocument();
    expect(await screen.findByText('CRM inbound')).toBeInTheDocument();
    expect(screen.getByText('Header: X-ZeaPlay-Inbound-Signature')).toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText('Name', { selector: 'input' })[2]!, {
      target: { value: 'Orders inbound' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Inbound Webhook' }));

    await screen.findByText('This secret will only be shown once.');
    expect(screen.getByText('ziwhsec_visible_once')).toBeInTheDocument();
    expect(createWorkspaceInboundWebhook).toHaveBeenCalledWith('workspace-1', {
      name: 'Orders inbound',
      type: 'GENERIC_HMAC_V1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy Endpoint' }));
    expect(clipboardWriteText).toHaveBeenCalledWith('http://localhost:4000/api/v1/inbound/iw_new');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Secret' }));
    expect(clipboardWriteText).toHaveBeenCalledWith('ziwhsec_visible_once');
    fireEvent.click(screen.getByRole('button', { name: 'I have saved this secret' }));
    await waitFor(() => expect(screen.queryByText('ziwhsec_visible_once')).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'Event History' })[0]!);
    expect(await screen.findByText('crm.contact.created')).toBeInTheDocument();
    expect(screen.getByText(/crm-event-1/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Rotate Secret' })[1]!);
    await screen.findByText('ziwhsec_rotated_once');
    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' })[1]!);
    await waitFor(() =>
      expect(disableWorkspaceInboundWebhook).toHaveBeenCalledWith('workspace-1', 'inbound-1'),
    );
  });
});

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <WorkspaceSettingsPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}
