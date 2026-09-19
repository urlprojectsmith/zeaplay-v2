export type AppEnvironment = 'development' | 'test' | 'staging' | 'production';

export type Uuid = string;

export interface RequestContext {
  requestId: string;
  correlationId: string;
  actorId?: string | null;
  agencyId?: string | null;
  workspaceId?: string | null;
}

export interface StandardErrorBody {
  code: string;
  message: string;
  requestId: string;
  validation?: unknown;
  details?: unknown;
}

export interface StandardResponse<T> {
  data: T;
  requestId: string;
}
