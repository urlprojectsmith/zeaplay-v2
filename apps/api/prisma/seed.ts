import { AssetStatus, PrismaClient, ProjectStatus, RoleScope, TaskPriority } from '@prisma/client';
import { PasswordService } from '../src/common/auth/password.service';
import { initializeDefaultStatuses } from '../src/modules/statuses/status-templates';

const prisma = new PrismaClient();
const passwords = new PasswordService();

const workspacePermissions = [
  'workspace.read',
  'workspace.update',
  'workspace.member.read',
  'workspace.member.create',
  'workspace.member.update',
  'users.view',
  'users.manage',
  'departments.view',
  'departments.create',
  'departments.update',
  'departments.manage_members',
  'roles.view',
  'roles.create',
  'roles.update',
  'roles.manage_permissions',
  'roles.assign',
  'statuses.view',
  'statuses.create',
  'statuses.update',
  'statuses.reorder',
  'statuses.manage',
  'tasks.view',
  'tasks.create',
  'tasks.update',
  'tasks.delete',
  'tasks.assign',
  'tasks.manage',
  'tasks.comments.view',
  'tasks.comments.create',
  'tasks.comments.update_own',
  'tasks.comments.delete_own',
  'tasks.comments.moderate',
  'tasks.comments.internal',
  'project.read',
  'project.create',
  'project.update',
  'project.delete',
  'asset.read',
  'asset.create',
  'asset.delete',
  'asset.download',
];

const agencyPermissions = [
  'agency.read',
  'agency.update',
  'agency.member.read',
  'agency.member.create',
  'agency.member.update',
  'workspace.read',
  'workspace.create',
  'workspace.update',
  'workspace.member.read',
  'workspace.member.create',
  'workspace.member.update',
  'feature.read',
  'feature.update',
];

