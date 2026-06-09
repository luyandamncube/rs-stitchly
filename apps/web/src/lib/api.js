import connectionFixture from '../../../../tests/fixtures/api/connections.json';
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import starterWorkflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import { nextWorkflowId } from './workflowTemplates';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const DEV_SESSION_STORAGE_KEY = 'stitchly.dev-api.session.v1';
const DEV_WORKSPACE_STORAGE_KEY = 'stitchly.dev-api.workspaces.v1';
const DEV_WORKFLOW_STORAGE_KEY = 'stitchly.dev-api.workflows.v1';
const DEV_WORKFLOW_STATE_STORAGE_KEY = 'stitchly.dev-api.workflow-state.v1';
const DEV_DEFAULT_WORKSPACE_NAME = 'Default Workspace';
const DEV_WORKSPACE_ROLE = 'owner';
const LEGACY_DEV_WORKSPACE_ID = 'ws_default';
const DEV_SESSION_USER = {
  user_id: 'usr_builder',
  email: 'builder@stitchly.dev',
  display_name: 'Builder'
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
  const workspaceMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
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
    const session = ensureDevAuthenticatedSession(readDevSession());
    writeDevSession(session);
    return session;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    writeDevSession(DEV_UNAUTHENTICATED_SESSION);
    return DEV_UNAUTHENTICATED_SESSION;
  }

  if (pathname === '/api/workspaces' && method === 'GET') {
    const session = readDevSession();
    return {
      workspaces: session.workspaces,
      active_workspace_id: session.active_workspace_id
    };
  }

  if (pathname === '/api/workspaces' && method === 'POST') {
    const session = ensureDevAuthenticatedSession(readDevSession());
    const body = parseDevJsonBody(options.body);
    const workspaces = readDevWorkspaces(session.workspaces);
    const workspace = buildDevWorkspace(body.name, workspaces);
    const nextWorkspaces = [...workspaces, workspace];
    writeDevWorkspaces(nextWorkspaces);
    writeDevSession({
      ...session,
      active_workspace_id: workspace.workspace_id,
      workspaces: nextWorkspaces
    });
    return { workspace };
  }

  if (workspaceMatch && method === 'DELETE') {
    const session = ensureDevAuthenticatedSession(readDevSession());
    const workspaceId = workspaceMatch[1];
    const nextWorkspaces = session.workspaces.filter(
      (workspace) => workspace.workspace_id !== workspaceId
    );
    const nextActiveWorkspaceId = nextWorkspaces.find(
      (workspace) => workspace.workspace_id === session.active_workspace_id
    )
      ? session.active_workspace_id
      : nextWorkspaces[0]?.workspace_id ?? null;

    writeDevWorkspaces(nextWorkspaces);
    deleteDevWorkflowStoreEntry(workspaceId);
    deleteDevWorkflowStateEntry(workspaceId);
    writeDevSession({
      ...session,
      active_workspace_id: nextActiveWorkspaceId,
      workspaces: nextWorkspaces
    });
    return { workspace_id: workspaceId, deleted: true };
  }

  if (workflowsMatch && method === 'GET') {
    const workspaceId = workflowsMatch[1];
    return {
      workflows: readDevWorkflows(workspaceId).map((workflow) =>
        buildDevWorkflowSummary(workspaceId, workflow)
      )
    };
  }

  if (workflowsMatch && method === 'POST') {
    const workspaceId = workflowsMatch[1];
    const body = parseDevJsonBody(options.body);
    const workflow = normalizeDevWorkflowDefinition(
      body.workflow ?? {
        ...structuredClone(starterWorkflowFixture),
        workflow_id: nextWorkflowId(),
        name: 'New Workflow'
      }
    );
    const workflows = [...readDevWorkflows(workspaceId), workflow];
    writeDevWorkflows(workspaceId, workflows);
    writeDevWorkflowState(workspaceId, workflow.workflow_id);
    return buildDevWorkflowResponse(workspaceId, workflow);
  }

  if (workflowMatch && method === 'GET') {
    const workspaceId = workflowMatch[1];
    const workflowId = workflowMatch[2];
    const workflow = readDevWorkflows(workspaceId).find(
      (candidate) => candidate.workflow_id === workflowId
    );
    if (!workflow) {
      throw buildDevApiError(
        404,
        `Workflow \`${workflowId}\` was not found in workspace \`${workspaceId}\`.`
      );
    }

    return buildDevWorkflowResponse(workspaceId, workflow);
  }

  if (workflowMatch && method === 'PUT') {
    const workspaceId = workflowMatch[1];
    const workflowId = workflowMatch[2];
    const body = parseDevJsonBody(options.body);
    const currentWorkflows = readDevWorkflows(workspaceId);
    const workflowExists = currentWorkflows.some(
      (workflow) => workflow.workflow_id === workflowId
    );
    const nextWorkflow = body.workflow
      ? normalizeDevWorkflowDefinition(body.workflow)
      : null;
    const workflows = currentWorkflows.map((workflow) =>
      workflow.workflow_id === workflowId && nextWorkflow ? nextWorkflow : workflow
    );
    const persistedWorkflow =
      workflows.find((workflow) => workflow.workflow_id === workflowId) ??
      (workflowExists ? nextWorkflow : null);

    if (!persistedWorkflow) {
      throw buildDevApiError(
        404,
        `Workflow \`${workflowId}\` was not found in workspace \`${workspaceId}\`.`
      );
    }

    writeDevWorkflows(workspaceId, workflows);
    return buildDevWorkflowResponse(workspaceId, persistedWorkflow);
  }

  if (workflowMatch && method === 'DELETE') {
    const workspaceId = workflowMatch[1];
    const workflowId = workflowMatch[2];
    writeDevWorkflows(
      workspaceId,
      readDevWorkflows(workspaceId).filter((workflow) => workflow.workflow_id !== workflowId)
    );
    const activeWorkflowId = readDevWorkflowState(workspaceId);
    if (activeWorkflowId === workflowId) {
      writeDevWorkflowState(workspaceId, readDevWorkflows(workspaceId)[0]?.workflow_id ?? null);
    }
    return { workflow_id: workflowId, deleted: true };
  }

  if (workflowStateMatch && method === 'GET') {
    return {
      last_opened_workflow_id: readDevWorkflowState(workflowStateMatch[1])
    };
  }

  if (workflowStateMatch && method === 'PUT') {
    const body = parseDevJsonBody(options.body);
    writeDevWorkflowState(
      workflowStateMatch[1],
      body.last_opened_workflow_id ?? null
    );
    return body;
  }

  if (connectionsMatch && method === 'GET') {
    return { connections: [] };
  }

  if (catalogMatch && method === 'GET') {
    return { catalogs: [buildDevCatalog(catalogMatch[1])] };
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
    const parsedSession = rawSession ? JSON.parse(rawSession) : DEV_UNAUTHENTICATED_SESSION;
    if (!parsedSession?.authenticated) {
      return DEV_UNAUTHENTICATED_SESSION;
    }

    const session = ensureDevAuthenticatedSession(parsedSession);
    if (JSON.stringify(session) !== JSON.stringify(parsedSession)) {
      writeDevSession(session);
    }

    return session;
  } catch {
    return DEV_UNAUTHENTICATED_SESSION;
  }
}

