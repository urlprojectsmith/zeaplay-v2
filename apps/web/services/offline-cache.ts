import { ApiClientError } from '../../../packages/api-client/src';
import {
  OFFLINE_DATABASE_NAME,
  OFFLINE_RECORD_STORE,
  OFFLINE_SCHEMA_VERSION,
  isTenantStatusCacheAllowed,
  offlinePolicies,
  sanitizeOfflineData,
  stableOfflineQueryKey,
  type OfflineContext,
  type OfflineResourceType,
  type OfflineScopeType,
} from './offline-cache-policy';

export interface OfflineRecord<T = unknown> {
  key: string;
  schemaVersion: number;
  userId: string;
  scopeType: OfflineScopeType;
  scopeId: string;
  resourceType: OfflineResourceType;
  resourceId: string;
  queryKey: string;
  cachedAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  sourceUpdatedAt: string | null;
  data: T;
}

export interface OfflineResultMeta {
  offline: true;
  cachedAt: number;
  expiresAt: number;
  resourceType: OfflineResourceType;
}

type CacheBackend = {
  get<T>(key: string): Promise<OfflineRecord<T> | null>;
  put<T>(record: OfflineRecord<T>): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<OfflineRecord[]>;
  clear(): Promise<void>;
};

const resultMeta = new WeakMap<object, OfflineResultMeta>();
const broadcastName = 'zea-play-offline-cache';
let activeContext: OfflineContext | null = null;
let backend: CacheBackend | null = null;

export function setOfflineSessionContext(context: OfflineContext | null) {
  activeContext = context;
}

export function getOfflineSessionContext() {
  return activeContext;
}

export async function cacheOfflineRead<T>(options: {
  resourceType: OfflineResourceType;
  resourceId?: string;
  queryKey?: unknown;
  request: () => Promise<T>;
}): Promise<T> {
  const context = activeContext;
  const policy = offlinePolicies[options.resourceType];
  const resourceId = normalizeIdentifier(options.resourceId ?? 'list');
  const queryKey = stableOfflineQueryKey(options.queryKey ?? {});

  try {
    const data = await options.request();
    if (context && canUsePrivateOfflineContext(context, policy.scopeType)) {
      const sanitized = sanitizeOfflineData(options.resourceType, data) as T;
      await putOfflineRecord({
        context,
        resourceType: options.resourceType,
        resourceId,
        queryKey,
        data: sanitized,
      });
    }
    return data;
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 401 || error.status === 403) {
        if (context) await deleteOfflineScope(context.scopeType, context.scopeId, context.userId);
      }
      if (error.status === 404 && context) {
        await deleteOfflineRecord(context, options.resourceType, resourceId, queryKey);
      }
      throw error;
    }
    if (!isLikelyOfflineError(error)) throw error;
    const cached = context
      ? await getOfflineRecord<T>(context, options.resourceType, resourceId, queryKey)
      : null;
    if (!cached) throw error;
    return markOfflineResult(cached.data, {
      offline: true,
      cachedAt: cached.cachedAt,
      expiresAt: cached.expiresAt,
      resourceType: options.resourceType,
    });
  }
}

export async function putOfflineRecord<T>(options: {
  context: OfflineContext;
  resourceType: OfflineResourceType;
  resourceId: string;
  queryKey: string;
  data: T;
}) {
  const policy = offlinePolicies[options.resourceType];
  if (!canUsePrivateOfflineContext(options.context, policy.scopeType)) return;
  const now = Date.now();
  const record: OfflineRecord<T> = {
    key: recordKey(options.context, options.resourceType, options.resourceId, options.queryKey),
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    userId: options.context.userId,
    scopeType: options.context.scopeType,
    scopeId: options.context.scopeId,
    resourceType: options.resourceType,
    resourceId: normalizeIdentifier(options.resourceId),
    queryKey: options.queryKey,
    cachedAt: now,
    expiresAt: now + policy.ttlMs,
    lastAccessedAt: now,
    sourceUpdatedAt: sourceUpdatedAt(options.data),
    data: jsonClone(options.data),
  };
  try {
    const store = await getBackend();
    await store.put(record);
    await pruneOfflineRecords(options.context.userId);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Offline cache write skipped', safeDiagnostic(error));
    }
  }
}