async function main() {
  await seedPermissions();
  const roles = await seedRoles();

  const owner = await upsertUser('owner@zeaplay.test', 'Owner User');
  const admin = await upsertUser('admin@zeaplay.test', 'Admin User');
  const member = await upsertUser('member@zeaplay.test', 'Member User');
  const otherOwner = await upsertUser('other-owner@zeaplay.test', 'Other Owner');

  const agencyAlpha = await prisma.agency.upsert({
    where: { slug: 'agency-alpha' },
    update: {},
    create: { name: 'Agency Alpha', slug: 'agency-alpha', createdById: owner.id },
  });
  const agencyBeta = await prisma.agency.upsert({
    where: { slug: 'agency-beta' },
    update: {},
    create: { name: 'Agency Beta', slug: 'agency-beta', createdById: otherOwner.id },
  });

  const workspaceAlphaMain = await prisma.workspace.upsert({
    where: { agencyId_slug: { agencyId: agencyAlpha.id, slug: 'alpha-main' } },
    update: {},
    create: {
      agencyId: agencyAlpha.id,
      name: 'Alpha Main',
      slug: 'alpha-main',
      createdById: owner.id,
    },
  });
  const workspaceAlphaSecondary = await prisma.workspace.upsert({
    where: { agencyId_slug: { agencyId: agencyAlpha.id, slug: 'alpha-secondary' } },
    update: {},
    create: {
      agencyId: agencyAlpha.id,
      name: 'Alpha Secondary',
      slug: 'alpha-secondary',
      createdById: owner.id,
    },
  });
  const workspaceBeta = await prisma.workspace.upsert({
    where: { agencyId_slug: { agencyId: agencyBeta.id, slug: 'beta-main' } },
    update: {},
    create: {
      agencyId: agencyBeta.id,
      name: 'Beta Main',
      slug: 'beta-main',
      createdById: otherOwner.id,
    },
  });

  await upsertAgencyMembership(owner.id, agencyAlpha.id, roles.AGENCY_OWNER.id);
  await upsertAgencyMembership(admin.id, agencyAlpha.id, roles.AGENCY_ADMIN.id);
  await upsertAgencyMembership(member.id, agencyAlpha.id, roles.AGENCY_USER.id);
  await upsertAgencyMembership(otherOwner.id, agencyBeta.id, roles.AGENCY_OWNER.id);

  const ownerAlphaMainMembership = await upsertWorkspaceMembership(
    owner.id,
    workspaceAlphaMain.id,
    roles.OWNER.id,
  );
  const adminAlphaMainMembership = await upsertWorkspaceMembership(
    admin.id,
    workspaceAlphaMain.id,
    roles.ADMIN.id,
  );
  const memberAlphaMainMembership = await upsertWorkspaceMembership(
    member.id,
    workspaceAlphaMain.id,
    roles.MEMBER.id,
  );
  const ownerAlphaSecondaryMembership = await upsertWorkspaceMembership(
    owner.id,
    workspaceAlphaSecondary.id,
    roles.OWNER.id,
  );
  const ownerBetaMembership = await upsertWorkspaceMembership(
    otherOwner.id,
    workspaceBeta.id,
    roles.OWNER.id,
  );

  await initializeDefaultStatuses(prisma, workspaceAlphaMain.id);
  await initializeDefaultStatuses(prisma, workspaceAlphaSecondary.id);
  await initializeDefaultStatuses(prisma, workspaceBeta.id);

  const alphaMainProject = await upsertProject(
    workspaceAlphaMain.id,
    owner.id,
    'Alpha Launch',
    'Seed project for Agency Alpha.',
  );
  const alphaSecondaryProject = await upsertProject(
    workspaceAlphaSecondary.id,
    owner.id,
    'Alpha Secondary Launch',
    'Seed project for Agency Alpha secondary workspace.',
  );
  const betaProject = await upsertProject(
    workspaceBeta.id,
    otherOwner.id,
    'Beta Sandbox',
    'Seed project for Agency Beta.',
  );
  await seedTasks([
    {
      workspaceId: workspaceAlphaMain.id,
      title: 'Prepare Alpha launch checklist',
      createdById: owner.id,
      priority: TaskPriority.HIGH,
      statusName: 'To Do',
      assigneeMembershipIds: [adminAlphaMainMembership.id, memberAlphaMainMembership.id],
      followerMembershipIds: [ownerAlphaMainMembership.id],
      projectIds: [alphaMainProject.id],
      dueAt: daysFromNow(7),
    },
    {
      workspaceId: workspaceAlphaMain.id,
      title: 'Review Alpha QA notes',
      createdById: admin.id,
      priority: TaskPriority.MEDIUM,
      statusName: 'In Progress',
      assigneeMembershipIds: [memberAlphaMainMembership.id],
      followerMembershipIds: [adminAlphaMainMembership.id],
      projectIds: [],
      dueAt: daysFromNow(10),
    },
    {
      workspaceId: workspaceAlphaSecondary.id,
      title: 'Confirm secondary workspace kickoff',
      createdById: owner.id,
      priority: TaskPriority.LOW,
      statusName: 'To Do',
      assigneeMembershipIds: [ownerAlphaSecondaryMembership.id],
      followerMembershipIds: [],
      projectIds: [alphaSecondaryProject.id],
      dueAt: daysFromNow(14),
    },
    {
      workspaceId: workspaceBeta.id,
      title: 'Beta sandbox setup',
      createdById: otherOwner.id,
      priority: TaskPriority.URGENT,
      statusName: 'Review',
      assigneeMembershipIds: [ownerBetaMembership.id],
      followerMembershipIds: [],
      projectIds: [betaProject.id],
      dueAt: daysFromNow(3),
    },
  ]);
  await upsertAsset(
    workspaceAlphaMain.id,
    alphaMainProject.id,
    owner.id,
    'alpha-main-seed.txt',
    128,
  );
  await upsertAsset(
    workspaceAlphaSecondary.id,
    alphaSecondaryProject.id,
    owner.id,
    'alpha-secondary-seed.txt',
    256,
  );
  await upsertAsset(workspaceBeta.id, betaProject.id, otherOwner.id, 'beta-main-seed.txt', 64);
  await refreshWorkspaceStorage(workspaceAlphaMain.id);
  await refreshWorkspaceStorage(workspaceAlphaSecondary.id);
  await refreshWorkspaceStorage(workspaceBeta.id);

  await seedFeatures();
}

