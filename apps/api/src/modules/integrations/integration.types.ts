import type {
  IntegrationAuthType,
  IntegrationConnection,
  IntegrationProvider,
} from '@prisma/client';

export interface IntegrationCredentialPayload {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  token?: string;
  apiKey?: string;
  apiKeyHeaderName?: string;
  username?: string;
  password?: string;
  scopes?: string[];
}

export interface IntegrationProviderInfo {
  provider: IntegrationProvider;
  label: string;
  configured: boolean;
  authTypes: IntegrationAuthType[];
  capabilities: string[];
  supportsOAuth: boolean;
}

export interface IntegrationActionContext {
  connection: IntegrationConnection;
  credentials: IntegrationCredentialPayload;
  capability: string;
  input: Record<string, unknown>;
}

export interface IntegrationActionResult {
  providerRequestId?: string | null;
  resourceId?: string | null;
  summary: Record<string, unknown>;
  data?: unknown;
}

export interface IntegrationProviderAdapter {
  readonly provider: IntegrationProvider;
  readonly label: string;
  readonly authTypes: IntegrationAuthType[];
  readonly capabilities: string[];
  readonly supportsOAuth: boolean;
  isConfigured(): boolean;
  validateConfiguration(configuration: Record<string, unknown>): Promise<Record<string, unknown>>;
  execute(context: IntegrationActionContext): Promise<IntegrationActionResult>;
  testConnection(
    context: Omit<IntegrationActionContext, 'capability' | 'input'>,
  ): Promise<IntegrationActionResult>;
  refreshCredentials?(
    credentials: IntegrationCredentialPayload,
  ): Promise<IntegrationCredentialPayload>;
}
