import {
  isContractOutQueueBadgeLabel,
  normalizeQueueBadgeLabel,
} from "@/lib/contractOutQueueBadge";
import { isContractSignedQueueBadgeLabel } from "@/lib/contractSignedQueueBadge";

function compactKey(value: string): string {
  return normalizeQueueBadgeLabel(value).replace(/\s+/g, "");
}

/**
 * Deal pipeline CURRENT STATE column — never show generic "Contracted";
 * use Contract Out vs Contract Signed from queue/state (matches Cases list).
 */
export function formatDealPipelineCurrentStateLabel(app: {
  currentQueue?: string | null;
  queue?: string | null;
  currentState?: string | null;
  state?: string | null;
}): string {
  const queue = String(app.currentQueue ?? app.queue ?? "").trim();
  const state = String(app.currentState ?? app.state ?? "").trim();

  const queueCompact = compactKey(queue);
  const stateCompact = compactKey(state);

  if (
    queueCompact === "contractpending" ||
    stateCompact === "contractpending" ||
    state === "Contract_Pending" ||
    state === "CONTRACT_PENDING"
  ) {
    return "Contract Pending";
  }

  if (
    queueCompact === "contractgenerated" ||
    stateCompact === "contractgenerated" ||
    state === "Contract_Generated" ||
    state === "CONTRACT_GENERATED"
  ) {
    return "Contract Generated";
  }

  if (isContractSignedQueueBadgeLabel(queue) || isContractSignedQueueBadgeLabel(state)) {
    return "Contract Signed";
  }

  if (
    stateCompact === "signedcontracts" ||
    stateCompact === "contractsigned" ||
    state === "Signed_Contracts"
  ) {
    return "Contract Signed";
  }

  if (isContractOutQueueBadgeLabel(queue) || isContractOutQueueBadgeLabel(state)) {
    return "Contract Out";
  }

  if (
    queueCompact === "contracted" ||
    stateCompact === "contractsout" ||
    stateCompact === "contractout" ||
    state === "CONTRACTS_OUT" ||
    state === "Contracts_Out"
  ) {
    return "Contract Out";
  }

  const raw = state || queue;
  if (!raw) return "—";
  if (compactKey(raw) === "contracted") return "Contract Out";

  return raw;
}
