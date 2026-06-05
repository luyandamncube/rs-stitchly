import connectionFixture from '../../../../tests/fixtures/api/connections.json';
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import starterWorkflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import { nextWorkflowId } from './workflowTemplates';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const DEV_SESSION_STORAGE_KEY = 'stitchly.dev-api.session.v1';
const DEV_WORKFLOW_STORAGE_KEY = 'stitchly.dev-api.workflows.v1';
const DEV_WORKSPACE = {
  workspace_id: 'ws_default',
  slug: 'default-workspace',
  name: 'Default Workspace',
  role: 'owner'
};
const DEV_AUTHENTICATED_SESSION = {
  authenticated: true,
  active_workspace_id: DEV_WORKSPACE.workspace_id,
  user: {
    user_id: 'usr_builder',
    email: 'builder@stitchly.dev',
    display_name: 'Builder'
  },
  workspaces: [DEV_WORKSPACE]
};
const DEV_RUN = {
  run_id: 'run_dev_preview',
  workflow_id: starterWorkflowFixture.workflow_id,
  status: 'succeeded',
  trigger: { kind: 'manual' },
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString()
};
const DEV_UNAUTHENTICATED_SESSION = {
  authenticated: false,
  active_workspace_id: null,
  user: null,
  workspaces: []
};
let devFallbackHasHandledRequest = false;

function buildUrl(pathname) {
  if (!API_BASE_URL) {
    return pathname;
  }

  return new URL(pathname, API_BASE_URL).toString();
}

async function request(pathname, options = {}) {
  const { headers: optionHeaders, ...restOptions } = options;
  let response;

  try {
    response = await fetch(buildUrl(pathname), {
      credentials: 'include',
      ...restOptions,
      headers: {
        'content-type': 'application/json',
        ...(optionHeaders ?? {})
      },
    });
  } catch (error) {
    const fallback = getDevFallbackResponse(pathname, restOptions);
    if (fallback) {
      return fallback;
    }

    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = getDevFallbackResponse(pathname, restOptions);
    if (fallback) {
      return fallback;
    }

    const error = new Error(payload.message ?? `Request failed with status ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function canUseDevAuthFallback() {
  return isDevApiFallbackEnabled() && devFallbackHasHandledRequest;
}

export function shouldUseDevGoogleAuthFallback() {
  if (!isDevApiFallbackEnabled() || typeof window === 'undefined') {
    return false;
  }

  return import.meta.env.VITE_GOOGLE_POPUP_IN_DEV !== 'true';
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

export function getWorkspaceCatalogSchema(workspaceId, workflowId, schemaName) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/${encodeURIComponent(
      workflowId
    )}/schemas/${encodeURIComponent(schemaName)}`
  );
}

export function getWorkspaceCatalogTable(workspaceId, workflowId, schemaName, tableName) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/${encodeURIComponent(
      workflowId
    )}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(tableName)}`
  );
}

export function previewWorkspaceCatalogTableDelete(
  workspaceId,
  workflowId,
  schemaName,
  tableName
) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/${encodeURIComponent(
      workflowId
    )}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(
      tableName
    )}/delete-preview`
  );
}

