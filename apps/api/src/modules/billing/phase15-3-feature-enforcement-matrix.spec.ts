import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { AssetsController } from '../assets/assets.controller';
import { WorkspaceFilesController } from '../assets/workspace-files.controller';
import { AutomationTemplateController } from '../automation/automation-template.controller';
import { AutomationController } from '../automation/automation.controller';
import { CalendarController } from '../calendar/calendar.controller';
import {
  CloudDriveOAuthController,
  CloudDrivesController,
} from '../cloud-drives/cloud-drives.controller';
import { GamificationController } from '../gamification/gamification.controller';
import { IntegrationsController } from '../integrations/integrations.controller';
import { ApiKeysController } from '../public-api/api-keys.controller';
import { PublicProjectsController } from '../public-api/public-projects.controller';
import { PublicTasksController } from '../public-api/public-tasks.controller';
import { PublicTicketsController } from '../public-api/public-tickets.controller';
import { LegacyProjectsController, ProjectsController } from '../projects/projects.controller';
import { MeTimeTrackingController } from '../tasks/me-time-tracking.controller';
import { TasksController } from '../tasks/tasks.controller';
import { TicketsController } from '../tickets/tickets.controller';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { PLAN_FEATURE_KEYS } from './billing.constants';
import {
  PHASE15_3_FEATURE_ENFORCEMENT_MATRIX,
  PHASE15_3_MATRIX_ROUTE_KEYS,
  matrixKey,
} from './phase15-3-feature-enforcement.matrix';

type ControllerClass = {
  name: string;
  prototype: object;
};

const CONTROLLED_CONTROLLERS: ControllerClass[] = [
  TasksController,
  MeTimeTrackingController,
  ProjectsController,
  LegacyProjectsController,
  TicketsController,
  CalendarController,
  AssetsController,
  WorkspaceFilesController,
  AutomationController,
  AutomationTemplateController,
  PublicTasksController,
  PublicProjectsController,
  PublicTicketsController,
  ApiKeysController,
  WebhooksController,
  IntegrationsController,
  CloudDrivesController,
  CloudDriveOAuthController,
  GamificationController,
];

function mutationRouteKeysFor(controller: ControllerClass) {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((methodName) => methodName !== 'constructor')
    .flatMap((methodName) => {
      const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, methodName);
      if (typeof descriptor?.value !== 'function') return [];

      const requestMethod = Reflect.getMetadata(METHOD_METADATA, descriptor.value) as
        RequestMethod | undefined;
      if (requestMethod === undefined || requestMethod === RequestMethod.GET) return [];

      return [matrixKey(controller.name, methodName)];
    });
}

describe('Phase 15.3 feature enforcement matrix', () => {
  it('classifies every controlled non-GET backend route', () => {
    const actualMutationKeys = CONTROLLED_CONTROLLERS.flatMap(mutationRouteKeysFor).sort();
    const matrixRouteKeys = [...PHASE15_3_MATRIX_ROUTE_KEYS].sort();

    expect(matrixRouteKeys.filter((key) => !actualMutationKeys.includes(key))).toEqual([]);
    expect(actualMutationKeys.filter((key) => !PHASE15_3_MATRIX_ROUTE_KEYS.has(key))).toEqual([]);
  });

  it('keeps matrix rows finalized and traceable to known entitlement keys', () => {
    const featureKeys = new Set<string>(PLAN_FEATURE_KEYS);
    const routeKeys = PHASE15_3_FEATURE_ENFORCEMENT_MATRIX.flatMap((row) =>
      row.controller && row.method ? [matrixKey(row.controller, row.method)] : [],
    );

    expect(new Set(routeKeys).size).toBe(routeKeys.length);
    expect(PHASE15_3_FEATURE_ENFORCEMENT_MATRIX).not.toHaveLength(0);

    for (const row of PHASE15_3_FEATURE_ENFORCEMENT_MATRIX) {
      expect(['ENFORCED', 'EXEMPT-BY-DESIGN', 'NOT-COMMERCIALLY-GATED']).toContain(row.status);
      expect(row.domain).toBeTruthy();
      expect(row.entryPoint).toBeTruthy();
      expect(row.operation).toBeTruthy();
      expect(row.entitlementCheckLocation).toBeTruthy();
      expect(row.testReference).toBeTruthy();
      if (row.featureKey) expect(featureKeys.has(row.featureKey)).toBe(true);
      if (row.status === 'ENFORCED') expect(row.readAllowedWhenDisabled).toBe(true);
    }
  });

  it('documents provider-specific integration gates and the Generic REST exception', () => {
    const integrationRoutes = PHASE15_3_FEATURE_ENFORCEMENT_MATRIX.filter(
      (row) => row.controller === 'IntegrationsController',
    );
    const enforcedIntegrationRoutes = integrationRoutes.filter((row) => row.status === 'ENFORCED');

    expect(enforcedIntegrationRoutes.map((row) => row.method).sort()).toEqual([
      'create',
      'execute',
      'test',
      'update',
    ]);

    for (const row of enforcedIntegrationRoutes) {
      expect(row.featureKey).toBeNull();
      expect(row.entitlementCheckLocation).toEqual(
        expect.stringContaining('integrations.ghl.enabled'),
      );
      expect(row.entitlementCheckLocation).toEqual(
        expect.stringContaining('integrations.slack.enabled'),
      );
      expect(row.entitlementCheckLocation).toEqual(
        expect.stringContaining('integrations.webex.enabled'),
      );
    }

    expect(
      PHASE15_3_FEATURE_ENFORCEMENT_MATRIX.find(
        (row) => row.entryPoint === 'IntegrationsService GENERIC_REST provider action',
      ),
    ).toMatchObject({
      domain: 'GENERIC REST',
      featureKey: null,
      status: 'NOT-COMMERCIALLY-GATED',
    });
  });

  it('preserves disabled-feature read/reduction semantics in the audited domains', () => {
    const reductionRows = PHASE15_3_FEATURE_ENFORCEMENT_MATRIX.filter(
      (row) => row.classification === 'REDUCTION',
    );

    expect(PHASE15_3_FEATURE_ENFORCEMENT_MATRIX.every((row) => row.readAllowedWhenDisabled)).toBe(
      true,
    );
    expect(reductionRows.every((row) => row.reductionAllowed)).toBe(true);
  });
});
