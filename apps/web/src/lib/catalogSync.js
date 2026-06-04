export const WORKSPACE_WORKFLOWS_INVALIDATED_EVENT =
  'stitchly:workspace-workflows-invalidated';

export function emitWorkspaceWorkflowsInvalidated(
  workspaceId,
  workflowIds,
  reason = 'catalog_table_deleted'
) {
  if (
    typeof window === 'undefined' ||
    !workspaceId ||
    !Array.isArray(workflowIds) ||
    !workflowIds.length
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(WORKSPACE_WORKFLOWS_INVALIDATED_EVENT, {
      detail: {
        reason,
        workflowIds,
        workspaceId
      }
    })
  );
}

export function extractWorkspaceWorkflowInvalidation(event, workspaceId) {
  if (!event || !workspaceId) {
    return null;
  }

  const detail = event.detail ?? null;
  if (
    !detail ||
    detail.workspaceId !== workspaceId ||
    !Array.isArray(detail.workflowIds) ||
    !detail.workflowIds.length
  ) {
    return null;
  }

  return detail;
}