async function seedPermissions() {
  const allPermissions = [...new Set([...workspacePermissions, ...agencyPermissions])];
  for (const key of allPermissions) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: `${key} permission` },
    });
  }
}

async function seedRoles() {
  const definitions = [
    {
      key: 'AGENCY_OWNER',
      name: 'Agency Owner',
      scope: RoleScope.AGENCY,
      permissions: agencyPermissions,
    },
    {
      key: 'AGENCY_ADMIN',
      name: 'Agency Admin',
      scope: RoleScope.AGENCY,
      permissions: agencyPermissions,
    },
    {
      key: 'AGENCY_MANAGER',
      name: 'Agency Manager',
      scope: RoleScope.AGENCY,
      permissions: ['agency.read', 'workspace.read'],
    },
    {
      key: 'AGENCY_USER',
      name: 'Agency User',
      scope: RoleScope.AGENCY,
      permissions: ['agency.read', 'workspace.read'],
    },
    { key: 'OWNER', name: 'Owner', scope: RoleScope.WORKSPACE, permissions: workspacePermissions },
    { key: 'ADMIN', name: 'Admin', scope: RoleScope.WORKSPACE, permissions: workspacePermissions },
    {
      key: 'MANAGER',
      name: 'Manager',
      scope: RoleScope.WORKSPACE,
      permissions: [
        'workspace.read',
        'users.view',
        'departments.view',
        'project.read',
        'project.create',
        'project.update',
        'asset.read',
        'asset.create',
        'asset.download',
      ],
    },
    {
      key: 'MEMBER',
      name: 'Member',
      scope: RoleScope.WORKSPACE,
      permissions: ['workspace.read', 'project.read', 'asset.read', 'asset.download'],
    },
  ];
  const roles: Record<string, { id: string }> = {};
  for (const definition of definitions) {
    const role = await prisma.role.upsert({
      where: { key: definition.key },
      update: { name: definition.name, scope: definition.scope, isSystem: true },
      create: {
        key: definition.key,
        name: definition.name,
        nameNormalized: null,
        scope: definition.scope,
        isSystem: true,
        isActive: true,
      },
    });
    roles[definition.key] = role;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const permissionKey of definition.permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
  return roles as Record<
    | 'AGENCY_OWNER'
    | 'AGENCY_ADMIN'
    | 'AGENCY_MANAGER'
    | 'AGENCY_USER'
    | 'OWNER'
    | 'ADMIN'
    | 'MANAGER'
    | 'MEMBER',
    { id: string }
  >;
}

async function upsertUser(email: string, name: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name, passwordHash: passwords.hash('Password123!') },
  });
}

async function upsertAgencyMembership(userId: string, agencyId: string, roleId: string) {
  await prisma.agencyMembership.upsert({
    where: { userId_agencyId: { userId, agencyId } },
    update: { roleId },
    create: { userId, agencyId, roleId },
  });
}

async function upsertWorkspaceMembership(userId: string, workspaceId: string, roleId: string) {
  return prisma.workspaceMembership.upsert({
    where: { userId_workspaceId: { userId, workspaceId } },
    update: { roleId },
    create: { userId, workspaceId, roleId },
  });
}

async function upsertProject(
  workspaceId: string,
  createdById: string,
  name: string,
  description: string,
) {
  const existing = await prisma.project.findFirst({ where: { workspaceId, name } });
  if (existing) return existing;
  return prisma.project.create({
    data: { workspaceId, createdById, name, description, status: ProjectStatus.ACTIVE },
  });
}