export function deleteWorkspaceCatalogTable(
  workspaceId,
  workflowId,
  schemaName,
  tableName
) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/${encodeURIComponent(
      workflowId
    )}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(tableName)}`,
    {
      method: 'DELETE'
    }
  );
}

export function runWorkspaceCatalogQuery(workspaceId, workflowId, query) {
  return request(
    `/api/workspaces/${workspaceId}/catalog/${encodeURIComponent(workflowId)}/query`,
    {
      body: JSON.stringify({ query }),
      method: 'POST'
    }
  );
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

function isDevApiFallbackEnabled() {
  if (!import.meta.env.DEV || API_BASE_URL) {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function getDevFallbackResponse(pathname, options = {}) {
  if (!isDevApiFallbackEnabled()) {
    return null;
  }

  devFallbackHasHandledRequest = true;

  const method = String(options.method ?? 'GET').toUpperCase();
  const workflowMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/workflows\/([^/]+)$/);
  const workflowsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/workflows$/);
  const workflowStateMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/workflow-state$/);
  const connectionsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/connections$/);
  const catalogMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/catalog$/);
  const catalogQueryMatch = pathname.match(
    /^\/api\/workspaces\/([^/]+)\/catalog\/([^/]+)\/query$/
  );
  const runsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/runs$/);
  const runMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/runs\/([^/]+)$/);
  const runEventsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/runs\/([^/]+)\/events$/);
  const runLogsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/runs\/([^/]+)\/logs$/);

  if (pathname === '/api/auth/session' && method === 'GET') {
    return readDevSession();
  }

  if ((pathname === '/api/auth/login' || pathname === '/api/auth/google/code') && method === 'POST') {
    writeDevSession(DEV_AUTHENTICATED_SESSION);
    return DEV_AUTHENTICATED_SESSION;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    writeDevSession(DEV_UNAUTHENTICATED_SESSION);
    return DEV_UNAUTHENTICATED_SESSION;
  }

  if (pathname === '/api/workspaces' && method === 'GET') {
    return { workspaces: [DEV_WORKSPACE] };
  }

  if (workflowsMatch && method === 'GET') {
    return { workflows: readDevWorkflows() };
  }

  if (workflowsMatch && method === 'POST') {
    const body = parseDevJsonBody(options.body);
    const workflow = body.workflow ?? {
      ...structuredClone(starterWorkflowFixture),
      workflow_id: nextWorkflowId(),
      name: 'New Workflow'
    };
    const workflows = [...readDevWorkflows(), workflow];
    writeDevWorkflows(workflows);
    return { workflow };
  }

  if (workflowMatch && method === 'GET') {
    const workflow = readDevWorkflows().find(
      (candidate) => candidate.workflow_id === workflowMatch[2]
    );
    return workflow ?? readDevWorkflows()[0];
  }

  if (workflowMatch && method === 'PUT') {
    const body = parseDevJsonBody(options.body);
    const nextWorkflow = body.workflow;
    const workflows = readDevWorkflows().map((workflow) =>
      workflow.workflow_id === workflowMatch[2] && nextWorkflow ? nextWorkflow : workflow
    );
    writeDevWorkflows(workflows);
    return { workflow: nextWorkflow ?? workflows.find((workflow) => workflow.workflow_id === workflowMatch[2]) };
  }

  if (workflowMatch && method === 'DELETE') {
    writeDevWorkflows(
      readDevWorkflows().filter((workflow) => workflow.workflow_id !== workflowMatch[2])
    );
    return { workflow_id: workflowMatch[2], deleted: true };
  }

  if (workflowStateMatch && method === 'GET') {
    return { last_opened_workflow_id: readDevWorkflows()[0]?.workflow_id ?? null };
  }

  if (workflowStateMatch && method === 'PUT') {
    return parseDevJsonBody(options.body);
  }

  if (connectionsMatch && method === 'GET') {
    return { connections: [] };
  }

  if (catalogMatch && method === 'GET') {
    return { catalogs: [buildDevCatalog()] };
  }

  if (catalogQueryMatch && method === 'POST') {
    return {
      columns: [
        { name: 'run_id', data_type: 'text' },
        { name: 'status', data_type: 'text' }
      ],
      rows: [[DEV_RUN.run_id, DEV_RUN.status]]
    };
  }

  if (runsMatch && method === 'GET') {
    return { runs: [DEV_RUN] };
  }

  if (runsMatch && method === 'POST') {
    return { run: DEV_RUN };
  }

  if (runMatch && method === 'GET') {
    return { run: { ...DEV_RUN, run_id: runMatch[2] } };
  }

  if (runEventsMatch && method === 'GET') {
    return { events: [] };
  }

  if (runLogsMatch && method === 'GET') {
    return { logs: [] };
  }

  if (pathname === '/api/node-definitions' && method === 'GET') {
    return nodeDefinitionFixture;
  }

  if (pathname === '/api/connections' && method === 'GET') {
    return connectionFixture;
  }

  return null;
}

function readDevSession() {
  try {
    const rawSession = window.localStorage.getItem(DEV_SESSION_STORAGE_KEY);
    return rawSession ? JSON.parse(rawSession) : DEV_UNAUTHENTICATED_SESSION;
  } catch {
    return DEV_UNAUTHENTICATED_SESSION;
  }
}

function writeDevSession(session) {
  window.localStorage.setItem(DEV_SESSION_STORAGE_KEY, JSON.stringify(session));
}

function readDevWorkflows() {
  try {
    const rawWorkflows = window.localStorage.getItem(DEV_WORKFLOW_STORAGE_KEY);
    return rawWorkflows ? JSON.parse(rawWorkflows) : [structuredClone(starterWorkflowFixture)];
  } catch {
    return [structuredClone(starterWorkflowFixture)];
  }
}

function writeDevWorkflows(workflows) {
  window.localStorage.setItem(DEV_WORKFLOW_STORAGE_KEY, JSON.stringify(workflows));
}

function parseDevJsonBody(body) {
  if (!body || typeof body !== 'string') {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function buildDevCatalog() {
  return {
    workspace_id: DEV_WORKSPACE.workspace_id,
    workspace_slug: DEV_WORKSPACE.slug,
    workspace_name: DEV_WORKSPACE.name,
    workflow_id: starterWorkflowFixture.workflow_id,
    workflow_name: starterWorkflowFixture.name,
    database_name: 'workflow.duckdb',
    schemas: [
      {
        schema_name: 'runs',
        tables: [
          {
            table_name: 'workflow_runs',
            columns: [
              { column_name: 'run_id', data_type: 'VARCHAR' },
              { column_name: 'workflow_id', data_type: 'VARCHAR' },
              { column_name: 'status', data_type: 'VARCHAR' }
            ]
          }
        ]
      }
    ]
  };
}
