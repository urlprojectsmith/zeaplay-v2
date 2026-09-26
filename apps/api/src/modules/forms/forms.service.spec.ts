import {
  FormStatus,
  FormSubmissionAssetKind,
  FormSubmissionAutomationStatus,
  FormSubmissionSource,
  FormType,
  FormVersionState,
  FormVisibility,
} from '@prisma/client';
import { UnprocessableEntityException } from '@nestjs/common';
import { FormsService } from './forms.service';

describe('FormsService Phase 16.4 integration hardening', () => {
  it('returns duplicate idempotent submissions without recording Automation again', async () => {
    const { service, prisma, automationEvents } = buildService();
    prisma.formSubmission.findFirst.mockResolvedValue({
      id: 'submission-1',
      status: 'ACCEPTED',
      automationStatus: FormSubmissionAutomationStatus.QUEUED,
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.submitInternal(tenant(), 'form-1', {
      idempotencyKey: 'submit-once',
      answers: { name: 'Ada' },
    });

    expect(result).toMatchObject({ id: 'submission-1', duplicate: true });
    expect(prisma.formSubmission.create).not.toHaveBeenCalled();
    expect(automationEvents.recordDomainEvent).not.toHaveBeenCalled();
  });

  it('rejects Doc-attached Assets in internal Form file answers', async () => {
    const { service, prisma } = buildService();
    prisma.formSubmission.findFirst.mockResolvedValue(null);
    prisma.asset.findMany.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000002',
        sourceModule: 'GENERAL',
        sourceEntityId: null,
        uploadExpiresAt: new Date(Date.now() + 60_000),
        metadata: {},
        _count: { docAttachments: 1 },
      },
    ]);

    await expect(
      service.submitInternal(tenant(), 'form-1', {
        idempotencyKey: 'asset-submit',
        answers: { name: 'Ada', file: '00000000-0000-4000-8000-000000000002' },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.formSubmission.create).not.toHaveBeenCalled();
  });
});

function buildService() {
  const tx = mockDb();
  const prisma = mockDb();
  prisma.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') return arg(tx);
    return Promise.all(arg as Promise<unknown>[]);
  });
  prisma.form.findFirst.mockResolvedValue(formRecord());
  const automationEvents = {
    recordDomainEvent: jest.fn().mockResolvedValue({ id: 'event-1' }),
  };
  return {
    service: new FormsService(
      prisma as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      automationEvents as never,
      {} as never,
      {} as never,
    ),
    prisma,
    tx,
    automationEvents,
  };
}

function mockDb() {
  return {
    $transaction: jest.fn(),
    form: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    formVersion: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    formSubmission: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      create: jest.fn().mockResolvedValue({
        id: 'submission-1',
        status: 'ACCEPTED',
        automationStatus: FormSubmissionAutomationStatus.PENDING,
        submittedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    asset: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    superAgencySubscription: {
      findFirst: jest.fn(),
    },
  };
}

function tenant() {
  return {
    userId: 'user-1',
    agencyId: 'agency-1',
    workspaceId: 'workspace-1',
    workspaceMembershipId: 'membership-1',
    agencyMembershipId: null,
    roleId: 'role-1',
    roleName: 'Owner',
    permissions: ['forms.submit'],
    accessSource: 'WORKSPACE_MEMBERSHIP' as const,
  };
}

function formRecord() {
  return {
    id: 'form-1',
    workspaceId: 'workspace-1',
    publicId: 'frm_public',
    title: 'Intake',
    description: null,
    status: FormStatus.PUBLISHED,
    type: FormType.FORM,
    visibility: FormVisibility.INTERNAL,
    publicEnabled: false,
    publishedVersionNumber: 1,
    createdByMembershipId: 'membership-1',
    updatedByMembershipId: 'membership-1',
    archivedByMembershipId: null,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdByMembership: { id: 'membership-1', user: { id: 'user-1' } },
    workspace: { agency: { superAgencyId: 'super-agency-1' } },
    versions: [
      {
        id: 'version-1',
        workspaceId: 'workspace-1',
        formId: 'form-1',
        versionNumber: 1,
        state: FormVersionState.PUBLISHED,
        titleSnapshot: 'Intake',
        descriptionSnapshot: null,
        schema: {
          fields: [
            { id: 'name', type: 'TEXT', label: 'Name', required: true },
            { id: 'file', type: 'FILE_UPLOAD', label: 'File', required: true },
          ],
        },
        settings: {},
        createdByMembershipId: 'membership-1',
        publishedByMembershipId: 'membership-1',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        archivedAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    _count: { submissions: 0 },
    source: FormSubmissionSource.INTERNAL,
    kind: FormSubmissionAssetKind.FILE,
  };
}
