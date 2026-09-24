import { BadRequestException } from '@nestjs/common';

export type NotificationEmailTemplateKey =
  | 'task.assigned'
  | 'task.due_soon'
  | 'task.overdue'
  | 'project.due_soon'
  | 'ticket.assigned'
  | 'ticket.sla_warning'
  | 'automation.failed'
  | 'automation.dead_lettered'
  | 'gamification.achievement_earned'
  | 'gamification.badge_earned';

export interface NotificationEmailTemplateData {
  title?: string | null;
  taskTitle?: string | null;
  projectName?: string | null;
  ticketNumber?: string | null;
  ticketSubject?: string | null;
  workflowName?: string | null;
  achievementName?: string | null;
  badgeName?: string | null;
  dueAt?: string | null;
  entityId?: string | null;
}

export interface RenderedNotificationEmail {
  subject: string;
  text: string;
  html: string;
}

const MAX_VALUE_LENGTH = 180;

export function renderNotificationEmailTemplate(
  key: NotificationEmailTemplateKey,
  data: NotificationEmailTemplateData,
  appUrl: string,
): RenderedNotificationEmail {
  const safe = normalizeTemplateData(data);
  const actionUrl = fixedActionUrl(appUrl, safe.entityId);
  const cta = actionUrl ? `\n\nOpen in ZeaPlay: ${actionUrl}` : '';
  switch (key) {
    case 'task.assigned':
      return render('Task assigned', `You were assigned to ${safe.taskTitle ?? 'a task'}.${cta}`);
    case 'task.due_soon':
      return render(
        'Task due soon',
        `${safe.taskTitle ?? 'A task'} is due soon${formatDue(safe.dueAt)}.${cta}`,
      );
    case 'task.overdue':
      return render('Task overdue', `${safe.taskTitle ?? 'A task'} is overdue.${cta}`);
    case 'project.due_soon':
      return render(
        'Project due soon',
        `${safe.projectName ?? 'A project'} is due soon${formatDue(safe.dueAt)}.${cta}`,
      );
    case 'ticket.assigned':
      return render(
        'Ticket assigned',
        `You were assigned to ${safe.ticketNumber ?? 'a ticket'}: ${safe.ticketSubject ?? 'Untitled ticket'}.${cta}`,
      );
    case 'ticket.sla_warning':
      return render(
        'Ticket SLA warning',
        `${safe.ticketNumber ?? 'A ticket'} is approaching its SLA deadline${formatDue(safe.dueAt)}.${cta}`,
      );
    case 'automation.failed':
      return render(
        'Automation failed',
        `${safe.workflowName ?? 'An automation'} failed and needs attention.${cta}`,
      );
    case 'automation.dead_lettered':
      return render(
        'Automation dead lettered',
        `${safe.workflowName ?? 'An automation'} exhausted retries and was moved to dead letter.${cta}`,
      );
    case 'gamification.achievement_earned':
      return render(
        'Achievement earned',
        `You earned ${safe.achievementName ?? 'an achievement'} in ZeaPlay.${cta}`,
      );
    case 'gamification.badge_earned':
      return render('Badge earned', `You earned ${safe.badgeName ?? 'a badge'} in ZeaPlay.${cta}`);
    default:
      throw new BadRequestException('UNKNOWN_NOTIFICATION_EMAIL_TEMPLATE');
  }
}

function render(subject: string, text: string): RenderedNotificationEmail {
  return {
    subject,
    text,
    html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
  };
}

function normalizeTemplateData(
  data: NotificationEmailTemplateData,
): Required<NotificationEmailTemplateData> {
  return {
    title: bounded(data.title),
    taskTitle: bounded(data.taskTitle),
    projectName: bounded(data.projectName),
    ticketNumber: bounded(data.ticketNumber),
    ticketSubject: bounded(data.ticketSubject),
    workflowName: bounded(data.workflowName),
    achievementName: bounded(data.achievementName),
    badgeName: bounded(data.badgeName),
    dueAt: bounded(data.dueAt),
    entityId: uuidValue(data.entityId),
  };
}

function bounded(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  return normalized ? normalized.slice(0, MAX_VALUE_LENGTH) : null;
}

function uuidValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return isUuid(value) ? value : null;
}

function formatDue(value: string | null) {
  return value ? ` at ${value}` : '';
}

function fixedActionUrl(appUrl: string, entityId: string | null) {
  if (!entityId) return null;
  const base = appUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}/notifications/${entityId}`;
}

function isUuid(value: string | null | undefined) {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