function writeDevSession(session) {
  window.localStorage.setItem(DEV_SESSION_STORAGE_KEY, JSON.stringify(session));
}

function readDevWorkspaces(seedWorkspaces = []) {
  try {
    const rawWorkspaces = window.localStorage.getItem(DEV_WORKSPACE_STORAGE_KEY);
    const parsedWorkspaces = rawWorkspaces ? JSON.parse(rawWorkspaces) : seedWorkspaces;
    const workspaces = normalizeDevWorkspaces(parsedWorkspaces);
    if (JSON.stringify(workspaces) !== rawWorkspaces) {
      writeDevWorkspaces(workspaces);
    }
    return workspaces;
  } catch {
    return normalizeDevWorkspaces(seedWorkspaces);
  }
}

function writeDevWorkspaces(workspaces) {
  window.localStorage.setItem(DEV_WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces));
}

function readDevWorkflows(workspaceId) {
  const workflowStore = readDevWorkflowStore();
  return Array.isArray(workflowStore[workspaceId]) ? workflowStore[workspaceId] : [];
}

function writeDevWorkflows(workspaceId, workflows) {
  const workflowStore = readDevWorkflowStore();
  workflowStore[workspaceId] = workflows.map((workflow) =>
    normalizeDevWorkflowDefinition(workflow)
  );
  writeDevWorkflowStore(workflowStore);
}

