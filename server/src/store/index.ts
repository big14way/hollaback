import type { Logger } from "../abandonment.js";
import type { Config } from "../config.js";
import { MemoryStore } from "./memory.js";
import { openSnapshotStore, PostgresSnapshot, type SnapshotBackend, type SnapshotWriter } from "./snapshot.js";
import { SupabaseStore } from "./supabase.js";
import type { Store } from "./types.js";

/**
 * Supabase when configured; otherwise the memory store, kept in a Postgres snapshot when
 * DATABASE_URL is set. `snapshot` replaces the Postgres backend (tests use an in-memory fake).
 */
export async function openStore(
  config: Config,
  opts: { log: Logger; snapshot?: SnapshotBackend | null },
): Promise<{ store: Store; snapshot: SnapshotWriter | null }> {
  if (config.supabase.url && config.supabase.serviceRoleKey) {
    return { store: new SupabaseStore(config.supabase.url, config.supabase.serviceRoleKey), snapshot: null };
  }
  const backend =
    opts.snapshot !== undefined
      ? opts.snapshot
      : config.databaseUrl
        ? // One row per server URL, so a local server and the hosted one can share a database.
          new PostgresSnapshot(config.databaseUrl, config.publicUrl, opts.log)
        : null;
  if (!backend) return { store: new MemoryStore(), snapshot: null };
  return openSnapshotStore(backend, { debounceMs: config.snapshotDebounceMs, log: opts.log });
}

export * from "./types.js";
export { MemoryStore, type StoreState } from "./memory.js";
export type { SnapshotBackend } from "./snapshot.js";
