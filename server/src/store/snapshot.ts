import pg from "pg";
import type { Logger } from "../abandonment.js";
import { MemoryStore, type StoreState } from "./memory.js";

/** Where the memory store's state is kept between restarts. */
export interface SnapshotBackend {
  load(): Promise<StoreState | null>;
  save(state: StoreState): Promise<void>;
  close(): Promise<void>;
}

const TABLE = "hollaback_snapshot";

/** One jsonb row per snapshot id in a Postgres table (Neon's free tier is plenty). */
export class PostgresSnapshot implements SnapshotBackend {
  private readonly pool: pg.Pool;
  private table: Promise<unknown> | null = null;

  constructor(
    connectionString: string,
    private readonly id: string,
    log: Logger,
  ) {
    this.pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
    // Neon drops idle connections; an unhandled pool error would crash the process.
    this.pool.on("error", (err) => log.warn({ err }, "Postgres snapshot connection dropped"));
  }

  private ensureTable(): Promise<unknown> {
    this.table ??= this.pool
      .query(`create table if not exists ${TABLE} (id text primary key, state jsonb not null, updated_at timestamptz not null default now())`)
      .catch((err) => {
        this.table = null;
        throw err;
      });
    return this.table;
  }

  async load(): Promise<StoreState | null> {
    await this.ensureTable();
    const res = await this.pool.query<{ state: StoreState }>(`select state from ${TABLE} where id = $1`, [this.id]);
    return res.rows[0]?.state ?? null;
  }

  async save(state: StoreState): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `insert into ${TABLE} (id, state, updated_at) values ($1, $2::jsonb, now())
       on conflict (id) do update set state = excluded.state, updated_at = excluded.updated_at`,
      [this.id, JSON.stringify(state)],
    );
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

/**
 * Saves the whole memory store after writes: the first write starts a timer and every write
 * until it fires rides along, so a burst costs one upsert and nothing waits longer than
 * `debounceMs`. Saves run one at a time, in order.
 */
export class SnapshotWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: MemoryStore,
    private readonly backend: SnapshotBackend,
    private readonly opts: { debounceMs: number; log: Logger },
  ) {}

  schedule(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.debounceMs);
    this.timer.unref?.();
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return this.saving;
    this.dirty = false;
    const state = this.store.exportState();
    this.saving = this.saving
      .then(() => this.backend.save(state))
      .catch((err) => {
        // Saved again with the next write (or at shutdown).
        this.dirty = true;
        this.opts.log.warn({ err }, "Postgres snapshot save failed");
      });
    return this.saving;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.backend.close();
  }
}

/**
 * A memory store restored from the snapshot. If the snapshot can't be read the server starts
 * empty and does not save this run, so the data already saved is never overwritten.
 */
export async function openSnapshotStore(
  backend: SnapshotBackend,
  opts: { debounceMs: number; log: Logger },
): Promise<{ store: MemoryStore; snapshot: SnapshotWriter | null }> {
  try {
    const store = new MemoryStore({ kind: "memory+postgres", state: await backend.load() });
    return { store, snapshot: new SnapshotWriter(store, backend, opts) };
  } catch (err) {
    opts.log.warn({ err }, "Postgres snapshot unavailable; starting with an empty in-memory store and not saving this run");
    await backend.close().catch(() => undefined);
    return { store: new MemoryStore(), snapshot: null };
  }
}