export async function getOfflineRecord<T>(
  context: OfflineContext,
  resourceType: OfflineResourceType,
  resourceId: string,
  queryKey: string,
) {
  const policy = offlinePolicies[resourceType];
  if (!canUsePrivateOfflineContext(context, policy.scopeType)) return null;
  const store = await getBackend();
  const record = await store.get<T>(recordKey(context, resourceType, resourceId, queryKey));
  if (!record || record.schemaVersion !== OFFLINE_SCHEMA_VERSION) return null;
  if (record.userId !== context.userId || record.scopeId !== context.scopeId) return null;
  if (Date.now() > record.cachedAt + policy.maxStaleMs) {
    await store.delete(record.key);
    return null;
  }
  record.lastAccessedAt = Date.now();
  await store.put(record);
  return record;
}

export async function deleteOfflineRecord(
  context: OfflineContext,
  resourceType: OfflineResourceType,
  resourceId = 'list',
  queryKey = stableOfflineQueryKey({}),
) {
  const store = await getBackend();
  await store.delete(recordKey(context, resourceType, resourceId, queryKey));
}

export async function deleteOfflineUser(userId: string) {
  const store = await getBackend();
  const records = await store.list();
  await Promise.all(
    records.filter((record) => record.userId === userId).map((record) => store.delete(record.key)),
  );
  broadcastOfflineEvent({ type: 'user-cleared', userId });
}

export async function deleteOfflineScope(
  scopeType: OfflineScopeType,
  scopeId: string,
  userId = activeContext?.userId,
) {
  if (!userId) return;
  const store = await getBackend();
  const records = await store.list();
  await Promise.all(
    records
      .filter(
        (record) =>
          record.userId === userId && record.scopeType === scopeType && record.scopeId === scopeId,
      )
      .map((record) => store.delete(record.key)),
  );
}

export async function invalidateWorkspaceOfflineCache(workspaceId: string) {
  await deleteOfflineScope('WORKSPACE', workspaceId);
}

export async function pruneOfflineRecords(userId = activeContext?.userId ?? null) {
  const store = await getBackend();
  const records = await store.list();
  const now = Date.now();
  await Promise.all(
    records
      .filter(
        (record) =>
          record.schemaVersion !== OFFLINE_SCHEMA_VERSION ||
          record.expiresAt < now ||
          (userId && record.userId !== userId && now - record.lastAccessedAt > 60 * 60_000),
      )
      .map((record) => store.delete(record.key)),
  );
  const current = (await store.list()).filter((record) => !userId || record.userId === userId);
  for (const policy of Object.values(offlinePolicies)) {
    const policyRecords = current
      .filter((record) => record.resourceType === policy.resourceType)
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
    await Promise.all(
      policyRecords.slice(policy.maxRecords).map((record) => store.delete(record.key)),
    );
  }
}

export function getOfflineResultMeta(value: unknown) {
  return value && typeof value === 'object' ? resultMeta.get(value) : undefined;
}

export function assertOnlineMutationAllowed() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error("You're offline. Reconnect to make changes.");
  }
}

export function subscribeOfflineCacheEvents(onEvent: () => void) {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(broadcastName);
  channel.addEventListener('message', onEvent);
  return () => channel.close();
}

export async function storageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  return navigator.storage.estimate();
}

function canUsePrivateOfflineContext(context: OfflineContext, expectedScopeType: OfflineScopeType) {
  return (
    context.accessTokenPresent &&
    Boolean(context.userId) &&
    context.scopeType === expectedScopeType &&
    Boolean(context.scopeId) &&
    isTenantStatusCacheAllowed(context.tenantStatus)
  );
}

