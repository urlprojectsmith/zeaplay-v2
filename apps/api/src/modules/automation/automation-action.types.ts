import type { AutomationActionType, AutomationDomainEventEntityType } from '@prisma/client';

export interface AutomationMutationContext {
  workflowId?: string;
  workflowVersionId?: string;
  actionNodeId?: string;
  triggerDomainEventId?: string;
  triggerMatchId?: string;
  correlationId?: string;
  causationId?: string;
  parentAutomationDepth?: number;
  invocationKey?: string;
}

export interface AutomationActionExecutionContext {
  workspaceId: string;
  actionNodeId: string;
  mutation: AutomationMutationContext;
}

export type AutomationActionStatus = 'SUCCEEDED' | 'NO_OP';

export interface AutomationActionResult {
  actionType: AutomationActionType;
  status: AutomationActionStatus;
  entityType: AutomationDomainEventEntityType;
  entityId: string;
  changed: boolean;
  generatedDomainEventIds: string[];
}
