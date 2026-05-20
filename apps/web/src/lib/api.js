const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

function buildUrl(pathname) {
  if (!API_BASE_URL) {
    return pathname;
  }

  return new URL(pathname, API_BASE_URL).toString();
}

async function request(pathname, options = {}) {
  const response = await fetch(buildUrl(pathname), {
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? `Request failed with status ${response.status}`);
    error.payload = payload;
    throw error;
  }

  return payload;
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
  const source = new EventSource(buildUrl(`/api/runs/${runId}/events`));
  source.addEventListener('run_event', (event) => {
    onEvent(JSON.parse(event.data));
  });
  source.onerror = (event) => {
    onError?.(event);
  };

  return () => source.close();
}

