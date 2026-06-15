const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

function buildUrl(pathname) {
  if (!API_BASE_URL) {
    return pathname;
  }

  return new URL(pathname, API_BASE_URL).toString();
}

async function request(pathname, options = {}) {
  const { headers: optionHeaders, ...restOptions } = options;
  const response = await fetch(buildUrl(pathname), {
    credentials: 'include',
    ...restOptions,
    headers: {
      'content-type': 'application/json',
      ...(optionHeaders ?? {})
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? `Request failed with status ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function getSession() {
  return request('/api/auth/session', {
    headers: {}
  });
}

export function login(email, password) {
  return request('/api/auth/login', {
    body: JSON.stringify({ email, password }),
    method: 'POST'
  });
}

export function loginWithGoogleCode(code) {
  return request('/api/auth/google/code', {
    body: JSON.stringify({ code }),
    headers: {
      'x-requested-with': 'XmlHttpRequest'
    },
    method: 'POST'
  });
}

export function logout() {
  return request('/api/auth/logout', {
    method: 'POST'
  });
}

export function getWorkspaces() {
  return request('/api/workspaces');
}

export function createWorkspace(name) {
  return request('/api/workspaces', {
    body: JSON.stringify({ name }),
    method: 'POST'
  });
}

export function deleteWorkspace(workspaceId) {
  return request(`/api/workspaces/${workspaceId}`, {
    method: 'DELETE'
  });
}

export function getWorkflows(workspaceId) {
  return request(`/api/workspaces/${workspaceId}/workflows`);
}

export function getWorkflow(workspaceId, workflowId) {
  return request(`/api/workspaces/${workspaceId}/workflows/${workflowId}`);
}

export function createWorkflow(workspaceId, workflow) {
  return request(`/api/workspaces/${workspaceId}/workflows`, {
    body: JSON.stringify({ workflow }),
    method: 'POST'
  });
}

export function updateWorkflow(workspaceId, workflowId, workflow) {
  return request(`/api/workspaces/${workspaceId}/workflows/${workflowId}`, {
    body: JSON.stringify({ workflow }),
    method: 'PUT'
  });
}

export function deleteWorkflow(workspaceId, workflowId) {
  return request(`/api/workspaces/${workspaceId}/workflows/${workflowId}`, {
    method: 'DELETE'
  });
}

export function getWorkflowState(workspaceId) {
  return request(`/api/workspaces/${workspaceId}/workflow-state`);
}

export function updateWorkflowState(workspaceId, lastOpenedWorkflowId) {
  return request(`/api/workspaces/${workspaceId}/workflow-state`, {
    body: JSON.stringify({ last_opened_workflow_id: lastOpenedWorkflowId }),
    method: 'PUT'
  });
}

export function getWorkspaceCatalog(workspaceId) {
  return request(`/api/workspaces/${workspaceId}/catalog`);
}

export function getWorkspaceCatalogSchema(workspaceId, _workflowId, schemaName) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/schemas/${encodeURIComponent(schemaName)}`
  );
}

export function getWorkspaceCatalogTable(workspaceId, _workflowId, schemaName, tableName) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/schemas/${encodeURIComponent(
      schemaName
    )}/tables/${encodeURIComponent(tableName)}`
  );
}

export function previewWorkspaceCatalogTableDelete(
  workspaceId,
  _workflowId,
  schemaName,
  tableName
) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/schemas/${encodeURIComponent(
      schemaName
    )}/tables/${encodeURIComponent(
      tableName
    )}/delete-preview`
  );
}

export function deleteWorkspaceCatalogTable(
  workspaceId,
  _workflowId,
  schemaName,
  tableName
) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/schemas/${encodeURIComponent(
      schemaName
    )}/tables/${encodeURIComponent(tableName)}`,
    {
      method: 'DELETE'
    }
  );
}

export function runWorkspaceCatalogQuery(workspaceId, _workflowId, query) {
  return request(`/api/workspaces/${workspaceId}/catalog/query`, {
    body: JSON.stringify({ query }),
    method: 'POST'
  });
}

export function getWorkspaceRuns(workspaceId) {
  return request(`/api/workspaces/${workspaceId}/runs`);
}

export function getWorkspaceConnections(workspaceId) {
  return request(`/api/workspaces/${workspaceId}/connections`);
}

export function connectWorkspaceGmail(workspaceId, code) {
  return request(`/api/workspaces/${workspaceId}/connections/gmail/code`, {
    body: JSON.stringify({ code }),
    headers: {
      'x-requested-with': 'XmlHttpRequest'
    },
    method: 'POST'
  });
}

export function getWorkspaceRun(workspaceId, runId) {
  return request(`/api/workspaces/${workspaceId}/runs/${runId}`);
}

export function getWorkspaceRunEvents(workspaceId, runId) {
  return request(`/api/workspaces/${workspaceId}/runs/${runId}/events`);
}

export function getWorkspaceRunLogs(workspaceId, runId) {
  return request(`/api/workspaces/${workspaceId}/runs/${runId}/logs`);
}

export function cancelWorkspaceRun(workspaceId, runId) {
  return request(`/api/workspaces/${workspaceId}/runs/${runId}/cancel`, {
    method: 'POST'
  });
}

export function createWorkspaceRun(workspaceId, workflow) {
  return request(`/api/workspaces/${workspaceId}/runs`, {
    body: JSON.stringify({
      workflow,
      trigger: { kind: 'manual' },
      params: {}
    }),
    method: 'POST'
  });
}

export function getNodeDefinitions() {
  return request('/api/node-definitions');
}

export function getConnections() {
  return request('/api/connections');
}

export function validateWorkflow(workflow) {
  return request('/api/workflows/validate', {
    body: JSON.stringify({ workflow }),
    method: 'POST'
  });
}

export function createRun(workflow) {
  return request('/api/runs', {
    body: JSON.stringify({
      workflow,
      trigger: { kind: 'manual' },
      params: {}
    }),
    method: 'POST'
  });
}

export function getRunSnapshot(runId) {
  return request(`/api/runs/${runId}`);
}

export function subscribeToRun(runId, { onEvent, onError }) {
  let closed = false;
  const source = new EventSource(buildUrl(`/api/runs/${runId}/events`));
  source.addEventListener('run_event', (event) => {
    onEvent(JSON.parse(event.data));
  });
  source.onerror = (event) => {
    if (!closed) {
      onError?.(event);
    }
  };

  return () => {
    closed = true;
    source.close();
  };
}
