import { BadRequestException, Logger } from '@nestjs/common';
import { IANAZone } from 'luxon';

export const DEFAULT_WORKSPACE_TIMEZONE = 'UTC';

const logger = new Logger('WorkspaceTimezone');

export function isValidIanaTimezone(value: string) {
  return IANAZone.isValidZone(value.trim());
}

export function normalizeIanaTimezone(value: string | null | undefined, label = 'Timezone') {
  const timezone = value?.trim() || DEFAULT_WORKSPACE_TIMEZONE;
  if (!isValidIanaTimezone(timezone)) {
    throw new BadRequestException(`${label} must be a valid IANA timezone.`);
  }
  return timezone;
}

export function safeWorkspaceTimezone(value: string | null | undefined, workspaceId?: string) {
  const timezone = value?.trim() || DEFAULT_WORKSPACE_TIMEZONE;
  if (isValidIanaTimezone(timezone)) return timezone;
  logger.warn({
    workspaceId,
    timezone,
    fallbackTimezone: DEFAULT_WORKSPACE_TIMEZONE,
    message: 'Workspace timezone is invalid; using fallback timezone.',
  });
  return DEFAULT_WORKSPACE_TIMEZONE;
}
