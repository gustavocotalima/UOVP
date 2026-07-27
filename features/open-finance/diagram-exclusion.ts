export const PLUGGY_DIAGRAM_EXCLUSION_REASON = {
  USER: "Excluído pelo usuário.",
  CONNECTION_REMOVE: "Posição removida do diagrama após a desconexão da instituição.",
  CONNECTION_KEEP_MANUAL: "Posição mantida manualmente após a desconexão da instituição.",
} as const;

export function shouldReconcileExcludedPluggyPosition(link: {
  status: string;
  reviewReason: string | null;
}) {
  return link.status !== "EXCLUDED"
    || link.reviewReason === PLUGGY_DIAGRAM_EXCLUSION_REASON.CONNECTION_REMOVE;
}
