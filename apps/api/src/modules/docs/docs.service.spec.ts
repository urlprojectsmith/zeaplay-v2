import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AssetLifecycle,
  AssetStatus,
  DocAccessRole,
  DocShareStatus,
  DocStatus,
  DocType,
  DocVisibility,
} from '@prisma/client';
import { DocsService } from './docs.service';

const tenant = {
  userId: 'user-1',
  agencyId: 'agency-1',
  workspaceId: 'workspace-a',
  workspaceMembershipId: 'member-a',
  agencyMembershipId: 'agency-member-1',
  roleId: 'role-1',
  roleName: 'Owner',
  permissions: [
    'docs.view',
    'docs.create',
    'docs.edit',
    'docs.manage',
    'docs.share.manage',
    'docs.versions.view',
    'docs.versions.restore',
    'docs.comments.view',
    'docs.comments.create',
  ],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

const docContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'Hello' }] }] };

describe('DocsService Phase 16.1 main gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates Workspace-owned Docs with an initial immutable snapshot and safe AuditLog metadata', async () => {
    const { service, prisma, tx, audit } = buildService();
    prisma.workspaceMembership.count.mockResolvedValue(1);
    tx.doc.create.mockResolvedValue(docRecord({ content: docContent }));
    tx.docVersion.create.mockResolvedValue({});

    const result = await service.createDoc(tenant, {
      title: ' Launch Notes ',
      content: docContent,
      visibility: DocVisibility.WORKSPACE,
      type: DocType.PAGE,
    });

    expect(result).toMatchObject({ title: 'Launch Notes', workspaceId: tenant.workspaceId });
    expect(tx.doc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          createdByMembershipId: tenant.workspaceMembershipId,
        }),
      }),
    );
    expect(tx.docVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'CREATE', workspaceId: tenant.workspaceId }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'doc.create',
        metadata: { visibility: DocVisibility.WORKSPACE, type: DocType.PAGE },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('Hello');
  });

  it('denies foreign Workspace reads and writes without relying on UUID secrecy', async () => {
    const { service, prisma } = buildService();
    prisma.doc.findFirst.mockResolvedValue(null);

    await expect(service.getDoc(tenant, 'foreign-doc')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateDoc(tenant, 'foreign-doc', { expectedRevision: 1, title: 'Nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.doc.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign-doc', workspaceId: tenant.workspaceId } }),
    );
  });

  it('enforces PRIVATE and SELECTED_MEMBERS ACLs using WorkspaceMembership IDs', async () => {
    const { service, prisma } = buildService();
    prisma.doc.findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      visibility: DocVisibility.PRIVATE,
      createdByMembershipId: 'member-owner',
      accessList: [],
    });

    await expect(service.getDoc(tenant, 'doc-1')).rejects.toBeInstanceOf(NotFoundException);

    prisma.doc.findFirst
      .mockResolvedValueOnce(
        authDoc({ accessList: [{ membershipId: 'member-a', role: DocAccessRole.EDITOR }] }),
      )
      .mockResolvedValueOnce(
        authDoc({
          visibility: DocVisibility.SELECTED_MEMBERS,
          accessList: [{ membershipId: 'member-a', role: DocAccessRole.EDITOR }],
        }),
      )
      .mockResolvedValueOnce(docRecord({ visibility: DocVisibility.SELECTED_MEMBERS }));
    prisma.workspaceMembership.count.mockResolvedValue(1);
    await expect(
      service.replaceAccess(tenant, 'doc-1', {
        members: [
          { membershipId: 'member-a', role: DocAccessRole.EDITOR },
          { membershipId: 'member-a', role: DocAccessRole.VIEWER },
        ],
      }),
    ).resolves.toBeDefined();
    expect(prisma.docAccess.createMany.mock.calls[0][0].data).toHaveLength(1);

    prisma.workspaceMembership.count.mockResolvedValue(0);
    await expect(
      service.createDoc(tenant, {
        title: 'Bad ACL',
        content: docContent,
        visibility: DocVisibility.SELECTED_MEMBERS,
        type: DocType.PAGE,
        access: [{ membershipId: 'global-user-id', role: DocAccessRole.VIEWER }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates folders, nested Doc parents, cycles, depth, and ordering inputs by Workspace', async () => {
    const { service, prisma, tx } = buildService();
    prisma.docFolder.findFirst.mockResolvedValue({ id: 'folder-1', parentFolderId: null });
    await expect(
      service.updateFolder(tenant, 'folder-1', { name: 'Cycle', parentFolderId: 'folder-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    tx.doc.findFirst
      .mockResolvedValueOnce(
        authDoc({ accessList: [{ membershipId: 'member-a', role: 'EDITOR' }] }),
      )
      .mockResolvedValueOnce(docRecord({ id: 'doc-1', contentRevision: 1 }))
      .mockResolvedValueOnce(null);
    await expect(
      service.updateDoc(tenant, 'doc-1', {
        expectedRevision: 1,
        parentDocId: 'foreign-parent',
        sortOrder: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts structured editor JSON and rejects unsafe content, unsafe links, unsupported HTML, and oversize payloads', async () => {
    const { service } = buildService();
    await expect(
      service.createDoc(tenant, {
        title: 'Script',
        content: { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'x' } }] },
        visibility: DocVisibility.PRIVATE,
        type: DocType.PAGE,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.createDoc(tenant, {
        title: 'JS link',
        content: { type: 'doc', content: [{ text: 'javascript:alert(1)' }] },
        visibility: DocVisibility.PRIVATE,
        type: DocType.PAGE,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.createDoc(tenant, {
        title: 'Raw HTML',
        content: { type: 'doc', html: '<script>alert(1)</script>' },
        visibility: DocVisibility.PRIVATE,
        type: DocType.PAGE,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.createDoc(tenant, {
        title: 'Large',
        content: { type: 'doc', content: [{ text: 'x'.repeat(800 * 1024) }] },
        visibility: DocVisibility.PRIVATE,
        type: DocType.PAGE,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects stale autosaves without overwriting the newer revision', async () => {
    const { service, tx } = buildService();
    tx.doc.findFirst
      .mockResolvedValueOnce(
        authDoc({ accessList: [{ membershipId: 'member-a', role: 'EDITOR' }] }),
      )
      .mockResolvedValueOnce(docRecord({ contentRevision: 6 }));

    await expect(
      service.updateDoc(tenant, 'doc-1', {
        expectedRevision: 5,
        title: 'Stale update',
        content: docContent,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.doc.update).not.toHaveBeenCalled();
    expect(tx.docVersion.create).not.toHaveBeenCalled();
  });

  it('restores a version as a new current revision without deleting history and audits the action', async () => {
    const { service, tx, audit } = buildService();
    tx.doc.findFirst
      .mockResolvedValueOnce(
        authDoc({ accessList: [{ membershipId: 'member-a', role: 'EDITOR' }] }),
      )
      .mockResolvedValueOnce(docRecord({ contentRevision: 7, title: 'Current' }));
    tx.docVersion.findFirst.mockResolvedValue({
      revision: 3,
      titleSnapshot: 'Old title',
      contentSnapshot: { type: 'doc', content: [{ text: 'Old' }] },
    });
    tx.doc.update.mockResolvedValue(docRecord({ title: 'Old title', contentRevision: 8 }));

    const result = await service.restoreVersion(tenant, 'doc-1', 3);

    expect((result as unknown as { contentRevision: number }).contentRevision).toBe(8);
    expect(tx.docVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'BEFORE_RESTORE' }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'doc.version_restore',
        metadata: { restoredRevision: 3 },
      }),
    );
  });

  it('keeps comments private to authorized Doc access and deduplicates mention notifications', async () => {
    const { service, prisma, tx, notifications } = buildService();
    prisma.doc.findFirst.mockResolvedValue(authDoc({ visibility: DocVisibility.WORKSPACE }));
    prisma.workspaceMembership.count.mockResolvedValue(1);
    tx.docComment.create.mockResolvedValue({ id: 'comment-1' });
    tx.docMention.create.mockResolvedValue({});

    await service.createComment(tenant, 'doc-1', {
      body: 'hello',
      mentionMembershipIds: ['member-b', 'member-b'],
    });

    expect(tx.docMention.create).toHaveBeenCalledTimes(1);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientMembershipId: 'member-b',
        metadata: { docId: 'doc-1', source: 'COMMENT' },
      }),
    );
  });

  it('scopes favorites to WorkspaceMembership and Doc', async () => {
    const { service, prisma } = buildService();
    prisma.doc.findFirst.mockResolvedValue(authDoc({ visibility: DocVisibility.WORKSPACE }));

    await service.setFavorite(tenant, 'doc-1', { favorite: true });

    expect(prisma.docFavorite.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { membershipId_docId: { membershipId: 'member-a', docId: 'doc-1' } },
        create: { workspaceId: 'workspace-a', membershipId: 'member-a', docId: 'doc-1' },
      }),
    );
  });

  it('creates template copies with independent content and denies foreign templates', async () => {
    const { service, prisma, tx } = buildService();
    prisma.doc.findFirst
      .mockResolvedValueOnce(authDoc({ visibility: DocVisibility.WORKSPACE }))
      .mockResolvedValueOnce(docRecord({ id: 'template-1', type: DocType.TEMPLATE }))
      .mockResolvedValueOnce(null);
    prisma.workspaceMembership.count.mockResolvedValue(1);
    tx.doc.create.mockResolvedValue(docRecord({ id: 'doc-copy', title: 'Copy' }));

    await expect(
      service.createFromTemplate(tenant, { templateId: 'template-1', title: 'Copy' }),
    ).resolves.toMatchObject({ id: 'doc-copy', title: 'Copy' });

    await expect(
      service.createFromTemplate(tenant, { templateId: 'foreign-template' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves archived Doc relationships, blocks edits, and restores non-destructively', async () => {
    const { service, prisma, tx, audit } = buildService();
    prisma.doc.findFirst
      .mockResolvedValueOnce(
        authDoc({ accessList: [{ membershipId: 'member-a', role: 'EDITOR' }] }),
      )
      .mockResolvedValueOnce(
        authDoc({ accessList: [{ membershipId: 'member-a', role: 'EDITOR' }] }),
      );
    tx.doc.findFirst
      .mockResolvedValueOnce(
        authDoc({ accessList: [{ membershipId: 'member-a', role: 'EDITOR' }] }),
      )
      .mockResolvedValueOnce(docRecord({ status: DocStatus.ARCHIVED }));
    prisma.doc.update
      .mockResolvedValueOnce(docRecord({ status: DocStatus.ARCHIVED }))
      .mockResolvedValueOnce(docRecord({ status: DocStatus.ACTIVE }));

    await expect(service.archiveDoc(tenant, 'doc-1')).resolves.toMatchObject({
      status: DocStatus.ARCHIVED,
    });
    await expect(service.restoreDoc(tenant, 'doc-1')).resolves.toMatchObject({
      status: DocStatus.ACTIVE,
    });
    await expect(
      service.updateDoc(tenant, 'doc-1', { expectedRevision: 1, title: 'Blocked' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'doc.archive' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'doc.restore' }));
  });

  it('authorizes attachments by same Workspace Asset and never exposes parent signed URLs', async () => {
    const { service, prisma } = buildService();
    prisma.doc.findFirst.mockResolvedValue(
      authDoc({ accessList: [{ membershipId: 'member-a', role: 'EDITOR' }] }),
    );
    prisma.asset.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.attachAsset(tenant, 'doc-1', { assetId: 'asset-foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.doc.findMany.mockResolvedValueOnce([
      {
        id: 'doc-1',
        workspaceId: 'workspace-a',
        title: 'Visible',
        content: docContent,
        visibility: DocVisibility.WORKSPACE,
        status: DocStatus.ACTIVE,
        workspace: { id: 'workspace-a', name: 'Workspace A', slug: 'a', agency: {} },
        _count: { attachments: 1 },
      },
    ]);
    prisma.doc.count.mockResolvedValueOnce(1);
    const result = await service.listAgencyDocs(
      { agencyId: 'agency-1', permissions: [] } as never,
      {
        status: DocStatus.ACTIVE,
        page: 1,
        pageSize: 25,
      },
    );
    expect(result.items[0]).not.toHaveProperty('attachments');
    expect(JSON.stringify(result)).not.toMatch(/downloadUrl|signedUrl|storageKey/);
  });

  it('stores public share tokens and passwords as hashes only, revokes and regenerates old links, and audits safely', async () => {
    const { service, prisma, audit } = buildService();
    prisma.doc.findFirst.mockResolvedValue(
      authDoc({ accessList: [{ membershipId: 'member-a', role: 'EDITOR' }] }),
    );
    prisma.docShare.create
      .mockResolvedValueOnce(shareRecord({ id: 'share-1', passwordHash: 'hashed:pw' }))
      .mockResolvedValueOnce(shareRecord({ id: 'share-2' }));
    prisma.docShare.update.mockResolvedValue(
      shareRecord({ id: 'share-1', status: DocShareStatus.REVOKED }),
    );

    const created = await service.createShare(tenant, 'doc-1', {
      expiresAt: '2030-01-01T00:00:00.000Z',
      password: 'secret-password',
    });
    const createData = prisma.docShare.create.mock.calls[0][0].data;
    expect(created.token).toBeDefined();
    expect(createData.tokenHash).toHaveLength(64);
    expect(createData.tokenHash).not.toBe(created.token);
    expect(createData.passwordHash).toBe('hashed:secret-password');

    const regenerated = await service.regenerateShare(tenant, 'doc-1', 'share-1');
    expect(regenerated.id).toBe('share-2');
    expect(prisma.docShare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'share-1' },
        data: expect.objectContaining({ status: DocShareStatus.REVOKED }),
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(created.token);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('secret-password');
  });

  it('protects public shares from invalid, expired, revoked, password, and unrelated attachment access', async () => {
    const { service, prisma, passwords, storage } = buildService();
    prisma.docShare.findUnique.mockResolvedValueOnce(null);
    await expect(service.publicShare('missing')).rejects.toBeInstanceOf(NotFoundException);

    prisma.docShare.findUnique.mockResolvedValueOnce(shareRecord({ expiresAt: new Date(0) }));
    await expect(service.publicShare('expired')).rejects.toBeInstanceOf(GoneException);

    prisma.docShare.findUnique.mockResolvedValueOnce(
      shareRecord({ status: DocShareStatus.REVOKED, revokedAt: new Date() }),
    );
    await expect(service.publicShare('revoked')).rejects.toBeInstanceOf(NotFoundException);

    prisma.docShare.findUnique.mockResolvedValueOnce(shareRecord({ passwordHash: 'hashed:pw' }));
    await expect(service.publicShare('needs-password')).rejects.toBeInstanceOf(ForbiddenException);

    prisma.docShare.findUnique.mockResolvedValueOnce(shareRecord({ passwordHash: 'hashed:pw' }));
    passwords.verify.mockReturnValueOnce(false);
    await expect(service.verifySharePassword('wrong', 'nope')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.docShare.findUnique.mockResolvedValueOnce(shareRecord());
    await expect(
      service.publicAttachmentDownload('valid', 'other-attachment'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('filters parent oversight to descendant WORKSPACE Docs with safe bounded query shape', async () => {
    const { service, prisma } = buildService();

    await service.listSuperAgencyDocs({ superAgencyId: 'super-1', permissions: [] } as never, {
      status: DocStatus.ACTIVE,
      search: 'roadmap',
      agencyId: 'agency-1',
      page: 2,
      pageSize: 10,
    });

    expect(prisma.doc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visibility: DocVisibility.WORKSPACE,
          workspace: expect.objectContaining({
            agencyId: 'agency-1',
            agency: { superAgencyId: 'super-1' },
          }),
        }),
        skip: 10,
        take: 10,
      }),
    );
    const select = prisma.doc.findMany.mock.calls[0][0].select;
    expect(select).toHaveProperty('content');
    expect(select).not.toHaveProperty('comments');
    expect(select).not.toHaveProperty('versions');
    expect(select).not.toHaveProperty('accessList');
    expect(select).not.toHaveProperty('attachments');
    expect(select).not.toHaveProperty('shares');
  });
});

function buildService() {
  const tx = mockDb();
  const prisma = mockDb();
  prisma.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') return arg(tx);
    return Promise.all(arg as Promise<unknown>[]);
  });
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = { createNotification: jest.fn().mockResolvedValue(undefined) };
  const passwords = {
    hash: jest.fn((password: string) => `hashed:${password}`),
    verify: jest.fn((hash: string, password: string) => hash === `hashed:${password}`),
  };
  const storage = {
    createPresignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.test'),
  };
  return {
    service: new DocsService(
      prisma as never,
      audit as never,
      notifications as never,
      passwords as never,
      storage as never,
    ),
    prisma,
    tx,
    audit,
    notifications,
    passwords,
    storage,
  };
}

function mockDb() {
  return {
    $transaction: jest.fn(),
    doc: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    docFolder: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    docAccess: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    docVersion: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    docComment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    docMention: {
      create: jest.fn().mockResolvedValue({}),
    },
    docFavorite: {
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    asset: {
      findFirst: jest.fn(),
    },
    docAttachment: {
      upsert: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
    },
    docShare: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    workspaceMembership: {
      count: jest.fn().mockResolvedValue(1),
    },
  };
}

function authDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    visibility: DocVisibility.WORKSPACE,
    createdByMembershipId: 'member-owner',
    accessList: [],
    ...overrides,
  };
}

function docRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    workspaceId: tenant.workspaceId,
    folderId: null,
    parentDocId: null,
    title: 'Launch Notes',
    content: docContent,
    contentRevision: 1,
    visibility: DocVisibility.WORKSPACE,
    type: DocType.PAGE,
    status: DocStatus.ACTIVE,
    sortOrder: 0,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdByMembershipId: tenant.workspaceMembershipId,
    createdByMembership: {
      id: tenant.workspaceMembershipId,
      user: { id: 'user-1', name: 'A', email: 'a@test' },
    },
    updatedByMembership: {
      id: tenant.workspaceMembershipId,
      user: { id: 'user-1', name: 'A', email: 'a@test' },
    },
    accessList: [{ membershipId: tenant.workspaceMembershipId, role: DocAccessRole.EDITOR }],
    favorites: [],
    attachments: [],
    shares: [],
    _count: { comments: 0, attachments: 0 },
    lastSnapshotAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function shareRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    workspaceId: tenant.workspaceId,
    docId: 'doc-1',
    tokenHash: 'a'.repeat(64),
    status: DocShareStatus.ACTIVE,
    expiresAt: null,
    passwordHash: null,
    revokedAt: null,
    lastAccessedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    doc: {
      id: 'doc-1',
      title: 'Public',
      content: docContent,
      contentRevision: 1,
      status: DocStatus.ACTIVE,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      attachments: [
        {
          id: 'attachment-1',
          asset: {
            id: 'asset-1',
            displayName: 'safe.txt',
            mimeType: 'text/plain',
            sizeBytes: 12,
            status: AssetStatus.READY,
            lifecycle: AssetLifecycle.ACTIVE,
            storageKey: 'workspaces/workspace-a/files/asset-1/original',
          },
        },
      ],
    },
    ...overrides,
  };
}
