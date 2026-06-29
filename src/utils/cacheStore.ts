import * as vscode from 'vscode';

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

const CACHE_PREFIX = 'forgejo-cache-';

let _context: vscode.ExtensionContext | null = null;

export function initCacheStore(context: vscode.ExtensionContext): void {
  _context = context;
}

export function getCached<T>(key: string): T | undefined {
  if (!_context) return undefined;
  try {
    const raw = _context.globalState.get<string>(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEntry;
    return entry.data as T;
  } catch {
    return undefined;
  }
}

export function setCache<T>(key: string, data: T): void {
  if (!_context) return;
  try {
    const entry: CacheEntry = { data, timestamp: Date.now() };
    void _context.globalState.update(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // silently fail - cache is best-effort
  }
}

export function clearCache(key?: string): void {
  if (!_context) return;
  if (key) {
    void _context.globalState.update(CACHE_PREFIX + key, undefined);
  }
}
