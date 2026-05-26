export const WORKSPACE_RUN_UPDATED_EVENT = 'stitchly:workspace-run-updated';

export function emitWorkspaceRunUpdated(workspaceId, run) {
  if (typeof window === 'undefined' || !workspaceId || !run?.run_id) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(WORKSPACE_RUN_UPDATED_EVENT, {
      detail: {
        run,
        workspaceId
      }
    })
  );
}

export function extractWorkspaceRunUpdate(event, workspaceId) {
  if (!event || !workspaceId) {
    return null;
  }

  const detail = event.detail ?? null;
  if (!detail || detail.workspaceId !== workspaceId || !detail.run?.run_id) {
    return null;
  }

  return detail.run;
}