function readDevWorkflowState(workspaceId) {
  const workflowStateStore = readDevWorkflowStateStore();
  const workflowId = workflowStateStore[workspaceId] ?? null;
  const workflows = readDevWorkflows(workspaceId);

  if (workflowId && workflows.some((workflow) => workflow.workflow_id === workflowId)) {
    return workflowId;
  }

  return workflows[0]?.workflow_id ?? null;
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

function writeDevWorkflowState(workspaceId, workflowId) {
  const workflowStateStore = readDevWorkflowStateStore();
  if (workflowId) {
    workflowStateStore[workspaceId] = workflowId;
  } else {
    delete workflowStateStore[workspaceId];
  }
  writeDevWorkflowStateStore(workflowStateStore);
}

function readDevWorkflowStore() {
  const workspaces = readDevWorkspaces();

  try {
    const rawWorkflowStore = window.localStorage.getItem(DEV_WORKFLOW_STORAGE_KEY);
    const parsedWorkflowStore = rawWorkflowStore ? JSON.parse(rawWorkflowStore) : {};
    const workflowStore = normalizeDevWorkflowStore(parsedWorkflowStore, workspaces);
    if (JSON.stringify(workflowStore) !== rawWorkflowStore) {
      writeDevWorkflowStore(workflowStore);
    }
    return workflowStore;
  } catch {
    return normalizeDevWorkflowStore({}, workspaces);
  }
}

function writeDevWorkflowStore(workflowStore) {
  window.localStorage.setItem(DEV_WORKFLOW_STORAGE_KEY, JSON.stringify(workflowStore));
}

function deleteDevWorkflowStoreEntry(workspaceId) {
  const workflowStore = readDevWorkflowStore();
  delete workflowStore[workspaceId];
  writeDevWorkflowStore(workflowStore);
}

function readDevWorkflowStateStore() {
  try {
    const rawWorkflowStateStore = window.localStorage.getItem(DEV_WORKFLOW_STATE_STORAGE_KEY);
    const parsedWorkflowStateStore = rawWorkflowStateStore
      ? JSON.parse(rawWorkflowStateStore)
      : {};
    const workflowStateStore =
      parsedWorkflowStateStore && typeof parsedWorkflowStateStore === 'object'
        ? parsedWorkflowStateStore
        : {};
    if (JSON.stringify(workflowStateStore) !== rawWorkflowStateStore) {
      writeDevWorkflowStateStore(workflowStateStore);
    }
    return workflowStateStore;
  } catch {
    return {};
  }
}

function writeDevWorkflowStateStore(workflowStateStore) {
  window.localStorage.setItem(
    DEV_WORKFLOW_STATE_STORAGE_KEY,
    JSON.stringify(workflowStateStore)
  );
}

function deleteDevWorkflowStateEntry(workspaceId) {
  const workflowStateStore = readDevWorkflowStateStore();
  delete workflowStateStore[workspaceId];
  writeDevWorkflowStateStore(workflowStateStore);
}

function ensureDevAuthenticatedSession(session = DEV_UNAUTHENTICATED_SESSION) {
  const workspaces = readDevWorkspaces(session.workspaces);
  const nextWorkspaces =
    workspaces.length > 0 ? workspaces : [buildDevWorkspace(DEV_DEFAULT_WORKSPACE_NAME)];
  if (nextWorkspaces.length !== workspaces.length) {
    writeDevWorkspaces(nextWorkspaces);
  }

  return {
    authenticated: true,
    active_workspace_id: resolveDevActiveWorkspaceId(
      session.active_workspace_id,
      nextWorkspaces
    ),
    user: session.user ?? DEV_SESSION_USER,
    workspaces: nextWorkspaces
  };
}

function resolveDevActiveWorkspaceId(activeWorkspaceId, workspaces) {
  if (workspaces.some((workspace) => workspace.workspace_id === activeWorkspaceId)) {
    return activeWorkspaceId;
  }

  return workspaces[0]?.workspace_id ?? null;
}

function normalizeDevWorkspaces(workspaces) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return [];
  }

  const normalizedWorkspaces = [];
  const takenSlugs = new Set();
  const takenWorkspaceIds = new Set();

  workspaces.forEach((workspace) => {
    const name =
      typeof workspace?.name === 'string' && workspace.name.trim()
        ? workspace.name.trim()
        : 'Workspace';
    let workspaceId =
      typeof workspace?.workspace_id === 'string' ? workspace.workspace_id.trim() : '';
    if (!workspaceId || workspaceId === LEGACY_DEV_WORKSPACE_ID || takenWorkspaceIds.has(workspaceId)) {
      workspaceId = nextDevWorkspaceId();
    }

    const preferredSlug =
      typeof workspace?.slug === 'string' && workspace.slug.trim()
        ? workspace.slug.trim()
        : slugifyWorkspaceName(name);
    const slug = uniqueDevWorkspaceSlug(preferredSlug, takenSlugs);

    takenWorkspaceIds.add(workspaceId);
    takenSlugs.add(slug);
    normalizedWorkspaces.push({
      workspace_id: workspaceId,
      slug,
      name,
      role: workspace?.role ?? DEV_WORKSPACE_ROLE
    });
  });

  return normalizedWorkspaces;
}