async function upsertAsset(
  workspaceId: string,
  projectId: string,
  createdById: string,
  filename: string,
  sizeBytes: number,
) {
  const storageKey = `workspace/${workspaceId}/projects/${projectId}/assets/${filename}/seed.txt`;
  const existing = await prisma.asset.findUnique({ where: { storageKey } });
  if (existing) return existing;
  return prisma.asset.create({
    data: {
      workspaceId,
      projectId,
      createdById,
      originalFilename: filename,
      displayName: filename,
      storageBucket: 'zea-play-dev',
      storageKey,
      mimeType: 'text/plain',
      extension: 'txt',
      sizeBytes,
      status: AssetStatus.READY,
      uploadExpiresAt: new Date(Date.now() + 60_000),
    },
  });
}

async function seedTasks(
  tasks: {
    workspaceId: string;
    title: string;
    createdById: string;
    priority: TaskPriority;
    statusName: string;
    assigneeMembershipIds: string[];
    followerMembershipIds: string[];
    projectIds: string[];
    dueAt: Date;
  }[],
) {
  for (const taskSeed of tasks) {
    const status = await prisma.statusDefinition.findFirstOrThrow({
      where: {
        workspaceId: taskSeed.workspaceId,
        entityType: 'TASK',
        name: taskSeed.statusName,
        isActive: true,
      },
    });
    const existing = await prisma.task.findFirst({
      where: { workspaceId: taskSeed.workspaceId, title: taskSeed.title },
    });
    const task =
      existing ??
      (await prisma.task.create({
        data: {
          workspaceId: taskSeed.workspaceId,
          title: taskSeed.title,
          createdById: taskSeed.createdById,
          priority: taskSeed.priority,
          statusDefinitionId: status.id,
          dueAt: taskSeed.dueAt,
        },
      }));
    await prisma.task.update({
      where: { id: task.id },
      data: {
        priority: taskSeed.priority,
        statusDefinitionId: status.id,
        dueAt: taskSeed.dueAt,
        deletedAt: null,
      },
    });
    await prisma.taskAssignee.deleteMany({ where: { taskId: task.id } });
    await prisma.taskFollower.deleteMany({ where: { taskId: task.id } });
    await prisma.taskProject.deleteMany({ where: { taskId: task.id } });
    if (taskSeed.assigneeMembershipIds.length > 0) {
      await prisma.taskAssignee.createMany({
        data: taskSeed.assigneeMembershipIds.map((membershipId) => ({
          taskId: task.id,
          workspaceId: taskSeed.workspaceId,
          membershipId,
        })),
      });
    }
    if (taskSeed.followerMembershipIds.length > 0) {
      await prisma.taskFollower.createMany({
        data: taskSeed.followerMembershipIds.map((membershipId) => ({
          taskId: task.id,
          workspaceId: taskSeed.workspaceId,
          membershipId,
        })),
      });
    }
    if (taskSeed.projectIds.length > 0) {
      await prisma.taskProject.createMany({
        data: taskSeed.projectIds.map((projectId) => ({
          taskId: task.id,
          workspaceId: taskSeed.workspaceId,
          projectId,
        })),
      });
    }
  }
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function refreshWorkspaceStorage(workspaceId: string) {
  const result = await prisma.asset.aggregate({
    where: { workspaceId, deletedAt: null },
    _sum: { sizeBytes: true },
  });
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { storageUsedBytes: result._sum.sizeBytes ?? 0 },
  });
}

async function seedFeatures() {
  for (const key of ['assets', 'projects']) {
    await prisma.featureDefinition.upsert({
      where: { key },
      update: {},
      create: {
        key,
        name: `${key.charAt(0).toUpperCase()}${key.slice(1)}`,
        enabledByDefault: true,
      },
    });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
