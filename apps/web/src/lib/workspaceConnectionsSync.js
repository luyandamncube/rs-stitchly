export const WORKSPACE_CONNECTIONS_UPDATED_EVENT = 'stitchly:workspace-connections-updated';

export function emitWorkspaceConnectionsUpdated(workspaceId, connection) {
  if (typeof window === 'undefined' || !workspaceId || !connection?.connection_id) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(WORKSPACE_CONNECTIONS_UPDATED_EVENT, {
      detail: {
        connection,
        workspaceId
      }
    })
  );
}

export function extractWorkspaceConnectionUpdate(event, workspaceId) {
  if (!event || !workspaceId) {
    return null;
  }

  const detail = event.detail ?? null;
  if (!detail || detail.workspaceId !== workspaceId || !detail.connection?.connection_id) {
    return null;
  }

  return detail.connection;
}