function buildDevWorkspace(name, existingWorkspaces = []) {
  const normalizedName =
    typeof name === 'string' && name.trim() ? name.trim() : DEV_DEFAULT_WORKSPACE_NAME;
  const slug = uniqueDevWorkspaceSlug(
    slugifyWorkspaceName(normalizedName),
    new Set(existingWorkspaces.map((workspace) => workspace.slug))
  );

  return {
    workspace_id: nextDevWorkspaceId(),
    slug,
    name: normalizedName,
    role: DEV_WORKSPACE_ROLE
  };
}

function nextDevWorkspaceId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `ws_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
  }

  return `ws_${nextWorkflowId().toLowerCase()}`;
}

function slugifyWorkspaceName(name) {
  let slug = '';
  let lastWasDash = false;

  for (const character of String(name ?? '').trim()) {
    const lowered = character.toLowerCase();
    if (/[a-z0-9]/.test(lowered)) {
      slug += lowered;
      lastWasDash = false;
    } else if (!lastWasDash) {
      slug += '-';
      lastWasDash = true;
    }
  }

  const trimmedSlug = slug.replace(/^-+|-+$/g, '');
  return trimmedSlug || 'workspace';
}

function uniqueDevWorkspaceSlug(baseSlug, takenSlugs) {
  let candidate = baseSlug || 'workspace';
  let index = 2;

  while (takenSlugs.has(candidate)) {
    candidate = `${baseSlug}-${index}`;
    index += 1;
  }

  return candidate;
}

function normalizeDevWorkflowStore(workflowStore, workspaces) {
  const nextWorkflowStore = {};

  const sourceStore =
    Array.isArray(workflowStore) && workspaces[0]
      ? { [workspaces[0].workspace_id]: workflowStore }
      : workflowStore && typeof workflowStore === 'object'
        ? workflowStore
        : {};

  workspaces.forEach((workspace) => {
    nextWorkflowStore[workspace.workspace_id] = Array.isArray(sourceStore[workspace.workspace_id])
      ? sourceStore[workspace.workspace_id].map((workflow) =>
          normalizeDevWorkflowDefinition(workflow)
        )
      : [];
  });

  return nextWorkflowStore;
}

function normalizeDevWorkflowDefinition(workflow) {
  const nextWorkflow =
    workflow && typeof workflow === 'object'
      ? structuredClone(workflow)
      : structuredClone(starterWorkflowFixture);

  if (!nextWorkflow.workflow_id) {
    nextWorkflow.workflow_id = nextWorkflowId();
  }

  if (!nextWorkflow.name || !String(nextWorkflow.name).trim()) {
    nextWorkflow.name = 'Untitled Workflow';
  }

  if (!Number.isFinite(nextWorkflow.version)) {
    nextWorkflow.version = 1;
  }

  if (!Array.isArray(nextWorkflow.nodes)) {
    nextWorkflow.nodes = [];
  }

  if (!Array.isArray(nextWorkflow.edges)) {
    nextWorkflow.edges = [];
  }

  return nextWorkflow;
}

function buildDevWorkflowSummary(workspaceId, workflow) {
  return {
    workflow_id: workflow.workflow_id,
    workspace_id: workspaceId,
    name: workflow.name,
    description: workflow.description ?? null,
    version: workflow.version,
    updated_at: new Date().toISOString()
  };
}

function buildDevWorkflowResponse(workspaceId, workflow) {
  const definition = normalizeDevWorkflowDefinition(workflow);
  return {
    workflow: buildDevWorkflowSummary(workspaceId, definition),
    definition
  };
}

function buildDevApiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function buildDevCatalog(workspaceId) {
  const workspaces = readDevWorkspaces();
  const workspace =
    workspaces.find((candidate) => candidate.workspace_id === workspaceId) ??
    workspaces[0] ??
    buildDevWorkspace(DEV_DEFAULT_WORKSPACE_NAME);
  const workflow = readDevWorkflows(workspace.workspace_id)[0] ?? starterWorkflowFixture;

  return {
    workspace_id: workspace.workspace_id,
    workspace_slug: workspace.slug,
    workspace_name: workspace.name,
    workflow_id: workflow.workflow_id,
    workflow_name: workflow.name,
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
