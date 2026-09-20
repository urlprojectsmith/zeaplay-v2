import { StatusCategory, StatusEntityType, type PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma.service';

type PrismaWritable = PrismaClient | PrismaService;

export interface StatusTemplate {
  name: string;
  description?: string;
  color: string;
  category: StatusCategory;
  isDefault?: boolean;
  isTerminal?: boolean;
}

export const defaultStatusTemplates: Record<StatusEntityType, StatusTemplate[]> = {
  TASK: [
    { name: 'To Do', color: '#64748B', category: StatusCategory.TODO, isDefault: true },
    { name: 'In Progress', color: '#2563EB', category: StatusCategory.IN_PROGRESS },
    { name: 'Review', color: '#D97706', category: StatusCategory.REVIEW },
    { name: 'Completed', color: '#16A34A', category: StatusCategory.COMPLETED, isTerminal: true },
  ],
  PROJECT: [
    {
      name: 'Initial Meeting',
      color: '#64748B',
      category: StatusCategory.BACKLOG,
      isDefault: true,
    },
    { name: 'Requirement Analysis', color: '#0891B2', category: StatusCategory.TODO },
    { name: 'Development', color: '#2563EB', category: StatusCategory.IN_PROGRESS },
    { name: 'Testing', color: '#7C3AED', category: StatusCategory.REVIEW },
    { name: 'Client Review', color: '#D97706', category: StatusCategory.REVIEW },
    { name: 'Deployment', color: '#0D9488', category: StatusCategory.IN_PROGRESS },
    { name: 'Completed', color: '#16A34A', category: StatusCategory.COMPLETED, isTerminal: true },
  ],
  TICKET: [
    { name: 'New', color: '#64748B', category: StatusCategory.TODO, isDefault: true },
    { name: 'Open', color: '#0891B2', category: StatusCategory.TODO },
    { name: 'In Progress', color: '#2563EB', category: StatusCategory.IN_PROGRESS },
    { name: 'Waiting on Requester', color: '#D97706', category: StatusCategory.REVIEW },
    { name: 'Resolved', color: '#16A34A', category: StatusCategory.COMPLETED, isTerminal: true },
    { name: 'Closed', color: '#475569', category: StatusCategory.COMPLETED, isTerminal: true },
  ],
};

export async function initializeDefaultStatuses(prisma: PrismaWritable, workspaceId: string) {
  for (const entityType of Object.values(StatusEntityType)) {
    const existing = await prisma.statusDefinition.count({ where: { workspaceId, entityType } });
    if (existing > 0) continue;
    const templates = defaultStatusTemplates[entityType];
    for (const [index, template] of templates.entries()) {
      await prisma.statusDefinition.create({
        data: {
          workspaceId,
          entityType,
          name: template.name,
          nameNormalized: normalizeStatusName(template.name),
          description: template.description,
          color: template.color,
          position: index + 1,
          category: template.category,
          isDefault: Boolean(template.isDefault),
          isTerminal: Boolean(template.isTerminal),
          isActive: true,
          isSystem: false,
        },
      });
    }
  }
}

export function normalizeStatusName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