function markOfflineResult<T>(data: T, meta: OfflineResultMeta): T {
  if (data && typeof data === 'object') {
    resultMeta.set(data as object, meta);
  }
  return data;
}

function recordKey(
  context: OfflineContext,
  resourceType: OfflineResourceType,
  resourceId: string,
  queryKey: string,
) {
  return [
    OFFLINE_SCHEMA_VERSION,
    normalizeIdentifier(context.userId),
    context.scopeType,
    normalizeIdentifier(context.scopeId),
    resourceType,
    normalizeIdentifier(resourceId),
    hashKey(queryKey),
  ].join('|');
}

function normalizeIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 160) || 'none';
}

function hashKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function sourceUpdatedAt(data: unknown): string | null {
  if (data && typeof data === 'object' && 'updatedAt' in data) {
    const value = (data as { updatedAt?: unknown }).updatedAt;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function isLikelyOfflineError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return error instanceof TypeError;
}

function safeDiagnostic(error: unknown) {
  if (error instanceof Error) return error.name;
  return typeof error;
}

function broadcastOfflineEvent(message: Record<string, unknown>) {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(broadcastName);
  channel.postMessage(message);
  channel.close();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getBackend() {
  backend ??= typeof indexedDB === 'undefined' ? new MemoryBackend() : new IndexedDbBackend();
  return Promise.resolve(backend);
}

class MemoryBackend implements CacheBackend {
  private readonly records = new Map<string, OfflineRecord>();

  get<T>(key: string) {
    return Promise.resolve((this.records.get(key) as OfflineRecord<T> | undefined) ?? null);
  }

  put<T>(record: OfflineRecord<T>) {
    this.records.set(record.key, record as OfflineRecord);
    return Promise.resolve();
  }

  delete(key: string) {
    this.records.delete(key);
    return Promise.resolve();
  }

  list() {
    return Promise.resolve([...this.records.values()]);
  }

  clear() {
    this.records.clear();
    return Promise.resolve();
  }
}

class IndexedDbBackend implements CacheBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async get<T>(key: string) {
    const db = await this.open();
    return new Promise<OfflineRecord<T> | null>((resolve, reject) => {
      const request = db
        .transaction(OFFLINE_RECORD_STORE, 'readonly')
        .objectStore(OFFLINE_RECORD_STORE)
        .get(key);
      request.onsuccess = () => resolve((request.result as OfflineRecord<T> | undefined) ?? null);
      request.onerror = () => reject(asError(request.error));
    });
  }

  async put<T>(record: OfflineRecord<T>) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(OFFLINE_RECORD_STORE, 'readwrite')
        .objectStore(OFFLINE_RECORD_STORE)
        .put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(asError(request.error));
    });
  }

  async delete(key: string) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(OFFLINE_RECORD_STORE, 'readwrite')
        .objectStore(OFFLINE_RECORD_STORE)
        .delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(asError(request.error));
    });
  }

  async list() {
    const db = await this.open();
    return new Promise<OfflineRecord[]>((resolve, reject) => {
      const request = db
        .transaction(OFFLINE_RECORD_STORE, 'readonly')
        .objectStore(OFFLINE_RECORD_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result as OfflineRecord[]);
      request.onerror = () => reject(asError(request.error));
    });
  }

  async clear() {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(OFFLINE_RECORD_STORE, 'readwrite')
        .objectStore(OFFLINE_RECORD_STORE)
        .clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(asError(request.error));
    });
  }

  private open() {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DATABASE_NAME, OFFLINE_SCHEMA_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OFFLINE_RECORD_STORE)) {
          const store = db.createObjectStore(OFFLINE_RECORD_STORE, { keyPath: 'key' });
          store.createIndex('byUser', 'userId');
          store.createIndex('byScope', ['scopeType', 'scopeId']);
          store.createIndex('byResource', 'resourceType');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(asError(request.error));
    });
    return this.dbPromise;
  }
}

function asError(value: unknown) {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  return new Error('IndexedDB request failed');
}
