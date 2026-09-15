import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const correlationIdSchema = z.string().min(1).max(128);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
