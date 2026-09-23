import { BadRequestException } from '@nestjs/common';

export const AUTOMATION_VARIABLE_NOT_FOUND = 'AUTOMATION_VARIABLE_NOT_FOUND';
export const AUTOMATION_VARIABLE_INVALID = 'AUTOMATION_VARIABLE_INVALID';

const referencePattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
const fullReferencePattern = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const allowedRoots = new Set(['event', 'trigger', 'execution', 'steps']);
const dangerousSegments = new Set(['__proto__', 'prototype', 'constructor']);
const maxPathLength = 160;
const maxSegments = 12;
const maxReferences = 20;
const maxResolvedStringLength = 4000;
const maxResolvedConfigBytes = 16 * 1024;

export interface AutomationVariableContext {
  event: Record<string, unknown>;
  trigger: Record<string, unknown>;
  execution: Record<string, unknown>;
  steps: Record<string, { result?: unknown }>;
}

export class AutomationVariableResolver {
  resolveConfig<T>(value: T, context: AutomationVariableContext): T {
    const references = { count: 0 };
    const resolved = this.resolveValue(value, context, references, 'config') as T;
    if (Buffer.byteLength(JSON.stringify(resolved), 'utf8') > maxResolvedConfigBytes) {
      throw automationVariableError(AUTOMATION_VARIABLE_INVALID, 'Resolved config is too large.');
    }
    return resolved;
  }

  pathExists(path: string, context: AutomationVariableContext) {
    this.validatePath(path);
    return this.traverse(path, context).exists;
  }

  resolvePath(path: string, context: AutomationVariableContext) {
    this.validatePath(path);
    const result = this.traverse(path, context);
    if (!result.exists) {
      throw automationVariableError(AUTOMATION_VARIABLE_NOT_FOUND, `Variable not found: ${path}`);
    }
    return result.value;
  }

  private resolveValue(
    value: unknown,
    context: AutomationVariableContext,
    references: { count: number },
    path: string,
  ): unknown {
    if (typeof value === 'string') return this.resolveString(value, context, references, path);
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        this.resolveValue(item, context, references, `${path}[${index}]`),
      );
    }
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = this.resolveValue(child, context, references, `${path}.${key}`);
    }
    return output;
  }

  private resolveString(
    value: string,
    context: AutomationVariableContext,
    references: { count: number },
    path: string,
  ) {
    const full = value.match(fullReferencePattern);
    if (full?.[1]) {
      references.count += 1;
      this.assertReferenceLimit(references.count);
      return this.resolvePath(full[1].trim(), context);
    }
    return value.replace(referencePattern, (_match, rawPath: string) => {
      references.count += 1;
      this.assertReferenceLimit(references.count);
      const resolved = this.resolvePath(rawPath.trim(), context);
      if (!isScalar(resolved)) {
        throw automationVariableError(
          AUTOMATION_VARIABLE_INVALID,
          `${path} cannot interpolate a non-scalar variable.`,
        );
      }
      const text = String(resolved);
      if (text.length > maxResolvedStringLength) {
        throw automationVariableError(AUTOMATION_VARIABLE_INVALID, `${path} is too large.`);
      }
      return text;
    });
  }

  private validatePath(path: string) {
    if (path.length === 0 || path.length > maxPathLength) {
      throw automationVariableError(AUTOMATION_VARIABLE_INVALID, 'Variable path is invalid.');
    }
    if (/[()[\]+*/\\'"`]/.test(path)) {
      throw automationVariableError(
        AUTOMATION_VARIABLE_INVALID,
        'Variable expressions are invalid.',
      );
    }
    const segments = path.split('.');
    const root = segments[0];
    if (segments.length < 2 || segments.length > maxSegments || !root || !allowedRoots.has(root)) {
      throw automationVariableError(AUTOMATION_VARIABLE_INVALID, 'Variable path is not supported.');
    }
    for (const segment of segments) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(segment) || dangerousSegments.has(segment)) {
        throw automationVariableError(AUTOMATION_VARIABLE_INVALID, 'Variable path is not safe.');
      }
    }
  }

  private traverse(path: string, context: AutomationVariableContext) {
    const segments = path.split('.');
    let current: unknown = context;
    for (const segment of segments) {
      if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
        return { exists: false as const, value: undefined };
      }
      current = current[segment];
    }
    return { exists: true as const, value: current };
  }

  private assertReferenceLimit(count: number) {
    if (count > maxReferences) {
      throw automationVariableError(AUTOMATION_VARIABLE_INVALID, 'Too many variable references.');
    }
  }
}

export function automationVariableError(code: string, message: string) {
  return new BadRequestException({ code, message });
}

export function isFullVariableReference(value: unknown): value is string {
  return typeof value === 'string' && fullReferencePattern.test(value);
}

export function variablePathsInValue(value: unknown) {
  const paths: string[] = [];
  collectVariablePaths(value, paths);
  return paths;
}

function collectVariablePaths(value: unknown, paths: string[]) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(referencePattern)) {
      if (match[1]) paths.push(match[1].trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectVariablePaths(item, paths));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.values(value).forEach((child) => collectVariablePaths(child, paths));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value: unknown) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
