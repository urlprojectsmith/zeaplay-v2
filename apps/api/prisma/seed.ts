import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import * as crypto from 'node:crypto';

const prisma = new PrismaClient();

const permissions = [
  'organization.read',
  'organization.update',
  'member.read',
  'member.create',
  'member.update',
  'member.delete',
  'project.read',
  'project.create',
  'project.update',
  'project.delete',
  'asset.read',
  'asset.create',
  'asset.delete',
  'asset.download',
];

const rolePermissions: Record<string, string[]> = {
  OWNER: permissions,
  ADMIN: permissions.filter((permission) => permission !== 'member.delete'),
  MANAGER: [
    'organization.read',
    'member.read',
    'project.read',
    'project.create',
    'project.update',
    'asset.read',
    'asset.create',
    'asset.delete',
    'asset.download',
  ],
  MEMBER: ['organization.read', 'member.read', 'project.read', 'asset.read', 'asset.download'],
};

const seedUsers = [
  { email: 'owner@zeaplay.test', name: 'Owner User', role: 'OWNER', organization: 'alpha' },
  { email: 'admin@zeaplay.test', name: 'Admin User', role: 'ADMIN', organization: 'alpha' },
  { email: 'member@zeaplay.test', name: 'Member User', role: 'MEMBER', organization: 'alpha' },
  { email: 'other-owner@zeaplay.test', name: 'Other Owner', role: 'OWNER', organization: 'beta' },
];

async function main() {
  const passwordHash = hashPassword('DevelopmentPassword123!');

  for (const key of permissions) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: `${key} permission` },
    });
  }

  for (const [name, keys] of Object.entries(rolePermissions)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: `${name} system role` },
    });
    const permissionRows = await prisma.permission.findMany({ where: { key: { in: keys } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissionRows.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }

  const alpha = await prisma.organization.upsert({
    where: { slug: 'alpha-studio' },
    update: {},
    create: { name: 'Alpha Studio', slug: 'alpha-studio' },
  });
  const beta = await prisma.organization.upsert({
    where: { slug: 'beta-lab' },
    update: {},
    create: { name: 'Beta Lab', slug: 'beta-lab' },
  });
  const organizations = { alpha, beta };

  for (const seedUser of seedUsers) {
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: { name: seedUser.name },
      create: { email: seedUser.email, name: seedUser.name, passwordHash },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: seedUser.role } });
    const organization = organizations[seedUser.organization as keyof typeof organizations];
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      update: { roleId: role.id, status: 'ACTIVE' },
      create: { userId: user.id, organizationId: organization.id, roleId: role.id },
    });
  }

  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@zeaplay.test' } });
  const otherOwner = await prisma.user.findUniqueOrThrow({
    where: { email: 'other-owner@zeaplay.test' },
  });
  const memberRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: beta.id } },
    update: { roleId: memberRole.id, status: 'ACTIVE' },
    create: { userId: owner.id, organizationId: beta.id, roleId: memberRole.id },
  });
  await ensureProject(alpha.id, owner.id, 'Alpha Launch', 'Phase 2 sample project', 'ACTIVE');
  await ensureProject(
    beta.id,
    otherOwner.id,
    'Beta Sandbox',
    'Cross-tenant security fixture',
    'DRAFT',
  );
}

async function ensureProject(
  organizationId: string,
  createdById: string,
  name: string,
  description: string,
  status: 'ACTIVE' | 'DRAFT',
) {
  const existing = await prisma.project.findFirst({ where: { organizationId, name } });
  if (existing) return;
  await prisma.project.create({ data: { organizationId, createdById, name, description, status } });
}

function hashPassword(password: string) {
  const { argon2Sync } = crypto as typeof crypto & {
    argon2Sync: (algorithm: 'argon2id', options: Argon2Options) => Buffer;
  };
  const nonce = randomBytes(16);
  const memory = 19_456;
  const passes = 2;
  const parallelism = 1;
  const tag = argon2Sync('argon2id', {
    message: Buffer.from(password),
    nonce,
    parallelism,
    tagLength: 32,
    memory,
    passes,
  });
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${nonce.toString(
    'base64url',
  )}$${tag.toString('base64url')}`;
}

interface Argon2Options {
  message: Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
