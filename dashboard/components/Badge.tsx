import { OUTCOME_LABEL, STATUS_LABEL } from "@/lib/format";
import type { CartStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: CartStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: keyof typeof OUTCOME_LABEL }) {
  return <span className={`badge outcome-${outcome}`}>{OUTCOME_LABEL[outcome]}</span>;
}
