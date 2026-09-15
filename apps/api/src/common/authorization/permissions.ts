export const PermissionKeys = {
  organizationRead: 'organization.read',
  organizationUpdate: 'organization.update',
  memberRead: 'member.read',
  memberCreate: 'member.create',
  memberUpdate: 'member.update',
  memberDelete: 'member.delete',
  projectRead: 'project.read',
  projectCreate: 'project.create',
  projectUpdate: 'project.update',
  projectDelete: 'project.delete',
  assetRead: 'asset.read',
  assetCreate: 'asset.create',
  assetDelete: 'asset.delete',
  assetDownload: 'asset.download',
} as const;

export const OWNER_ROLE = 'OWNER';
