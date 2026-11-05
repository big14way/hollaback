import type { Config } from "../config.js";
import { MemoryStore } from "./memory.js";
import { SupabaseStore } from "./supabase.js";
import type { Store } from "./types.js";

export function createStore(config: Config): Store {
  if (config.supabase.url && config.supabase.serviceRoleKey) {
    return new SupabaseStore(config.supabase.url, config.supabase.serviceRoleKey);
  }
  return new MemoryStore();
}

export * from "./types.js";
export { MemoryStore } from "./memory.js";
