import { useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams
} from 'react-router-dom';
import CanvasWorkspace from './components/CanvasWorkspace';
import {
  cancelWorkspaceRun,
  connectWorkspaceGmail,
  createWorkspace,
  createWorkflow,
  deleteWorkspaceCatalogTable,
  deleteWorkspace,
  deleteWorkflow,
  getSession,
  getWorkflow,
  getWorkspaceCatalog,
  getWorkspaceCatalogSchema,
  getWorkspaceCatalogTable,
  getWorkspaceConnections,
  getWorkspaceRun,
  getWorkspaceRunEvents,
  getWorkspaceRunLogs,
  getWorkflows,
  getWorkspaceRuns,
  canUseDevAuthFallback,
  login,
  loginWithGoogleCode,
  logout,
  previewWorkspaceCatalogTableDelete,
  runWorkspaceCatalogQuery,
  shouldUseDevGoogleAuthFallback,
  updateWorkflow,
  updateWorkflowState
} from './lib/api';
import { setDraggedNodeType } from './lib/canvasDnD';
import {
  buildBlankWorkflowDefinition,
  buildStarterWorkflowDefinition
} from './lib/workflowTemplates';
import { emitWorkspaceRunUpdated } from './lib/runSync';
import { emitWorkspaceWorkflowsInvalidated } from './lib/catalogSync';
import { emitWorkspaceConnectionsUpdated } from './lib/workspaceConnectionsSync';

const APP_SCREENS = [
  {
    id: 'workflows',
    icon: 'W',
    label: 'Workflows',
    description: 'Create, open, rename, and archive workflows inside the current workspace.'
  },
  {
    id: 'overview',
    icon: 'O',
    label: 'Overview',
    description: 'Launch workflows, review the product shell, and jump into the canvas.'
  },
  {
    id: 'canvas',
    icon: 'C',
    label: 'Canvas',
    description: 'The main workflow workspace with the current canvas and debug-aware shell.'
  },
  {
    id: 'runs',
    icon: 'R',
    label: 'Runs',
    description: 'Execution history, run lifecycle visibility, and operator-facing activity.'
  },
  {
    id: 'connections',
    icon: 'K',
    label: 'Connections',
    description: 'Reusable source and destination credentials, adapters, and environment bindings.'
  },
  {
    id: 'settings',
    icon: 'S',
    label: 'Settings',
    description: 'Workspace preferences, responsive mode, and shell-level product controls.'
  }
];

const SIDEBAR_SCREEN_IDS = new Set(['workflows', 'canvas', 'runs']);
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  (import.meta.env.MODE === 'test' ? 'test-google-client-id' : '');

const NODE_SHELF_GROUPS = [
  {
    id: 'trigger',
    label: 'Trigger',
    icon: 'T',
    items: [
      { typeId: 'manual_trigger', label: 'Manual Trigger', implemented: false },
      { typeId: 'schedule_trigger', label: 'Schedule Trigger', implemented: false },
      { typeId: 'event_trigger', label: 'Event Trigger', implemented: false }
    ]
  },
  {
    id: 'input',
    label: 'Input',
    icon: 'I',
    items: [
      { typeId: 'text_input', label: 'Text Input', implemented: true },
      { typeId: 'json_input', label: 'JSON Input', implemented: false },
      { typeId: 'file_input', label: 'File Input', implemented: false },
      { typeId: 'dolt_repo_source', label: 'Dolt Repo Source', implemented: true },
      { typeId: 'table_schema', label: 'Table Schema', implemented: true },
      { typeId: 'table_input', label: 'Table Input', implemented: true },
      { typeId: 'object_store_input', label: 'Object Store Input', implemented: false }
    ]
  },
  {
    id: 'compute',
    label: 'Compute',
    icon: 'C',
    items: [
      { typeId: 'checkpoint_read', label: 'Checkpoint Read', implemented: true },
      { typeId: 'dolt_repo_sync', label: 'Dolt Repo Sync', implemented: true },
      { typeId: 'dolt_change_manifest', label: 'Dolt Change Manifest', implemented: true },
      { typeId: 'api_request', label: 'API Request', implemented: false },
      { typeId: 'python_script', label: 'Python Script', implemented: false },
      { typeId: 'transform', label: 'Transform', implemented: false },
      { typeId: 'sql_transform', label: 'SQL Transform', implemented: false },
      { typeId: 'rust_native', label: 'Rust Native', implemented: false },
      { typeId: 'engine_workload', label: 'Engine Workload', implemented: false }
    ]
  },
  {
    id: 'data_movement',
    label: 'Data Movement',
    icon: 'D',
    items: [
      { typeId: 'dolt_dump', label: 'Dolt Dump', implemented: true },
      { typeId: 'dolt_diff_export', label: 'Dolt Diff Export', implemented: true },
      { typeId: 'load_to_duckdb', label: 'Load to DuckDB', implemented: true },
      { typeId: 'table_merge', label: 'Table Merge', implemented: true },
      { typeId: 'extract', label: 'Extract', implemented: false },
      { typeId: 'load', label: 'Load', implemented: false },
      { typeId: 'materialize', label: 'Materialize', implemented: false }
    ]
  },
  {
    id: 'control',
    label: 'Control',
    icon: 'F',
    items: [
      { typeId: 'quality_check', label: 'Quality Check', implemented: true },
      { typeId: 'checkpoint_write', label: 'Checkpoint Write', implemented: true },
      { typeId: 'branch', label: 'Branch', implemented: false },
      { typeId: 'merge', label: 'Merge', implemented: false },
      { typeId: 'map', label: 'Map', implemented: false },
      { typeId: 'approval_gate', label: 'Approval Gate', implemented: false },
      { typeId: 'subgraph', label: 'Subgraph', implemented: false }
    ]
  },
  {
    id: 'output',
    label: 'Output',
    icon: 'O',
    items: [
      { typeId: 'preview_output', label: 'Preview Output', implemented: false },
      { typeId: 'file_output', label: 'File Output', implemented: false },
      { typeId: 'json_output', label: 'JSON Output', implemented: false },
      { typeId: 'table_output', label: 'Table Output', implemented: true },
      { typeId: 'send_email', label: 'Send Email', implemented: true },
      { typeId: 'send_telegram', label: 'Send Telegram', implemented: false },
      { typeId: 'notification', label: 'Notification', implemented: false }
    ]
  },
  {
    id: 'system',
    label: 'System',
    icon: 'S',
    items: [
      { typeId: 'cache', label: 'Cache', implemented: false },
      { typeId: 'debug', label: 'Debug', implemented: false },
      { typeId: 'note', label: 'Note', implemented: false }
    ]
  }
];

const INTEGRATION_PLACEHOLDERS = [
  {
    kind: 'gmail',
    label: 'Gmail',
    comment: 'Connect Gmail accounts and send mail from workflow outputs.'
  },
  {
    kind: 'google_drive',
    label: 'Google Drive',
    comment: 'Browse files, drop workflow exports, and watch shared folders.'
  },
  {
    kind: 'google_calendar',
    label: 'Google Calendar',
    comment: 'Create events and sync operational schedule updates.'
  },
  {
    kind: 'instagram',
    label: 'Instagram',
    comment: 'Publish or react to campaign activity from connected workflows.'
  },
  {
    kind: 'whatsapp',
    label: 'WhatsApp',
    comment: 'Trigger operational messages and approval loops from workflows.'
  },
  {
    kind: 'twitter',
    label: 'Twitter',
    comment: 'Post updates or ingest account activity into workflow runs.'
  },
  {
    kind: 'telegram',
    label: 'Telegram',
    comment: 'Send workflow alerts and deliver bot-driven operator prompts.'
  },
  {
    kind: 'slack',
    label: 'Slack',
    comment: 'Push run notifications and route human review tasks to channels.'
  },
  {
    kind: 'outlook',
    label: 'Outlook',
    comment: 'Use Microsoft mail accounts for outbound workflow delivery.'
  },
  {
    kind: 'notion',
    label: 'Notion',
    comment: 'Write workflow summaries and sync records into shared docs.'
  }
];

function buildSchemaCatalogSelection(catalog, schema) {
  return {
    kind: 'schema',
    workspaceId: catalog.workspace_id,
    workflowId: catalog.workflow_id,
    schemaName: schema.schema_name
  };
}

function buildTableCatalogSelection(catalog, schema, table) {
  return {
    kind: 'table',
    workspaceId: catalog.workspace_id,
    workflowId: catalog.workflow_id,
    schemaName: schema.schema_name,
    tableName: table.table_name
  };
}

function findCatalogSchemaEntry(catalogs, selection) {
  if (!selection) {
    return null;
  }

  const catalog = catalogs.find(
    (entry) =>
      entry.workspace_id === selection.workspaceId &&
      entry.workflow_id === selection.workflowId
  );
  if (!catalog) {
    return null;
  }

  const schema = catalog.schemas.find((entry) => entry.schema_name === selection.schemaName);
  if (!schema) {
    return null;
  }

  return { catalog, schema };
}

function findCatalogTableEntry(catalogs, selection) {
  if (!selection || selection.kind !== 'table') {
    return null;
  }

  const schemaEntry = findCatalogSchemaEntry(catalogs, selection);
  if (!schemaEntry) {
    return null;
  }

  const table = schemaEntry.schema.tables.find(
    (entry) => entry.table_name === selection.tableName
  );
  if (!table) {
    return null;
  }

  return {
    catalog: schemaEntry.catalog,
    schema: schemaEntry.schema,
    table
  };
}

function buildDefaultCatalogSelection(catalogs) {
  let firstSchemaSelection = null;

  for (const catalog of catalogs) {
    for (const schema of catalog.schemas ?? []) {
      if (!firstSchemaSelection) {
        firstSchemaSelection = buildSchemaCatalogSelection(catalog, schema);
      }
    }
  }

  return firstSchemaSelection;
}

function resolveCatalogSelection(catalogs, selection) {
  if (!selection) {
    return buildDefaultCatalogSelection(catalogs);
  }

  if (selection.kind === 'table' && findCatalogTableEntry(catalogs, selection)) {
    return selection;
  }

  if (selection.kind === 'schema' && findCatalogSchemaEntry(catalogs, selection)) {
    return selection;
  }

  return buildDefaultCatalogSelection(catalogs);
}

function formatCatalogTableType(tableType) {
  if (tableType === 'BASE TABLE') {
    return 'Table';
  }

  if (tableType === 'VIEW') {
    return 'View';
  }

  return tableType;
}

const DATA_PANEL_EDITOR_MIN_HEIGHT = 172;
const DATA_PANEL_EDITOR_DEFAULT_HEIGHT = 224;
const DATA_PANEL_BOTTOM_MIN_HEIGHT = 236;
const DATA_PANEL_RESIZER_HEIGHT = 18;

function escapeSqlIdentifier(identifier) {
  const value = String(identifier);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function shouldSkipDefaultPreviewColumn(columnName) {
  const normalized = String(columnName).toLowerCase();
  return (
    normalized.includes('json') ||
    normalized.includes('payload') ||
    normalized.includes('snapshot') ||
    normalized.includes('error_message') ||
    normalized === 'error_category' ||
    normalized === 'created_at' ||
    normalized === 'updated_at'
  );
}

function buildDefaultTablePreviewQuery(schemaName, tableName, columns = []) {
  const previewColumns = columns.filter(
    (column) => !shouldSkipDefaultPreviewColumn(column.column_name)
  );
  const selectedColumns = previewColumns.length ? previewColumns : columns;
  const projection = selectedColumns.length
    ? selectedColumns
      .map((column) => `  ${escapeSqlIdentifier(column.column_name)}`)
      .join(',\n')
    : '  *';

  return [
    'SELECT',
    projection,
    `FROM ${escapeSqlIdentifier(schemaName)}.${escapeSqlIdentifier(tableName)}`,
    'LIMIT 1000'
  ].join('\n');
}

function buildCatalogTableSelectionKey(workspaceId, workflowId, schemaName, tableName) {
  return [workspaceId, workflowId, schemaName, tableName].join(':');
}

function resolveCanvasDataEditorMaxHeight(containerHeight) {
  if (!containerHeight) {
    return DATA_PANEL_EDITOR_DEFAULT_HEIGHT;
  }

  return Math.max(
    DATA_PANEL_EDITOR_MIN_HEIGHT,
    containerHeight - DATA_PANEL_RESIZER_HEIGHT - DATA_PANEL_BOTTOM_MIN_HEIGHT
  );
}

function clampCanvasDataEditorHeight(nextHeight, containerHeight) {
  const maxHeight = resolveCanvasDataEditorMaxHeight(containerHeight);
  return Math.min(Math.max(nextHeight, DATA_PANEL_EDITOR_MIN_HEIGHT), maxHeight);
}

function editorLineNumbers(value, minimum = 2) {
  const lineCount = Math.max(minimum, String(value ?? '').split('\n').length);
  return Array.from({ length: lineCount }, (_, index) => index + 1);
}

function decorateWorkspaceCatalog(workspace, catalog) {
  return {
    ...catalog,
    workspace_id: workspace.workspace_id,
    workspace_name: workspace.name,
    workspace_slug: workspace.slug
  };
}

function catalogWorkspaceLabel(catalog) {
  return catalog.workspace_slug ?? catalog.workspace_name ?? catalog.workspace_id;
}

function catalogWorkflowLabel(catalog) {
  return catalog.workflow_id ?? catalog.workflowId ?? catalog.workflow_name ?? 'workflow';
}

function formatCatalogDatabaseLabel(catalog) {
  return [
    catalogWorkspaceLabel(catalog),
    catalogWorkflowLabel(catalog),
    catalog.database_name
  ].join(' · ');
}

function buildCatalogTableDeleteWarning(preview) {
  const lines = [
    `Delete table "${preview.schema_name}.${preview.table_name}" from ${preview.workflow_name}?`,
    '',
    'This removes the table from the workflow DuckDB catalog.'
  ];

  if (preview.affected_workflows?.length) {
    lines.push('');
    lines.push('The following workflows use this table:');

    preview.affected_workflows.forEach((workflow) => {
      const nodeSummary = (workflow.nodes ?? [])
        .map((node) => {
          const label = node.node_label?.trim() || node.node_id;
          return `${label} (${node.usage_kind})`;
        })
        .join(', ');
      lines.push(`- ${workflow.workflow_name}: ${nodeSummary}`);
    });

    lines.push('');
    lines.push(
      'If you continue, those node references will be cleared and the affected workflows will become invalid until you reconnect them.'
    );
  }

  return lines.join('\n');
}

function catalogTreeKey(catalogOrSelection) {
  return `${catalogOrSelection.workspace_id ?? catalogOrSelection.workspaceId}:${
    catalogOrSelection.workflow_id ?? catalogOrSelection.workflowId
  }`;
}

function schemaTreeKey(catalogOrSelection, schemaName) {
  return `${catalogTreeKey(catalogOrSelection)}:${schemaName}`;
}

const VIEW_MODES = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'mobile', label: 'Mobile' }
];

const VIEW_MODE_STORAGE_KEY = 'stitchly.view-mode.v1';
const ATTENTION_COLLAPSE_STORAGE_KEY = 'stitchly.dashboard.attention-collapsed.v1';
const UNAUTHENTICATED_SESSION = {
  authenticated: false,
  workspaces: [],
  active_workspace_id: null,
  user: null
};

export default function App() {
  const [sessionState, setSessionState] = useState({
    status: 'loading',
    session: UNAUTHENTICATED_SESSION
  });
  const [viewMode, setViewMode] = useState(() => readStoredViewMode());
  const [isAttentionCollapsed, setIsAttentionCollapsed] = useState(() =>
    readStoredAttentionCollapsed()
  );

  useEffect(() => {
    void refreshSession(setSessionState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      ATTENTION_COLLAPSE_STORAGE_KEY,
      JSON.stringify(isAttentionCollapsed)
    );
  }, [isAttentionCollapsed]);

  async function handleLogin(email, password) {
    const session = normalizeSession(await login(email, password));
    setSessionState({ status: 'ready', session });
    return session;
  }

  async function handleGoogleLogin(code) {
    const session = normalizeSession(await loginWithGoogleCode(code));
    setSessionState({ status: 'ready', session });
    return session;
  }

  async function handleLogout() {
    await logout();
    setSessionState({ status: 'ready', session: UNAUTHENTICATED_SESSION });
  }

  async function handleRefreshSession() {
    return refreshSession(setSessionState);
  }

  if (sessionState.status === 'loading') {
    return <LoadingScreen />;
  }

  return (
    <BrowserRouter>
      <AppRoutes
        onCreateWorkspaceComplete={handleRefreshSession}
        onGoogleLogin={handleGoogleLogin}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onRefreshSession={handleRefreshSession}
        onToggleAttentionCollapsed={setIsAttentionCollapsed}
        isAttentionCollapsed={isAttentionCollapsed}
        session={sessionState.session}
        setViewMode={setViewMode}
        viewMode={viewMode}
      />
    </BrowserRouter>
  );
}

function AppRoutes({
  onCreateWorkspaceComplete,
  onGoogleLogin,
  onLogin,
  onLogout,
  onRefreshSession,
  onToggleAttentionCollapsed,
  isAttentionCollapsed,
  session,
  setViewMode,
  viewMode
}) {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          session.authenticated ? (
            <Navigate replace to={getDefaultAppPath(session)} />
          ) : (
            <LoginRoute onGoogleLogin={onGoogleLogin} onLogin={onLogin} />
          )
        }
      />
      <Route
        path="/workspaces/new"
        element={
          <ProtectedRoute allowEmptyWorkspaces session={session}>
            <CreateWorkspaceRoute
              onCreateWorkspaceComplete={onCreateWorkspaceComplete}
              session={session}
            />
          </ProtectedRoute>
        }
      />
      <Route
        path="/w/:workspaceSlug"
        element={
          <ProtectedRoute session={session}>
            <WorkspaceIndexRedirect session={session} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/flow/:workflowId"
        element={
          <ProtectedRoute session={session}>
            <CanvasWorkflowRoute
              onLogout={onLogout}
              onRefreshSession={onRefreshSession}
              onToggleAttentionCollapsed={onToggleAttentionCollapsed}
              isAttentionCollapsed={isAttentionCollapsed}
              session={session}
              setViewMode={setViewMode}
              viewMode={viewMode}
            />
          </ProtectedRoute>
        }
      />
      <Route
        path="/w/:workspaceSlug/canvas"
        element={
          <ProtectedRoute session={session}>
            <WorkspaceScreenRoute
              onLogout={onLogout}
              onRefreshSession={onRefreshSession}
              onToggleAttentionCollapsed={onToggleAttentionCollapsed}
              isAttentionCollapsed={isAttentionCollapsed}
              session={session}
              setViewMode={setViewMode}
              viewMode={viewMode}
            />
          </ProtectedRoute>
        }
      />
      <Route
        path="/w/:workspaceSlug/:screenId"
        element={
          <ProtectedRoute session={session}>
            <WorkspaceScreenRoute
              onLogout={onLogout}
              onRefreshSession={onRefreshSession}
              onToggleAttentionCollapsed={onToggleAttentionCollapsed}
              isAttentionCollapsed={isAttentionCollapsed}
              session={session}
              setViewMode={setViewMode}
              viewMode={viewMode}
            />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate replace to={getDefaultAppPath(session)} />} />
    </Routes>
  );
}

function ProtectedRoute({ allowEmptyWorkspaces = false, children, session }) {
  if (!session.authenticated) {
    return <Navigate replace to="/login" />;
  }

  if (!allowEmptyWorkspaces && !session.workspaces.length) {
    return <Navigate replace to="/workspaces/new" />;
  }

  return children;
}

function WorkspaceIndexRedirect({ session }) {
  const { workspaceSlug } = useParams();
  const workspace = session.workspaces.find((candidate) => candidate.slug === workspaceSlug);

  if (!workspace) {
    return <Navigate replace to={getDefaultAppPath(session)} />;
  }

  return <Navigate replace to={buildCanvasHomePath(workspace.slug)} />;
}

function CanvasWorkflowRoute({
  onLogout,
  onRefreshSession,
  onToggleAttentionCollapsed,
  isAttentionCollapsed,
  session,
  setViewMode,
  viewMode
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { workflowId } = useParams();
  const [resolvedWorkspace, setResolvedWorkspace] = useState(null);
  const [resolveState, setResolveState] = useState('loading');
  const workspaceHintId = new URLSearchParams(location.search).get('workspaceId');

  useEffect(() => {
    let cancelled = false;

    async function resolveWorkflowWorkspace() {
      if (!workflowId) {
        setResolveState('missing');
        return;
      }

      const hintedWorkspace = session.workspaces.find(
        (workspace) => workspace.workspace_id === workspaceHintId
      );
      const orderedWorkspaces = [
        ...(hintedWorkspace ? [hintedWorkspace] : []),
        ...session.workspaces.filter(
          (workspace) =>
            workspace.workspace_id === session.active_workspace_id &&
            workspace.workspace_id !== workspaceHintId
        ),
        ...session.workspaces.filter(
          (workspace) =>
            workspace.workspace_id !== session.active_workspace_id &&
            workspace.workspace_id !== workspaceHintId
        )
      ];

      for (const workspace of orderedWorkspaces) {
        try {
          await getWorkflow(workspace.workspace_id, workflowId);
          if (cancelled) {
            return;
          }

          setResolvedWorkspace(workspace);
          setResolveState('ready');
          return;
        } catch (error) {
          if (error?.status === 404) {
            continue;
          }

          if (!cancelled) {
            setResolveState('error');
          }
          return;
        }
      }

      if (!cancelled) {
        setResolveState('missing');
      }
    }

    setResolvedWorkspace(null);
    setResolveState('loading');
    void resolveWorkflowWorkspace();

    return () => {
      cancelled = true;
    };
  }, [session.active_workspace_id, session.workspaces, workflowId, workspaceHintId]);

  useEffect(() => {
    if (
      !workflowId ||
      !resolvedWorkspace?.workspace_id ||
      workspaceHintId === resolvedWorkspace.workspace_id
    ) {
      return;
    }

    navigate(buildWorkflowPath(workflowId, resolvedWorkspace.workspace_id), {
      replace: true
    });
  }, [navigate, resolvedWorkspace, workflowId, workspaceHintId]);

  if (!workflowId) {
    return <Navigate replace to={getDefaultAppPath(session)} />;
  }

  if (resolveState === 'loading') {
    return <LoadingScreen />;
  }

  if (!resolvedWorkspace) {
    return <Navigate replace to={getDefaultAppPath(session)} />;
  }

  return (
    <ProductShell
      activeScreen={APP_SCREENS.find((screen) => screen.id === 'canvas') ?? APP_SCREENS[0]}
      activeWorkspace={resolvedWorkspace}
      activeWorkflowId={workflowId}
      isAttentionCollapsed={isAttentionCollapsed}
      onCanvasWorkflowMissing={() =>
        navigate(buildCanvasHomePath(resolvedWorkspace.slug), { replace: true })
      }
      onCanvasOpenWorkflow={(nextWorkflowId, nextWorkspaceId) =>
        navigate(buildWorkflowPath(nextWorkflowId, nextWorkspaceId))
      }
      onLogout={onLogout}
      onRefreshSession={onRefreshSession}
      onToggleAttentionCollapsed={onToggleAttentionCollapsed}
      session={session}
      setViewMode={setViewMode}
      viewMode={viewMode}
    />
  );
}

function WorkspaceScreenRoute({
  onLogout,
  onRefreshSession,
  onToggleAttentionCollapsed,
  isAttentionCollapsed,
  session,
  setViewMode,
  viewMode
}) {
  const navigate = useNavigate();
  const { screenId, workspaceSlug } = useParams();
  const resolvedScreenId = screenId ?? 'canvas';
  const activeWorkspace = session.workspaces.find((workspace) => workspace.slug === workspaceSlug);

  if (!activeWorkspace) {
    return <Navigate replace to={getDefaultAppPath(session)} />;
  }

  if (resolvedScreenId === 'workflows') {
    return <Navigate replace to={buildCanvasHomePath(activeWorkspace.slug)} />;
  }

  const activeScreen = APP_SCREENS.find((screen) => screen.id === resolvedScreenId);
  if (!activeScreen) {
    return <Navigate replace to={buildCanvasHomePath(activeWorkspace.slug)} />;
  }

  return (
    <ProductShell
      activeScreen={activeScreen}
      activeWorkspace={activeWorkspace}
      activeWorkflowId={resolvedScreenId === 'canvas' ? null : undefined}
      isAttentionCollapsed={isAttentionCollapsed}
      onCanvasWorkflowMissing={null}
      onCanvasOpenWorkflow={(nextWorkflowId, nextWorkspaceId) =>
        navigate(buildWorkflowPath(nextWorkflowId, nextWorkspaceId))
      }
      onCanvasWorkflowResolved={(resolvedWorkflowId) =>
        navigate(buildWorkflowPath(resolvedWorkflowId, activeWorkspace.workspace_id), {
          replace: true
        })
      }
      onLogout={onLogout}
      onRefreshSession={onRefreshSession}
      onToggleAttentionCollapsed={onToggleAttentionCollapsed}
      session={session}
      setViewMode={setViewMode}
      viewMode={viewMode}
    />
  );
}

function ProductShell({
  activeScreen,
  activeWorkspace,
  activeWorkflowId = null,
  isAttentionCollapsed,
  onCanvasWorkflowMissing = null,
  onCanvasOpenWorkflow = null,
  onCanvasWorkflowResolved = null,
  onLogout,
  onRefreshSession,
  onToggleAttentionCollapsed,
  session,
  setViewMode,
  viewMode
}) {
  const navigate = useNavigate();
  const isCanvasRoute = activeScreen.id === 'canvas';
  const [activeCanvasMenuId, setActiveCanvasMenuId] = useState(null);
  const [draggedCanvasNodeType, setDraggedCanvasNodeType] = useState(null);
  const [canvasActions, setCanvasActions] = useState(null);
  const [canvasRunsSelectedRunId, setCanvasRunsSelectedRunId] = useState('');
  const [isCreatingCanvasWorkflow, setIsCreatingCanvasWorkflow] = useState(false);
  const [deletingCanvasWorkspaceId, setDeletingCanvasWorkspaceId] = useState('');
  const activeCanvasShelfGroup =
    NODE_SHELF_GROUPS.find((group) => group.id === activeCanvasMenuId) ?? null;
  const isCanvasBrandMenuOpen = activeCanvasMenuId === 'brand';
  const isCanvasWorkspacePanelOpen = activeCanvasMenuId === 'workspace';
  const isCanvasWorkflowPanelOpen = activeCanvasMenuId === 'workflows';
  const isCanvasRunsPanelOpen = activeCanvasMenuId === 'runs';
  const isCanvasDataPanelOpen = activeCanvasMenuId === 'data';
  const isCanvasIntegrationsPanelOpen = activeCanvasMenuId === 'integrations';
  const isSidebarCollapsedEffective = true;

  useEffect(() => {
    setActiveCanvasMenuId(null);
    setDraggedCanvasNodeType(null);
    setCanvasRunsSelectedRunId('');
  }, [activeWorkflowId, activeWorkspace.workspace_id, isCanvasRoute]);

  function handleCanvasMenuToggle(nextId) {
    setActiveCanvasMenuId((current) => (current === nextId ? null : nextId));
  }

  function handleCanvasNodeAdd(typeId) {
    canvasActions?.addNode?.(typeId);
    setActiveCanvasMenuId(null);
  }

  async function handleCanvasNewWorkflow() {
    if (isCreatingCanvasWorkflow) {
      return;
    }

    setIsCreatingCanvasWorkflow(true);

    try {
      const workflow = buildBlankWorkflowDefinition();
      const response = await createWorkflow(activeWorkspace.workspace_id, workflow);
      const nextPath = buildWorkflowPath(
        response.workflow.workflow_id,
        activeWorkspace.workspace_id
      );

      window.open(nextPath, '_blank', 'noopener');
      setActiveCanvasMenuId(null);
    } catch (error) {
      console.error('Unable to create a new workflow tab.', error);
    } finally {
      setIsCreatingCanvasWorkflow(false);
    }
  }

  async function handleCanvasOpenWorkflow(
    workflowId,
    workspaceId = activeWorkspace.workspace_id
  ) {
    await updateWorkflowState(workspaceId, workflowId).catch(() => {});
    onCanvasOpenWorkflow?.(workflowId, workspaceId);
    setActiveCanvasMenuId(null);
  }

  function handleCanvasInspectRun(runId) {
    if (!runId) {
      return;
    }

    setCanvasRunsSelectedRunId(runId);
    setActiveCanvasMenuId('runs');
  }

  function handleCanvasOpenRunControl() {
    canvasActions?.openRunControl?.();
  }

  async function handleCanvasManagedWorkflowCreate(mode) {
    const workflow =
      mode === 'starter'
        ? buildStarterWorkflowDefinition()
        : buildBlankWorkflowDefinition();
    const response = await createWorkflow(activeWorkspace.workspace_id, workflow);
    await updateWorkflowState(activeWorkspace.workspace_id, response.workflow.workflow_id).catch(
      () => {}
    );
    onCanvasOpenWorkflow?.(response.workflow.workflow_id, activeWorkspace.workspace_id);
    return response.workflow;
  }

  function handleCanvasOpenWorkspace(workspace, workflowId = null) {
    if (!workspace) {
      return;
    }

    if (workflowId) {
      navigate(buildWorkflowPath(workflowId, workspace.workspace_id));
    } else {
      navigate(buildCanvasHomePath(workspace.slug));
    }

    setActiveCanvasMenuId(null);
  }

  function handleCanvasCreateWorkspace() {
    navigate('/workspaces/new');
    setActiveCanvasMenuId(null);
  }

  async function handleCanvasDeleteWorkspace(workspace) {
    if (!workspace?.workspace_id || deletingCanvasWorkspaceId) {
      return;
    }

    setDeletingCanvasWorkspaceId(workspace.workspace_id);

    try {
      await deleteWorkspace(workspace.workspace_id);
      const refreshedSession = normalizeSession(
        onRefreshSession ? await onRefreshSession() : session
      );

      if (workspace.workspace_id === activeWorkspace.workspace_id) {
        const nextWorkspace =
          refreshedSession.workspaces.find(
            (candidate) => candidate.workspace_id === refreshedSession.active_workspace_id
          ) ?? refreshedSession.workspaces[0];

        navigate(nextWorkspace ? buildCanvasHomePath(nextWorkspace.slug) : '/workspaces/new', {
          replace: true
        });
        setActiveCanvasMenuId(null);
      }
    } finally {
      setDeletingCanvasWorkspaceId('');
    }
  }

  return (
    <div
      className={`dashboard-app dashboard-app--${viewMode}${
        isCanvasRoute ? ' dashboard-app--canvas' : ''
      }${
        isSidebarCollapsedEffective ? ' dashboard-app--sidebar-collapsed' : ''
      }`}
    >
      <div className="dashboard-app__shell">
        {isCanvasRoute ? (
          <CanvasMenuDock
            activeGroup={activeCanvasShelfGroup}
            activeWorkspace={activeWorkspace}
            activeWorkflowId={activeWorkflowId}
            groups={NODE_SHELF_GROUPS}
            isCreatingWorkflow={isCreatingCanvasWorkflow}
            isBrandMenuOpen={isCanvasBrandMenuOpen}
            isWorkspacePanelOpen={isCanvasWorkspacePanelOpen}
            isWorkflowPanelOpen={isCanvasWorkflowPanelOpen}
            isDataPanelOpen={isCanvasDataPanelOpen}
            isIntegrationsPanelOpen={isCanvasIntegrationsPanelOpen}
            onAddNode={handleCanvasNodeAdd}
            onBrandToggle={() => handleCanvasMenuToggle('brand')}
            onCreateWorkspace={handleCanvasCreateWorkspace}
            onCreateManagedWorkflow={handleCanvasManagedWorkflowCreate}
            onCreateWorkflow={handleCanvasNewWorkflow}
            onDeleteWorkspace={handleCanvasDeleteWorkspace}
            onInspectRun={handleCanvasInspectRun}
            onOpenRunControl={handleCanvasOpenRunControl}
            onOpenWorkspace={handleCanvasOpenWorkspace}
            onOpenWorkflow={handleCanvasOpenWorkflow}
            onNodeDragEnd={() => {
              setDraggedCanvasNodeType(null);
              setActiveCanvasMenuId(null);
            }}
            onNodeDragStart={setDraggedCanvasNodeType}
            onShelfToggle={handleCanvasMenuToggle}
            onSignOut={onLogout}
            onRunsToggle={() => handleCanvasMenuToggle('runs')}
            onDataToggle={() => handleCanvasMenuToggle('data')}
            onIntegrationsToggle={() => handleCanvasMenuToggle('integrations')}
            onSelectedRunIdChange={setCanvasRunsSelectedRunId}
            onWorkspaceToggle={() => handleCanvasMenuToggle('workspace')}
            onWorkflowToggle={() => handleCanvasMenuToggle('workflows')}
            isRunsPanelOpen={isCanvasRunsPanelOpen}
            selectedRunId={canvasRunsSelectedRunId}
            deletingWorkspaceId={deletingCanvasWorkspaceId}
            workspaces={session.workspaces}
          />
        ) : (
          <aside
            className={`dashboard-app__sidebar${
              isSidebarCollapsedEffective ? ' dashboard-app__sidebar--collapsed' : ''
            }`}
          >
          {/* <div className="dashboard-sidebar__brand">
            <span className="dashboard-brand-chip">
              <img
                alt=""
                className="dashboard-brand-chip__symbol"
                src="/brand/symbol/stitchly-symbol-white.svg"
              />
              <span className="dashboard-brand-chip__label">Contained shell</span>
            </span>
            <span className="dashboard-brand-orb" aria-hidden="true">
              <img
                alt=""
                className="dashboard-brand-orb__symbol"
                src="/brand/symbol/stitchly-symbol-white.svg"
              />
            </span>
            <span className="dashboard-brand-name">Stitchly</span>
            <span className="dashboard-brand-label">Operations workspace</span>
          </div> */}

          <div className="dashboard-sidebar__nav">
            <div className="dashboard-nav-group">
              {APP_SCREENS.filter((screen) => SIDEBAR_SCREEN_IDS.has(screen.id)).map((screen) => (
                <NavLink
                  key={screen.id}
                  className={({ isActive }) =>
                    `dashboard-nav-item${isActive ? ' dashboard-nav-item--active' : ''}`
                  }
                  aria-label={screen.label}
                  to={`/w/${activeWorkspace.slug}/${screen.id}`}
                >
                  <span className="dashboard-nav-item__icon" aria-hidden="true">
                    <DashboardNavIcon screenId={screen.id} />
                  </span>
                  <span className="dashboard-nav-item__label">{screen.label}</span>
                  <span className="dashboard-nav-item__tooltip" role="tooltip">
                    {screen.label}
                  </span>
                </NavLink>
              ))}
            </div>

            {isCanvasRoute ? (
              <>
                <span className="dashboard-sidebar__rail-divider" aria-hidden="true" />

                <div className="dashboard-sidebar__node-groups">
                  {NODE_SHELF_GROUPS.map((group) => (
                    <SidebarNodeShelfGroup
                      key={group.id}
                      group={group}
                      isOpen={activeCanvasShelfId === group.id}
                      onToggle={() => handleCanvasShelfToggle(group.id)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            <div className="dashboard-sidebar__subnav">
              <button
                aria-label="Sign out"
                className="dashboard-nav-item dashboard-nav-item--utility"
                onClick={onLogout}
                type="button"
              >
                <span className="dashboard-nav-item__icon" aria-hidden="true">
                  <UtilityIcon kind="logout" />
                </span>
                <span className="dashboard-nav-item__label">Sign out</span>
                <span className="dashboard-nav-item__tooltip" role="tooltip">
                  Sign out
                </span>
              </button>
            </div>

            <div
              className={`dashboard-sidebar__utility-card${
                isAttentionCollapsed ? ' dashboard-sidebar__utility-card--collapsed' : ''
              }`}
            >
              <div className="dashboard-sidebar__utility-card-header">
                <span className="dashboard-sidebar__utility-card-title">Attention</span>
                <span className="dashboard-sidebar__utility-card-header-actions">
                  <span className="dashboard-sidebar__utility-card-count">3</span>
                  <button
                    aria-label={isAttentionCollapsed ? 'Expand attention panel' : 'Collapse attention panel'}
                    className="dashboard-sidebar__utility-card-toggle"
                    onClick={() => onToggleAttentionCollapsed((current) => !current)}
                    type="button"
                  >
                    <span aria-hidden="true">{isAttentionCollapsed ? '▾' : '▴'}</span>
                  </button>
                </span>
              </div>

              {isAttentionCollapsed ? (
                <div className="dashboard-sidebar__utility-card-summary">
                  <span>Orders import failed</span>
                  <span>3 active items</span>
                </div>
              ) : (
                <>
                  <div className="dashboard-sidebar__alert">
                    <div className="dashboard-sidebar__alert-title">
                      <span>Orders import failed</span>
                      <span className="dashboard-sidebar__alert-dot" aria-hidden="true" />
                    </div>
                    <div className="dashboard-sidebar__alert-meta">
                      TimeoutError at step 2. Review supplier retries and stale workflow state.
                    </div>
                  </div>

                  <div className="dashboard-sidebar__list">
                    <div className="dashboard-sidebar__mini-item">
                      <span className="dashboard-sidebar__mini-item-label">
                        <span className="dashboard-sidebar__mini-item-dot dashboard-sidebar__mini-item-dot--accent" />
                        <span>Notifications</span>
                      </span>
                      <span className="dashboard-sidebar__mini-item-value">3 new</span>
                    </div>
                    <div className="dashboard-sidebar__mini-item">
                      <span className="dashboard-sidebar__mini-item-label">
                        <span className="dashboard-sidebar__mini-item-dot" />
                        <span>Pending approvals</span>
                      </span>
                      <span className="dashboard-sidebar__mini-item-value">5 items</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="dashboard-sidebar__footer">
            <div className="dashboard-profile">
              <span className="dashboard-profile__avatar dashboard-profile__avatar--symbol">
                <img alt="" src="/brand/symbol/stitchly-symbol-white.svg" />
              </span>
              <span className="dashboard-profile__meta">
                <span className="dashboard-profile__name">
                  {session.user?.display_name ?? 'Builder'}
                </span>
                <span className="dashboard-profile__role">
                  {activeWorkspace.role} · {activeWorkspace.name}
                </span>
              </span>
            </div>
          </div>
          </aside>
        )}

        {isCanvasRoute ? (
          <div className="dashboard-canvas-shell">
            <main className="dashboard-canvas-shell__stage">
              <CanvasScreen
                draggedNodeType={draggedCanvasNodeType}
                isFullScreen
                onOpenRunInPanel={handleCanvasInspectRun}
                onRegisterCanvasActions={setCanvasActions}
                onWorkflowMissing={onCanvasWorkflowMissing}
                onWorkflowResolved={onCanvasWorkflowResolved}
                workflowId={activeWorkflowId}
                workspaceId={activeWorkspace.workspace_id}
              />
            </main>
          </div>
        ) : (
          <div className="dashboard-app__main">
            <div className="dashboard-main-card">
              <div className="dashboard-main-card__inner">
                <div className="dashboard-main-card__topbar">
                  <div className="dashboard-main-card__title">
                    <span className="dashboard-main-card__eyebrow">{activeScreen.label}</span>
                    <h1 className="dashboard-main-card__heading">{activeScreen.label}</h1>
                    <span className="dashboard-main-card__subcopy">
                      {activeScreen.description}
                    </span>
                  </div>

                  <div className="dashboard-toolbar">
                    <span className="dashboard-pill">{activeWorkspace.name}</span>
                    <span className="dashboard-pill dashboard-pill--ghost">{session.user?.email}</span>
                    <ViewModeToggle currentMode={viewMode} onSelect={setViewMode} />
                  </div>
                </div>

                <WorkspaceSwitcher
                  activeWorkspace={activeWorkspace}
                  variant="topbar"
                  workspaces={session.workspaces}
                />

                <main className="dashboard-main-card__stage" data-screen={activeScreen.id}>
                  {activeScreen.id === 'workflows' ? (
                    <WorkflowListScreen activeWorkspace={activeWorkspace} />
                  ) : null}
                  {activeScreen.id === 'overview' ? (
                    <OverviewScreen activeWorkspace={activeWorkspace} viewMode={viewMode} />
                  ) : null}
                  {activeScreen.id === 'runs' ? (
                    <RunsScreen activeWorkspace={activeWorkspace} />
                  ) : null}
                  {activeScreen.id === 'connections' ? <ConnectionsScreen /> : null}
                  {activeScreen.id === 'settings' ? (
                    <SettingsScreen
                      activeWorkspace={activeWorkspace}
                      onSelectViewMode={setViewMode}
                      viewMode={viewMode}
                    />
                  ) : null}
                </main>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CanvasMenuDock({
  activeGroup = null,
  activeWorkspace,
  activeWorkflowId = null,
  deletingWorkspaceId = '',
  groups,
  isCreatingWorkflow = false,
  isBrandMenuOpen = false,
  isDataPanelOpen = false,
  isIntegrationsPanelOpen = false,
  isRunsPanelOpen = false,
  isWorkspacePanelOpen = false,
  isWorkflowPanelOpen = false,
  onAddNode,
  onBrandToggle,
  onCreateWorkspace,
  onCreateManagedWorkflow,
  onCreateWorkflow,
  onDeleteWorkspace,
  onInspectRun,
  onOpenRunControl,
  onOpenWorkspace,
  onOpenWorkflow,
  onNodeDragEnd,
  onNodeDragStart,
  onSelectedRunIdChange,
  onShelfToggle,
  onSignOut,
  onDataToggle,
  onIntegrationsToggle,
  onRunsToggle,
  onWorkspaceToggle,
  onWorkflowToggle,
  selectedRunId = '',
  workspaces = []
}) {
  return (
    <aside
      className={`canvas-menu${
        activeGroup || isBrandMenuOpen || isWorkspacePanelOpen || isWorkflowPanelOpen
          || isRunsPanelOpen || isDataPanelOpen || isIntegrationsPanelOpen
          ? ' is-open'
          : ''
      }`}
      aria-label="Canvas menu"
    >
      <div className="canvas-menu__dock">
        <button
          aria-expanded={isBrandMenuOpen}
          aria-label="Stitchly"
          className={`canvas-menu__button canvas-menu__button--brand${
            isBrandMenuOpen ? ' is-open' : ''
          }`}
          onClick={onBrandToggle}
          type="button"
        >
          <span className="canvas-menu__icon" aria-hidden="true">
            <img
              alt=""
              className="canvas-menu__brand-image"
              src="/brand/symbol/stitchly-symbol-mark-white.svg"
            />
          </span>
        </button>

        <CanvasMenuButton
          icon={<CanvasMenuIcon kind="workspace" />}
          isActive={isWorkspacePanelOpen}
          isExpanded={isWorkspacePanelOpen}
          label="Workspaces"
          onClick={onWorkspaceToggle}
        />

        <CanvasMenuButton
          icon={<CanvasMenuIcon kind="workflows" />}
          isActive={isWorkflowPanelOpen}
          isExpanded={isWorkflowPanelOpen}
          label="Workflows"
          onClick={onWorkflowToggle}
        />

        <CanvasMenuButton
          icon={<CanvasMenuIcon kind="runs" />}
          isActive={isRunsPanelOpen}
          isExpanded={isRunsPanelOpen}
          label="Runs"
          onClick={onRunsToggle}
        />

        <CanvasMenuButton
          icon={<CanvasMenuIcon kind="data" />}
          isActive={isDataPanelOpen}
          isExpanded={isDataPanelOpen}
          label="Data"
          onClick={onDataToggle}
        />

        <CanvasMenuButton
          icon={<CanvasMenuIcon kind="connections" />}
          isActive={isIntegrationsPanelOpen}
          isExpanded={isIntegrationsPanelOpen}
          label="Integrations"
          onClick={onIntegrationsToggle}
        />

        <span className="canvas-menu__divider" aria-hidden="true" />

        {groups.map((group) => (
          <CanvasMenuButton
            key={group.id}
            icon={<CanvasMenuIcon kind={group.id} />}
            isActive={activeGroup?.id === group.id}
            isExpanded={activeGroup?.id === group.id}
            label={group.label}
            onClick={() => onShelfToggle(group.id)}
          />
        ))}

        <span className="canvas-menu__divider" aria-hidden="true" />

        <CanvasMenuButton
          icon={<CanvasMenuIcon kind="exit" />}
          label="Exit"
          onClick={onSignOut}
        />
      </div>

      {isBrandMenuOpen ? (
        <CanvasBrandMenuPanel
          activeWorkflowId={activeWorkflowId}
          activeWorkspace={activeWorkspace}
          isCreatingWorkflow={isCreatingWorkflow}
          onCreateWorkflow={onCreateWorkflow}
          onOpenWorkflow={onOpenWorkflow}
        />
      ) : null}

      {isWorkspacePanelOpen ? (
        <CanvasWorkspaceDirectoryPanel
          activeWorkflowId={activeWorkflowId}
          activeWorkspace={activeWorkspace}
          deletingWorkspaceId={deletingWorkspaceId}
          onCreateWorkspace={onCreateWorkspace}
          onDeleteWorkspace={onDeleteWorkspace}
          onOpenWorkspace={onOpenWorkspace}
          onOpenWorkflow={onOpenWorkflow}
          workspaces={workspaces}
        />
      ) : null}

      {isWorkflowPanelOpen ? (
        <CanvasWorkflowMenuPanel
          activeWorkflowId={activeWorkflowId}
          activeWorkspace={activeWorkspace}
          onCreateWorkflow={onCreateManagedWorkflow}
          onOpenWorkflow={onOpenWorkflow}
        />
      ) : null}

      {isRunsPanelOpen ? (
        <CanvasRunsHistoryPanel
          activeWorkflowId={activeWorkflowId}
          activeWorkspace={activeWorkspace}
          onInspectRun={onInspectRun}
          onOpenRunControl={onOpenRunControl}
          onOpenWorkflow={onOpenWorkflow}
          onSelectedRunIdChange={onSelectedRunIdChange}
          selectedRunId={selectedRunId}
        />
      ) : null}

      {isDataPanelOpen ? (
        <CanvasDataPanel activeWorkspace={activeWorkspace} workspaces={workspaces} />
      ) : null}

      {isIntegrationsPanelOpen ? (
        <CanvasIntegrationsPanel activeWorkspace={activeWorkspace} />
      ) : null}

      {activeGroup &&
      !isWorkspacePanelOpen &&
      !isWorkflowPanelOpen &&
      !isRunsPanelOpen &&
      !isDataPanelOpen &&
      !isIntegrationsPanelOpen ? (
        <CanvasNodeShelfDrawer
          group={activeGroup}
          onAddNode={onAddNode}
          onNodeDragEnd={onNodeDragEnd}
          onNodeDragStart={onNodeDragStart}
        />
      ) : null}
    </aside>
  );
}

function CanvasBrandMenuPanel({
  activeWorkflowId = null,
  activeWorkspace,
  isCreatingWorkflow = false,
  onCreateWorkflow,
  onOpenWorkflow
}) {
  const [isOpenRecentOpen, setIsOpenRecentOpen] = useState(false);
  const [recentWorkflowState, setRecentWorkflowState] = useState({
    error: '',
    status: 'idle',
    workflows: []
  });
  const items = [
    { label: 'Back to files', kind: 'primary' },
    {
      label: isCreatingWorkflow ? 'Creating…' : 'New file',
      onClick: onCreateWorkflow
    },
    { id: 'open_recent', label: 'Open recent', meta: '›' },
    { label: 'Duplicate' },
    { label: 'Rename' },
    { disabled: true, label: 'Share' },
    { label: 'Keyboard shortcuts', meta: 'Ctrl + Shift + ?' },
    { label: 'Preferences', meta: '›' }
  ];

  useEffect(() => {
    let cancelled = false;

    async function loadRecentWorkflows() {
      if (!isOpenRecentOpen) {
        return;
      }

      setRecentWorkflowState((current) => ({
        ...current,
        error: '',
        status: current.workflows.length ? 'refreshing' : 'loading'
      }));

      try {
        const response = await getWorkflows(activeWorkspace.workspace_id);
        if (cancelled) {
          return;
        }

        const workflows = [...(response.workflows ?? [])].sort((left, right) => {
          const leftTime = Date.parse(left.updated_at ?? '') || 0;
          const rightTime = Date.parse(right.updated_at ?? '') || 0;
          return rightTime - leftTime;
        });

        setRecentWorkflowState({
          error: '',
          status: 'ready',
          workflows
        });
      } catch (error) {
        if (!cancelled) {
          setRecentWorkflowState({
            error: error.message ?? 'Unable to load recent workflows.',
            status: 'error',
            workflows: []
          });
        }
      }
    }

    void loadRecentWorkflows();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.workspace_id, isOpenRecentOpen]);

  return (
    <aside className="canvas-brand-menu" aria-label="App menu">
      <div className="canvas-brand-menu__list">
        {items.map((item, index) => {
          const isDividerBefore = index === 6;
          const isOpenRecentItem = item.id === 'open_recent';

          return (
            <div
              className={`canvas-brand-menu__item-wrap${
                isDividerBefore ? ' canvas-brand-menu__item-wrap--divided' : ''
              }`}
              key={item.label}
            >
              <button
                className={`canvas-brand-menu__item${
                  item.kind === 'primary' ? ' is-primary' : ''
                }${item.disabled ? ' is-disabled' : ''}${
                  isOpenRecentItem && isOpenRecentOpen ? ' is-active' : ''
                }`}
                disabled={item.disabled}
                onClick={
                  isOpenRecentItem
                    ? () => setIsOpenRecentOpen((current) => !current)
                    : item.onClick
                }
                type="button"
              >
                <span>{item.label}</span>
                {item.meta ? (
                  <span className="canvas-brand-menu__item-meta">{item.meta}</span>
                ) : null}
              </button>

              {isOpenRecentItem && isOpenRecentOpen ? (
                <aside className="canvas-brand-menu__submenu" aria-label="Recent workflows">
                  <div className="canvas-brand-menu__submenu-header">
                    <strong>Recent workflows</strong>
                    <span>{activeWorkspace.name}</span>
                  </div>

                  <div className="canvas-brand-menu__submenu-list">
                    {recentWorkflowState.status === 'loading' ? (
                      <span className="canvas-brand-menu__submenu-empty">
                        Loading workflows…
                      </span>
                    ) : null}

                    {recentWorkflowState.status === 'error' ? (
                      <span className="canvas-brand-menu__submenu-empty">
                        {recentWorkflowState.error}
                      </span>
                    ) : null}

                    {recentWorkflowState.status !== 'loading' &&
                    recentWorkflowState.status !== 'error' &&
                    !recentWorkflowState.workflows.length ? (
                      <span className="canvas-brand-menu__submenu-empty">
                        No workflows yet.
                      </span>
                    ) : null}

                    {recentWorkflowState.workflows.map((workflow) => (
                      <button
                        className={`canvas-brand-menu__submenu-item${
                          workflow.workflow_id === activeWorkflowId ? ' is-current' : ''
                        }`}
                        key={workflow.workflow_id}
                        onClick={() => onOpenWorkflow?.(workflow.workflow_id)}
                        type="button"
                      >
                        <strong>{workflow.name}</strong>
                        <span>{formatWorkflowTimestamp(workflow.updated_at)}</span>
                      </button>
                    ))}
                  </div>
                </aside>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function CanvasMenuButton({ icon, isActive = false, isExpanded = undefined, label, onClick }) {
  return (
    <button
      aria-expanded={typeof isExpanded === 'boolean' ? isExpanded : undefined}
      className={`canvas-menu__button${isActive ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="canvas-menu__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="canvas-menu__tooltip" role="tooltip">
        {label}
      </span>
    </button>
  );
}

function WorkspaceSwitcher({ activeWorkspace, variant = 'sidebar', workspaces }) {
  return (
    <section
      className={`dashboard-workspace-switcher${
        variant === 'topbar' ? ' dashboard-workspace-switcher--topbar' : ''
      }`}
    >
      <div className="dashboard-workspace-switcher__header">
        <span>Workspaces</span>
        <Link to="/workspaces/new">New</Link>
      </div>

      <div className="dashboard-workspace-switcher__list">
        {workspaces.map((workspace) => (
          <Link
            key={workspace.workspace_id}
            className={`dashboard-workspace-link${
              workspace.workspace_id === activeWorkspace.workspace_id ? ' is-active' : ''
            }`}
            to={`/w/${workspace.slug}`}
          >
            <strong>{workspace.name}</strong>
            <span>{workspace.role}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function SidebarNodeShelfGroup({ group, isOpen = false, onToggle }) {
  return (
    <div className={`dashboard-node-group${isOpen ? ' is-open' : ''}`}>
      <button
        aria-label={group.label}
        aria-controls={`dashboard-node-shelf-${group.id}`}
        aria-expanded={isOpen}
        className="dashboard-nav-item dashboard-nav-item--node-group"
        onClick={onToggle}
        type="button"
      >
        <span className="dashboard-nav-item__icon dashboard-nav-item__icon--glyph" aria-hidden="true">
          {group.icon}
        </span>
        <span className="dashboard-nav-item__label">{group.label}</span>
        <span className="dashboard-nav-item__tooltip" role="tooltip">
          {group.label}
        </span>
      </button>
    </div>
  );
}

function CanvasNodeShelfDrawer({ group, onAddNode, onNodeDragEnd, onNodeDragStart }) {
  return (
    <aside
      aria-label={`${group.label} nodes`}
      className="canvas-menu__drawer"
      id={`dashboard-node-shelf-${group.id}`}
    >
      <div className="canvas-menu__drawer-header">
        <span className="canvas-menu__drawer-title">{group.label}</span>
      </div>
      <div className="canvas-menu__drawer-grid">
        {group.items.map((item) => (
          <button
            key={item.typeId}
            className={`canvas-menu__drawer-card${
              item.implemented ? '' : ' is-disabled'
            }`}
            disabled={!item.implemented || !onAddNode}
            draggable={item.implemented && Boolean(onAddNode)}
            onClick={() => {
              if (!item.implemented) {
                return;
              }

              onAddNode?.(item.typeId);
              onNodeDragEnd?.();
            }}
            onDragEnd={() => onNodeDragEnd?.()}
            onDragStart={(event) => {
              if (!item.implemented) {
                return;
              }

              setDraggedNodeType(event.dataTransfer, item.typeId);
              onNodeDragStart?.(item.typeId);
            }}
            type="button"
          >
            <span className="canvas-menu__drawer-card-icon" aria-hidden="true">
              <CanvasShelfItemIcon groupId={group.id} typeId={item.typeId} />
            </span>
            <span className="canvas-menu__drawer-card-label">{item.label}</span>
            {!item.implemented ? (
              <span className="canvas-menu__drawer-card-badge">Soon</span>
            ) : null}
          </button>
        ))}
      </div>
    </aside>
  );
}

function CanvasWorkspaceDirectoryPanel({
  activeWorkflowId = null,
  activeWorkspace,
  deletingWorkspaceId = '',
  onCreateWorkspace,
  onDeleteWorkspace,
  onOpenWorkspace,
  onOpenWorkflow,
  workspaces = []
}) {
  const [directoryState, setDirectoryState] = useState({
    error: '',
    status: 'loading',
    workspaceEntries: []
  });

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const workspaceEntries = await Promise.all(
        workspaces.map(async (workspace) => {
          const response = await getWorkflows(workspace.workspace_id);
          const workflows = [...(response.workflows ?? [])]
            .sort((left, right) => {
              const leftTime = Date.parse(left.updated_at ?? '') || 0;
              const rightTime = Date.parse(right.updated_at ?? '') || 0;
              return rightTime - leftTime;
            })
            .slice(0, 10);

          return {
            workspace,
            workflows
          };
        })
      );

      if (cancelled) {
        return;
      }

      setDirectoryState({
        error: '',
        status: 'ready',
        workspaceEntries
      });
    }

    setDirectoryState((current) => ({
      ...current,
      error: '',
      status: current.workspaceEntries.length ? 'refreshing' : 'loading'
    }));

    hydrate().catch((error) => {
      if (!cancelled) {
        setDirectoryState({
          error: error.message ?? 'Unable to load workspace directory.',
          status: 'error',
          workspaceEntries: []
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [workspaces]);

  async function handleDeleteWorkspace(workspace) {
    const shouldDelete = window.confirm(
      `Delete workspace "${workspace.name}"? This removes its workflows, runs, connections, and local DuckDB files.`
    );
    if (!shouldDelete) {
      return;
    }

    try {
      await onDeleteWorkspace?.(workspace);
      setDirectoryState((current) => ({
        ...current,
        error: ''
      }));
    } catch (error) {
      setDirectoryState((current) => ({
        ...current,
        error: error.message ?? 'Unable to delete workspace.'
      }));
    }
  }

  return (
    <aside className="canvas-workspace-panel" aria-label="Workspace directory">
      <header className="canvas-workspace-panel__header">
        <div className="canvas-workspace-panel__title-group">
          <span className="canvas-workspace-panel__title-icon" aria-hidden="true">
            <CanvasMenuIcon kind="workspace" />
          </span>
          <div className="canvas-workspace-panel__title-copy">
            <strong>Workspaces</strong>
            <span>Directory view</span>
          </div>
        </div>

        <div className="canvas-workspace-panel__header-actions">
          <div className="canvas-workspace-panel__header-meta">
            <span className="canvas-workspace-panel__meta-dot" aria-hidden="true" />
            <span>{workspaces.length}</span>
          </div>
          <button
            aria-label="New workspace"
            className="canvas-workspace-panel__add"
            onClick={onCreateWorkspace}
            type="button"
          >
            <span aria-hidden="true">+</span>
            <span className="canvas-workspace-panel__tooltip" role="tooltip">
              New Workspace
            </span>
          </button>
        </div>
      </header>

      {directoryState.status === 'loading' ? (
        <div className="canvas-workspace-panel__empty">Loading workspaces…</div>
      ) : null}

      {directoryState.error ? (
        <div className="canvas-workspace-panel__empty">{directoryState.error}</div>
      ) : null}

      {directoryState.status !== 'loading' &&
      !directoryState.error &&
      !directoryState.workspaceEntries.length ? (
        <div className="canvas-workspace-panel__empty">No workspaces yet.</div>
      ) : null}

      {directoryState.workspaceEntries.map(({ workspace, workflows }) => {
        const isActiveWorkspace = workspace.workspace_id === activeWorkspace.workspace_id;
        const canDeleteWorkspace = workspace.role === 'owner';
        const isDeletingWorkspace = deletingWorkspaceId === workspace.workspace_id;

        return (
          <section
            className={`canvas-workspace-panel__section${
              isActiveWorkspace ? ' is-active' : ''
            }`}
            key={workspace.workspace_id}
          >
            <div className="canvas-workspace-panel__section-head">
              <button
                className="canvas-workspace-panel__workspace"
                onClick={() => onOpenWorkspace?.(workspace, workflows[0]?.workflow_id ?? null)}
                type="button"
              >
                <strong>
                  {workspace.name}
                  {isActiveWorkspace ? ' · Current' : ''}
                </strong>
                <span>{workspace.role}</span>
              </button>

              <button
                aria-label={
                  canDeleteWorkspace
                    ? `Delete workspace ${workspace.name}`
                    : `Delete workspace ${workspace.name} (owner only)`
                }
                className="canvas-workspace-panel__delete"
                disabled={!canDeleteWorkspace || isDeletingWorkspace}
                onClick={() => handleDeleteWorkspace(workspace)}
                type="button"
              >
                <span aria-hidden="true">{isDeletingWorkspace ? '…' : '×'}</span>
              </button>
            </div>

            <div className="canvas-workspace-panel__tree">
              {workflows.length ? (
                workflows.map((workflow) => (
                  <button
                    className={`canvas-workspace-panel__workflow${
                      workflow.workflow_id === activeWorkflowId ? ' is-current' : ''
                    }`}
                    key={workflow.workflow_id}
                    onClick={() => onOpenWorkflow?.(workflow.workflow_id, workspace.workspace_id)}
                    type="button"
                  >
                    <span className="canvas-workspace-panel__tree-glyph" aria-hidden="true">
                      ∟
                    </span>
                    <span className="canvas-workspace-panel__workflow-copy">
                      <span className="canvas-workspace-panel__workflow-line">
                        <strong>{workflow.name}</strong>
                        <span>{formatWorkflowTimestamp(workflow.updated_at)}</span>
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <span className="canvas-workspace-panel__tree-empty">No workflows yet.</span>
              )}
            </div>
          </section>
        );
      })}
    </aside>
  );
}

function CanvasWorkflowMenuPanel({
  activeWorkflowId = null,
  activeWorkspace,
  onCreateWorkflow,
  onOpenWorkflow
}) {
  const [workflowState, setWorkflowState] = useState({
    error: '',
    status: 'loading',
    workflows: []
  });
  const [createMode, setCreateMode] = useState('');
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [archiveWorkflowId, setArchiveWorkflowId] = useState('');
  const [renameWorkflowId, setRenameWorkflowId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const response = await getWorkflows(activeWorkspace.workspace_id);
      if (cancelled) {
        return;
      }

      const workflows = [...(response.workflows ?? [])].sort((left, right) => {
        const leftTime = Date.parse(left.updated_at ?? '') || 0;
        const rightTime = Date.parse(right.updated_at ?? '') || 0;
        return rightTime - leftTime;
      });

      setWorkflowState({
        error: '',
        status: 'ready',
        workflows
      });
    }

    setWorkflowState((current) => ({
      ...current,
      error: '',
      status: current.workflows.length ? 'refreshing' : 'loading'
    }));
    hydrate().catch((error) => {
      if (!cancelled) {
        setWorkflowState({
          error: error.message ?? 'Unable to load workflows.',
          status: 'error',
          workflows: []
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.workspace_id]);

  async function handleCreate(mode) {
    if (!onCreateWorkflow || createMode) {
      return;
    }

    setCreateMode(mode);

    try {
      await onCreateWorkflow(mode);
      setIsCreateMenuOpen(false);
    } catch (error) {
      setWorkflowState((current) => ({
        ...current,
        error: error.message ?? 'Unable to create workflow.',
        status: current.workflows.length ? 'ready' : 'error'
      }));
    } finally {
      setCreateMode('');
    }
  }

  function startRename(workflow) {
    setRenameWorkflowId(workflow.workflow_id);
    setRenameDraft(workflow.name);
  }

  function cancelRename() {
    setRenameWorkflowId('');
    setRenameDraft('');
  }

  async function handleRename(workflowId) {
    const nextName = renameDraft.trim();
    if (!nextName) {
      return;
    }

    try {
      const existing = await getWorkflow(activeWorkspace.workspace_id, workflowId);
      const response = await updateWorkflow(activeWorkspace.workspace_id, workflowId, {
        ...existing.definition,
        name: nextName
      });

      setWorkflowState((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.workflow_id === workflowId ? response.workflow : workflow
        )
      }));
      cancelRename();
    } catch (error) {
      setWorkflowState((current) => ({
        ...current,
        error: error.message ?? 'Unable to rename workflow.'
      }));
    }
  }

  async function handleArchive(workflow) {
    const shouldArchive = window.confirm(
      `Archive workflow "${workflow.name}" from ${activeWorkspace.name}?`
    );
    if (!shouldArchive) {
      return;
    }

    setArchiveWorkflowId(workflow.workflow_id);

    try {
      await deleteWorkflow(activeWorkspace.workspace_id, workflow.workflow_id);
      setWorkflowState((current) => ({
        ...current,
        workflows: current.workflows.filter(
          (candidate) => candidate.workflow_id !== workflow.workflow_id
        )
      }));
      if (renameWorkflowId === workflow.workflow_id) {
        cancelRename();
      }
    } catch (error) {
      setWorkflowState((current) => ({
        ...current,
        error: error.message ?? 'Unable to archive workflow.'
      }));
    } finally {
      setArchiveWorkflowId('');
    }
  }

  return (
    <aside className="canvas-workflow-panel" aria-label="Workflow window">
      <header className="canvas-workflow-panel__header">
        <div className="canvas-workflow-panel__title-group">
          <span className="canvas-workflow-panel__title-icon" aria-hidden="true">
            <CanvasMenuIcon kind="workflows" />
          </span>
          <div className="canvas-workflow-panel__title-copy">
            <strong>Workflows</strong>
            <span>{activeWorkspace.name}</span>
          </div>
        </div>

        <div className="canvas-workflow-panel__header-actions">
          <div className="canvas-workflow-panel__header-meta">
            <span className="canvas-workflow-panel__meta-dot" aria-hidden="true" />
            <span>{activeWorkflowId ?? 'Canvas home'}</span>
          </div>
          <button
            aria-label="New workflow"
            className="canvas-workflow-panel__add"
            onClick={() => setIsCreateMenuOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true">+</span>
            <span className="canvas-workflow-panel__tooltip" role="tooltip">
              New Workflow
            </span>
          </button>
        </div>
      </header>

      {isCreateMenuOpen ? (
        <section className="canvas-workflow-panel__section canvas-workflow-panel__section--create">
          <div className="canvas-workflow-panel__section-head">
            <span>Create workflow</span>
            <span>Canvas</span>
          </div>

          <div className="canvas-workflow-panel__actions">
            <button
              className="canvas-workflow-panel__button canvas-workflow-panel__button--accent"
              disabled={Boolean(createMode)}
              onClick={() => void handleCreate('blank')}
              type="button"
            >
              {createMode === 'blank' ? 'Creating…' : 'Blank'}
            </button>
            <button
              className="canvas-workflow-panel__button"
              disabled={Boolean(createMode)}
              onClick={() => void handleCreate('starter')}
              type="button"
            >
              {createMode === 'starter' ? 'Creating…' : 'Starter'}
            </button>
          </div>
        </section>
      ) : null}

      {workflowState.error ? (
        <section className="canvas-workflow-panel__section">
          <div className="canvas-workflow-panel__error">{workflowState.error}</div>
        </section>
      ) : null}

      <section className="canvas-workflow-panel__section">
        <div className="canvas-workflow-panel__section-head">
          <span>Recent workflows</span>
          <span>
            {workflowState.status === 'loading'
              ? 'Loading'
              : workflowState.status === 'error'
                ? 'Unavailable'
                : 'Live'}
          </span>
        </div>

        <div className="canvas-workflow-panel__list">
          {workflowState.status === 'loading' ? (
            <button className="canvas-workflow-panel__item" disabled type="button">
              <strong>Loading workflows…</strong>
              <span>Pulling the latest saved flows for this workspace.</span>
            </button>
          ) : null}

          {workflowState.status === 'error' ? (
            <button className="canvas-workflow-panel__item" disabled type="button">
              <strong>Workflow list unavailable</strong>
              <span>{workflowState.error}</span>
            </button>
          ) : null}

          {workflowState.status !== 'loading' && !workflowState.workflows.length ? (
            <button className="canvas-workflow-panel__item" disabled type="button">
              <strong>No workflows yet</strong>
              <span>Create a new workflow from the app menu to get started.</span>
            </button>
          ) : null}

          {workflowState.workflows.map((workflow) => {
            const isRenaming = renameWorkflowId === workflow.workflow_id;
            const isArchiving = archiveWorkflowId === workflow.workflow_id;
            const isCurrent = workflow.workflow_id === activeWorkflowId;

            return (
              <div className="canvas-workflow-panel__item" key={workflow.workflow_id}>
                {isRenaming ? (
                  <input
                    autoFocus
                    className="canvas-workflow-panel__rename-input"
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleRename(workflow.workflow_id);
                      }

                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    type="text"
                    value={renameDraft}
                  />
                ) : (
                  <button
                    className="canvas-workflow-panel__open"
                    onClick={() => onOpenWorkflow?.(workflow.workflow_id)}
                    type="button"
                  >
                    <strong>{workflow.name}</strong>
                  </button>
                )}

                <span>
                  {isCurrent ? 'Current · ' : ''}
                  {formatWorkflowTimestamp(workflow.updated_at)}
                </span>

                <code className="canvas-workflow-panel__item-id">{workflow.workflow_id}</code>

                <div className="canvas-workflow-panel__item-actions">
                  {isRenaming ? (
                    <>
                      <button
                        className="canvas-workflow-panel__button canvas-workflow-panel__button--small canvas-workflow-panel__button--accent"
                        onClick={() => void handleRename(workflow.workflow_id)}
                        type="button"
                      >
                        Save
                      </button>
                      <button
                        className="canvas-workflow-panel__button canvas-workflow-panel__button--small"
                        onClick={cancelRename}
                        type="button"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="canvas-workflow-panel__button canvas-workflow-panel__button--small"
                        onClick={() => onOpenWorkflow?.(workflow.workflow_id)}
                        type="button"
                      >
                        Open
                      </button>
                      <button
                        className="canvas-workflow-panel__button canvas-workflow-panel__button--small"
                        onClick={() => startRename(workflow)}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        className="canvas-workflow-panel__button canvas-workflow-panel__button--small"
                        disabled={isArchiving || isCurrent}
                        onClick={() => void handleArchive(workflow)}
                        type="button"
                      >
                        {isCurrent ? 'Current' : isArchiving ? 'Archiving…' : 'Archive'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function CanvasIntegrationsPanel({ activeWorkspace }) {
  const [connectionState, setConnectionState] = useState({
    connections: [],
    error: '',
    status: 'loading'
  });
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const googleEnabled = Boolean(GOOGLE_CLIENT_ID);
  const { isReady: isGoogleReady, requestCode: requestGoogleCode } = useGoogleCodeClient({
    clientId: GOOGLE_CLIENT_ID,
    enabled: googleEnabled && Boolean(activeWorkspace?.workspace_id),
    onCode: async (code) => {
      setConnectionState((current) => ({
        ...current,
        error: ''
      }));
      setIsConnectingGmail(true);

      try {
        const response = await connectWorkspaceGmail(activeWorkspace.workspace_id, code);
        setConnectionState((current) => ({
          connections: upsertWorkspaceConnectionList(current.connections, response.connection),
          error: '',
          status: 'ready'
        }));
        emitWorkspaceConnectionsUpdated(activeWorkspace.workspace_id, response.connection);
        setIsAddMenuOpen(false);
      } catch (error) {
        setConnectionState((current) => ({
          ...current,
          error: error.message ?? 'Unable to connect Gmail.',
          status: current.status === 'ready' ? 'ready' : 'error'
        }));
      } finally {
        setIsConnectingGmail(false);
      }
    },
    onError: (message) => {
      setConnectionState((current) => ({
        ...current,
        error: message,
        status: current.status === 'ready' ? 'ready' : 'error'
      }));
      setIsConnectingGmail(false);
    },
    scope: 'openid email profile https://www.googleapis.com/auth/gmail.send'
  });

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceConnections() {
      setConnectionState((current) => ({
        connections: current.connections,
        error: '',
        status: current.connections.length ? 'refreshing' : 'loading'
      }));

      try {
        const response = await getWorkspaceConnections(activeWorkspace.workspace_id);
        if (!cancelled) {
          setConnectionState({
            connections: sortWorkspaceConnectionsByMostRecent(response.connections ?? []),
            error: '',
            status: 'ready'
          });
        }
      } catch (error) {
        if (!cancelled) {
          setConnectionState({
            connections: [],
            error: error.message ?? 'Unable to load integrations.',
            status: 'error'
          });
        }
      }
    }

    void loadWorkspaceConnections();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.workspace_id]);

  function handleCreateConnector(template) {
    if (template.kind !== 'gmail') {
      return;
    }

    setConnectionState((current) => ({
      ...current,
      error: ''
    }));
    setIsConnectingGmail(true);
    requestGoogleCode();
  }

  return (
    <aside className="canvas-integrations-panel" aria-label="Integrations window">
      <header className="canvas-integrations-panel__header">
        <div className="canvas-integrations-panel__title-group">
          <span className="canvas-integrations-panel__title-icon" aria-hidden="true">
            <CanvasMenuIcon kind="connections" />
          </span>
          <div className="canvas-integrations-panel__title-copy">
            <strong>Integrations</strong>
            <span>{activeWorkspace.name} · external accounts</span>
          </div>
        </div>

        <div className="canvas-integrations-panel__header-actions">
          <button
            aria-label="New integration"
            className="canvas-integrations-panel__add"
            aria-expanded={isAddMenuOpen}
            onClick={() => setIsAddMenuOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true">+</span>
            <span className="canvas-integrations-panel__tooltip" role="tooltip">
              New Integration
            </span>
          </button>
        </div>
      </header>

      <div
        className={`canvas-integrations-panel__flyout${isAddMenuOpen ? ' is-open' : ''}`}
        aria-hidden={!isAddMenuOpen}
      >
        <div className="canvas-integrations-panel__flyout-list">
          {INTEGRATION_PLACEHOLDERS.map((integration) => {
            const isGmail = integration.kind === 'gmail';
            const isDisabled = !isGmail || !googleEnabled || !isGoogleReady || isConnectingGmail;

            return (
              <button
                className="canvas-integrations-panel__flyout-item"
                disabled={isDisabled}
                key={integration.kind}
                onClick={() => handleCreateConnector(integration)}
                type="button"
              >
                <span className="canvas-integrations-panel__service" aria-hidden="true">
                  {connectorSymbolLabel(integration)}
                </span>
                <span className="canvas-integrations-panel__flyout-label">
                  {isGmail && isConnectingGmail ? 'Connecting Gmail…' : integration.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="canvas-integrations-panel__table" aria-label="Integrations table">
        <header className="canvas-integrations-panel__table-header">
          <span className="canvas-integrations-panel__cell">Type</span>
          <span className="canvas-integrations-panel__cell">Name</span>
          <span className="canvas-integrations-panel__cell">Created at</span>
          <span className="canvas-integrations-panel__cell">Comment</span>
        </header>

        <div className="canvas-integrations-panel__table-body">
          {connectionState.status === 'loading' ? (
            <div className="canvas-integrations-panel__empty">Loading integrations…</div>
          ) : connectionState.connections.length ? (
            connectionState.connections.map((connection) => (
              <div className="canvas-integrations-panel__row" key={connection.connection_id}>
                <span className="canvas-integrations-panel__cell">
                  <span className="canvas-integrations-panel__service" aria-hidden="true">
                    {connectorSymbolLabel(connection)}
                  </span>
                </span>
                <span className="canvas-integrations-panel__cell canvas-integrations-panel__cell--name">
                  {connection.display_name}
                </span>
                <span className="canvas-integrations-panel__cell canvas-integrations-panel__cell--muted">
                  {formatWorkflowTimestamp(connection.created_at)}
                </span>
                <span className="canvas-integrations-panel__cell canvas-integrations-panel__cell--comment">
                  {connection.comment ?? connection.external_account_label ?? '—'}
                </span>
              </div>
            ))
          ) : (
            <div className="canvas-integrations-panel__empty">
              {connectionState.error || 'No integrations added yet.'}
            </div>
          )}
        </div>
      </section>

      {connectionState.error && connectionState.connections.length ? (
        <p className="canvas-integrations-panel__error">{connectionState.error}</p>
      ) : null}
    </aside>
  );
}

function CanvasDataPanel({ activeWorkspace, workspaces = [] }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [editorQuery, setEditorQuery] = useState('');
  const [editorPaneHeight, setEditorPaneHeight] = useState(DATA_PANEL_EDITOR_DEFAULT_HEIGHT);
  const [isEditorOverflowing, setIsEditorOverflowing] = useState(false);
  const [isEditorResizing, setIsEditorResizing] = useState(false);
  const [treeQuery, setTreeQuery] = useState('');
  const [overviewQuery, setOverviewQuery] = useState('');
  const [expandedCatalogKeys, setExpandedCatalogKeys] = useState([]);
  const [expandedSchemaKeys, setExpandedSchemaKeys] = useState([]);
  const [catalogState, setCatalogState] = useState({
    error: '',
    status: 'loading',
    catalogs: []
  });
  const [selection, setSelection] = useState(null);
  const [schemaDetailState, setSchemaDetailState] = useState({
    error: '',
    status: 'idle',
    detail: null
  });
  const [tableDetailState, setTableDetailState] = useState({
    error: '',
    status: 'idle',
    detail: null,
    selectionKey: ''
  });
  const [queryState, setQueryState] = useState({
    error: '',
    result: null,
    selectionKey: '',
    status: 'idle'
  });
  const [deletingTableKey, setDeletingTableKey] = useState('');
  const workspaceScopeKey = workspaces.map((workspace) => workspace.workspace_id).join(':');
  const explorerMainRef = useRef(null);
  const editorSurfaceRef = useRef(null);
  const editorTextareaRef = useRef(null);
  const latestQueryRequestId = useRef(0);
  const lastSeededTableKeyRef = useRef('');
  const editorResizeRef = useRef(null);

  function measureExplorerMainHeight() {
    return explorerMainRef.current?.getBoundingClientRect().height ?? 0;
  }

  function updateEditorPaneHeight(nextHeight) {
    setEditorPaneHeight((current) => {
      const measuredHeight = measureExplorerMainHeight();
      const fallbackHeight = measuredHeight
        || current + DATA_PANEL_RESIZER_HEIGHT + DATA_PANEL_BOTTOM_MIN_HEIGHT;
      return clampCanvasDataEditorHeight(nextHeight, fallbackHeight);
    });
  }

  function syncEditorOverflowState() {
    const textarea = editorTextareaRef.current;
    const surface = editorSurfaceRef.current;
    if (!textarea || !surface) {
      setIsEditorOverflowing(false);
      return;
    }

    const availableHeight = surface.clientHeight;

    textarea.style.height = 'auto';
    textarea.style.overflowY = 'hidden';
    const naturalHeight = textarea.scrollHeight;
    const fits = naturalHeight <= availableHeight + 1;

    if (fits) {
      textarea.style.height = `${naturalHeight}px`;
      textarea.style.overflowY = 'hidden';
      textarea.scrollTop = 0;
    } else {
      textarea.style.height = '100%';
      textarea.style.overflowY = 'auto';
    }

    setIsEditorOverflowing(!fits);
  }

  async function executeCatalogQuery(nextSelection, nextQuery, { activateSample = false } = {}) {
    if (!nextSelection || nextSelection.kind !== 'table') {
      return;
    }

    const selectionKey = buildCatalogTableSelectionKey(
      nextSelection.workspaceId,
      nextSelection.workflowId,
      nextSelection.schemaName,
      nextSelection.tableName
    );
    const requestId = latestQueryRequestId.current + 1;
    latestQueryRequestId.current = requestId;
    if (activateSample) {
      setActiveTab('sample_data');
    }
    setQueryState({
      error: '',
      result: null,
      selectionKey,
      status: 'loading'
    });

    try {
      const result = await runWorkspaceCatalogQuery(
        nextSelection.workspaceId,
        nextSelection.workflowId,
        nextQuery
      );
      if (latestQueryRequestId.current !== requestId) {
        return;
      }

      setQueryState({
        error: '',
        result,
        selectionKey,
        status: 'ready'
      });
    } catch (error) {
      if (latestQueryRequestId.current !== requestId) {
        return;
      }

      setQueryState({
        error: error.message ?? 'Unable to run the preview query.',
        result: null,
        selectionKey,
        status: 'error'
      });
    }
  }

  async function refreshCatalogs() {
    const results = await Promise.allSettled(
      workspaces.map(async (workspace) => {
        const response = await getWorkspaceCatalog(workspace.workspace_id);
        return (response.catalogs ?? []).map((catalog) =>
          decorateWorkspaceCatalog(workspace, catalog)
        );
      })
    );

    const catalogs = results
      .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      .sort((left, right) => {
        const leftIsActive = left.workspace_id === activeWorkspace.workspace_id;
        const rightIsActive = right.workspace_id === activeWorkspace.workspace_id;
        if (leftIsActive !== rightIsActive) {
          return leftIsActive ? -1 : 1;
        }

        const leftWorkspaceLabel = catalogWorkspaceLabel(left);
        const rightWorkspaceLabel = catalogWorkspaceLabel(right);
        if (leftWorkspaceLabel !== rightWorkspaceLabel) {
          return leftWorkspaceLabel.localeCompare(rightWorkspaceLabel);
        }

        return left.workflow_name.localeCompare(right.workflow_name);
      });

    if (!catalogs.length && results.some((result) => result.status === 'rejected')) {
      setCatalogState({
        error: 'Unable to load workspace catalogs.',
        status: 'error',
        catalogs: []
      });
      setSelection(null);
      return;
    }

    setCatalogState({
      error: '',
      status: 'ready',
      catalogs
    });
    setSelection((current) => resolveCatalogSelection(catalogs, current));
  }

  async function handleDeleteCatalogTable(catalog, schema, table) {
    if (!catalog || !schema || !table?.is_deletable) {
      return;
    }

    const tableKey = buildCatalogTableSelectionKey(
      catalog.workspace_id,
      catalog.workflow_id,
      schema.schema_name,
      table.table_name
    );
    setDeletingTableKey(tableKey);

    try {
      const preview = await previewWorkspaceCatalogTableDelete(
        catalog.workspace_id,
        catalog.workflow_id,
        schema.schema_name,
        table.table_name
      );

      if (!preview.is_deletable) {
        throw new Error(
          preview.protected_reason ?? 'This table cannot be deleted from the catalog tree.'
        );
      }

      const shouldDelete = window.confirm(buildCatalogTableDeleteWarning(preview));
      if (!shouldDelete) {
        return;
      }

      const isDeletedTableSelected =
        selection?.kind === 'table' &&
        selection.workspaceId === catalog.workspace_id &&
        selection.workflowId === catalog.workflow_id &&
        selection.schemaName === schema.schema_name &&
        selection.tableName === table.table_name;

      if (isDeletedTableSelected) {
        setSelection(buildSchemaCatalogSelection(catalog, schema));
        setActiveTab('overview');
        setTableDetailState({
          error: '',
          status: 'idle',
          detail: null,
          selectionKey: ''
        });
        setQueryState({
          error: '',
          result: null,
          selectionKey: '',
          status: 'idle'
        });
      }

      const response = await deleteWorkspaceCatalogTable(
        catalog.workspace_id,
        catalog.workflow_id,
        schema.schema_name,
        table.table_name
      );

      emitWorkspaceWorkflowsInvalidated(
        catalog.workspace_id,
        (response.invalidated_workflows ?? []).map((workflow) => workflow.workflow_id)
      );

      await refreshCatalogs();
    } catch (error) {
      if (typeof window !== 'undefined') {
        window.alert(error.message ?? 'Unable to delete this table.');
      }
    } finally {
      setDeletingTableKey('');
    }
  }

  useEffect(() => {
    setActiveTab('overview');
    setEditorQuery('');
    setEditorPaneHeight(DATA_PANEL_EDITOR_DEFAULT_HEIGHT);
    setIsEditorOverflowing(false);
    setIsEditorResizing(false);
    setTreeQuery('');
    setOverviewQuery('');
    setExpandedCatalogKeys([]);
    setExpandedSchemaKeys([]);
    setSelection(null);
    setSchemaDetailState({
      error: '',
      status: 'idle',
      detail: null
    });
    setTableDetailState({
      error: '',
      status: 'idle',
      detail: null,
      selectionKey: ''
    });
    setQueryState({
      error: '',
      result: null,
      selectionKey: '',
      status: 'idle'
    });
    editorResizeRef.current = null;
    latestQueryRequestId.current += 1;
    lastSeededTableKeyRef.current = '';
  }, [activeWorkspace.workspace_id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    function syncEditorPaneHeight() {
      setEditorPaneHeight((current) =>
        clampCanvasDataEditorHeight(
          current,
          measureExplorerMainHeight()
            || current + DATA_PANEL_RESIZER_HEIGHT + DATA_PANEL_BOTTOM_MIN_HEIGHT
        )
      );
    }

    syncEditorPaneHeight();
    window.addEventListener('resize', syncEditorPaneHeight);
    return () => {
      window.removeEventListener('resize', syncEditorPaneHeight);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let frameId = window.requestAnimationFrame(() => {
      syncEditorOverflowState();
    });

    const surface = editorSurfaceRef.current;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && surface
        ? new ResizeObserver(() => {
          window.cancelAnimationFrame(frameId);
          frameId = window.requestAnimationFrame(() => {
            syncEditorOverflowState();
          });
        })
        : null;
    resizeObserver?.observe(surface);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
    };
  }, [editorPaneHeight, editorQuery, queryState.error, selection?.kind]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      await refreshCatalogs();
      if (cancelled) {
        return;
      }
    }

    setCatalogState((current) => ({
      ...current,
      error: '',
      status: current.catalogs.length ? 'refreshing' : 'loading'
    }));

    hydrate().catch((error) => {
      if (!cancelled) {
        setCatalogState({
          error: error.message ?? 'Unable to load workspace catalogs.',
          status: 'error',
          catalogs: []
        });
        setSelection(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.workspace_id, workspaceScopeKey, workspaces]);

  useEffect(() => {
    if (!selection) {
      return;
    }

    const nextCatalogKey = catalogTreeKey(selection);
    const nextSchemaKey = schemaTreeKey(selection, selection.schemaName);

    setExpandedCatalogKeys((current) =>
      current.includes(nextCatalogKey) ? current : [...current, nextCatalogKey]
    );
    setExpandedSchemaKeys((current) =>
      current.includes(nextSchemaKey) ? current : [...current, nextSchemaKey]
    );
  }, [
    selection?.kind,
    selection?.schemaName,
    selection?.tableName,
    selection?.workspaceId,
    selection?.workflowId
  ]);

  useEffect(() => {
    let cancelled = false;

    setOverviewQuery('');
    setActiveTab((current) =>
      selection?.kind === 'schema' && current === 'sample_data' ? 'overview' : current
    );
    latestQueryRequestId.current += 1;

    if (!selection) {
      setEditorQuery('');
      setSchemaDetailState({
        error: '',
        status: 'idle',
        detail: null
      });
      setTableDetailState({
        error: '',
        status: 'idle',
        detail: null,
        selectionKey: ''
      });
      setQueryState({
        error: '',
        result: null,
        selectionKey: '',
        status: 'idle'
      });
      lastSeededTableKeyRef.current = '';
      return () => {
        cancelled = true;
      };
    }

    if (selection.kind === 'schema') {
      setEditorQuery('');
      setTableDetailState({
        error: '',
        status: 'idle',
        detail: null,
        selectionKey: ''
      });
      setSchemaDetailState({
        error: '',
        status: 'loading',
        detail: null
      });
      setQueryState({
        error: '',
        result: null,
        selectionKey: '',
        status: 'idle'
      });
      lastSeededTableKeyRef.current = '';

      getWorkspaceCatalogSchema(
        selection.workspaceId,
        selection.workflowId,
        selection.schemaName
      )
        .then((detail) => {
          if (!cancelled) {
            setSchemaDetailState({
              error: '',
              status: 'ready',
              detail
            });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSchemaDetailState({
              error: error.message ?? 'Unable to load schema details.',
              status: 'error',
              detail: null
            });
          }
        });
    } else {
      const tableSelectionKey = buildCatalogTableSelectionKey(
        selection.workspaceId,
        selection.workflowId,
        selection.schemaName,
        selection.tableName
      );
      setEditorQuery(buildDefaultTablePreviewQuery(selection.schemaName, selection.tableName));
      setSchemaDetailState({
        error: '',
        status: 'idle',
        detail: null
      });
      setTableDetailState({
        error: '',
        status: 'loading',
        detail: null,
        selectionKey: tableSelectionKey
      });
      setQueryState({
        error: '',
        result: null,
        selectionKey: '',
        status: 'idle'
      });
      lastSeededTableKeyRef.current = '';

      getWorkspaceCatalogTable(
        selection.workspaceId,
        selection.workflowId,
        selection.schemaName,
        selection.tableName
      )
        .then((detail) => {
          if (!cancelled) {
            setTableDetailState({
              error: '',
              status: 'ready',
              detail,
              selectionKey: tableSelectionKey
            });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setTableDetailState({
              error: error.message ?? 'Unable to load table details.',
              status: 'error',
              detail: null,
              selectionKey: tableSelectionKey
            });
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    selection?.kind,
    selection?.workspaceId,
    selection?.schemaName,
    selection?.tableName,
    selection?.workflowId
  ]);

  const selectedTableKey =
    selection?.kind === 'table'
      ? buildCatalogTableSelectionKey(
        selection.workspaceId,
        selection.workflowId,
        selection.schemaName,
        selection.tableName
      )
      : '';

  const isSelectedTableDetailCurrent =
    selection?.kind === 'table' &&
    tableDetailState.status === 'ready' &&
    tableDetailState.selectionKey === selectedTableKey;

  useEffect(() => {
    if (
      !selectedTableKey ||
      selection?.kind !== 'table' ||
      !isSelectedTableDetailCurrent ||
      !tableDetailState.detail
    ) {
      return;
    }

    if (lastSeededTableKeyRef.current === selectedTableKey) {
      return;
    }

    const nextQuery = buildDefaultTablePreviewQuery(
      selection.schemaName,
      selection.tableName,
      tableDetailState.detail.columns ?? []
    );
    lastSeededTableKeyRef.current = selectedTableKey;
    setEditorQuery(nextQuery);
    void executeCatalogQuery(selection, nextQuery);
  }, [
    activeWorkspace.workspace_id,
    isSelectedTableDetailCurrent,
    selectedTableKey,
    selection?.kind,
    selection?.schemaName,
    selection?.tableName,
    tableDetailState.detail,
    tableDetailState.status
  ]);

  const normalizedTreeQuery = treeQuery.trim().toLowerCase();
  const normalizedOverviewQuery = overviewQuery.trim().toLowerCase();
  const selectedSchemaEntry = selection
    ? findCatalogSchemaEntry(catalogState.catalogs, selection)
    : null;
  const selectedTableEntry =
    selection?.kind === 'table'
      ? findCatalogTableEntry(catalogState.catalogs, selection)
      : null;
  const selectedCatalog = selectedTableEntry?.catalog ?? selectedSchemaEntry?.catalog ?? null;
  const selectedSchema = selectedTableEntry?.schema ?? selectedSchemaEntry?.schema ?? null;
  const selectedTableSummary = selectedTableEntry?.table ?? null;
  const schemaTables =
    selection?.kind === 'schema'
      ? schemaDetailState.detail?.tables ?? selectedSchema?.tables ?? []
      : [];
  const tableColumns =
    selection?.kind === 'table' && isSelectedTableDetailCurrent
      ? tableDetailState.detail?.columns ?? []
      : [];
  const queryColumns =
    selection?.kind === 'table' && queryState.selectionKey === selectedTableKey
      ? queryState.result?.columns ?? []
      : [];
  const sampleRows =
    selection?.kind === 'table' && queryState.selectionKey === selectedTableKey
      ? queryState.result?.rows ?? []
      : [];
  const filteredColumns = tableColumns.filter((column) => {
    if (!normalizedOverviewQuery) {
      return true;
    }

    return [
      column.column_name,
      column.data_type,
      column.description ?? '',
      column.nullable ? 'nullable' : 'required'
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedOverviewQuery);
  });
  const filteredSchemaTables = schemaTables.filter((table) => {
    if (!normalizedOverviewQuery) {
      return true;
    }

    return [table.table_name, table.table_type, String(table.column_count)]
      .join(' ')
      .toLowerCase()
      .includes(normalizedOverviewQuery);
  });
  const visibleCatalogs = catalogState.catalogs
    .map((catalog) => {
      const catalogMatches = [
        catalogWorkspaceLabel(catalog),
        catalogWorkflowLabel(catalog),
        catalog.workspace_name ?? '',
        catalog.workflow_name,
        catalog.database_name
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedTreeQuery);
      const visibleSchemas = (catalog.schemas ?? [])
        .map((schema) => {
          const schemaMatches = schema.schema_name
            .toLowerCase()
            .includes(normalizedTreeQuery);
          const matchedTables = (schema.tables ?? []).filter((table) =>
            [table.table_name, table.table_type, String(table.column_count)]
              .join(' ')
              .toLowerCase()
              .includes(normalizedTreeQuery)
          );

          return {
            ...schema,
            isVisible:
              !normalizedTreeQuery ||
              catalogMatches ||
              schemaMatches ||
              matchedTables.length > 0,
            visibleTables:
              !normalizedTreeQuery || catalogMatches || schemaMatches
                ? schema.tables ?? []
                : matchedTables
          };
        })
        .filter((schema) => schema.isVisible);

      return {
        ...catalog,
        isVisible:
          !normalizedTreeQuery || catalogMatches || visibleSchemas.length > 0,
        visibleSchemas
      };
    })
    .filter((catalog) => catalog.isVisible);
  const editorScopeLabel = selectedCatalog
    ? formatCatalogDatabaseLabel(selectedCatalog)
    : 'Select a workflow catalog';
  const isSampleDataEnabled = selection?.kind === 'table';
  const isQueryRunning = queryState.status === 'loading';
  const editorLines = editorLineNumbers(editorQuery);
  const editorPaneMaxHeight = resolveCanvasDataEditorMaxHeight(
    measureExplorerMainHeight()
      || editorPaneHeight + DATA_PANEL_RESIZER_HEIGHT + DATA_PANEL_BOTTOM_MIN_HEIGHT
  );
  const editorMetaLabel =
    selection?.kind === 'table'
      ? queryState.status === 'ready'
        ? `${sampleRows.length} row${sampleRows.length === 1 ? '' : 's'} · ${queryColumns.length} column${queryColumns.length === 1 ? '' : 's'}`
        : isQueryRunning
          ? 'Running preview query…'
          : 'Read-only preview · capped at 1000 rows'
      : 'Select a table to preview up to 1000 rows';
  const editorPlaceholder =
    selection?.kind === 'table'
      ? 'Write a read-only SELECT query for this workflow DuckDB.'
      : 'Select a table from the catalog tree to start previewing data.';

  function handleRunQuery() {
    if (!selection || selection.kind !== 'table' || !isSelectedTableDetailCurrent) {
      return;
    }

    void executeCatalogQuery(selection, editorQuery, { activateSample: true });
  }

  function handleEditorResizerPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    const measuredHeight = measureExplorerMainHeight();
    const containerHeight = measuredHeight
      || editorPaneHeight + DATA_PANEL_RESIZER_HEIGHT + DATA_PANEL_BOTTOM_MIN_HEIGHT;
    const clampedHeight = clampCanvasDataEditorHeight(editorPaneHeight, containerHeight);

    editorResizeRef.current = {
      pointerId: event.pointerId,
      startHeight: clampedHeight,
      startY: event.clientY
    };
    setIsEditorResizing(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleEditorResizerPointerMove(event) {
    const session = editorResizeRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const delta = event.clientY - session.startY;
    updateEditorPaneHeight(session.startHeight + delta);
  }

  function finishEditorResize(event) {
    const session = editorResizeRef.current;
    if (event && session && session.pointerId !== event.pointerId) {
      return;
    }

    editorResizeRef.current = null;
    setIsEditorResizing(false);
  }

  function handleEditorResizerKeyDown(event) {
    let nextHeight = editorPaneHeight;

    if (event.key === 'ArrowUp') {
      nextHeight -= 24;
    } else if (event.key === 'ArrowDown') {
      nextHeight += 24;
    } else if (event.key === 'PageUp') {
      nextHeight -= 88;
    } else if (event.key === 'PageDown') {
      nextHeight += 88;
    } else if (event.key === 'Home') {
      nextHeight = DATA_PANEL_EDITOR_MIN_HEIGHT;
    } else if (event.key === 'End') {
      nextHeight = editorPaneMaxHeight;
    } else {
      return;
    }

    event.preventDefault();
    updateEditorPaneHeight(nextHeight);
  }

  function toggleCatalogOpen(catalog) {
    const nextKey = catalogTreeKey(catalog);
    setExpandedCatalogKeys((current) =>
      current.includes(nextKey)
        ? current.filter((key) => key !== nextKey)
        : [...current, nextKey]
    );
  }

  function toggleSchemaOpen(catalog, schema) {
    const nextKey = schemaTreeKey(catalog, schema.schema_name);
    setExpandedSchemaKeys((current) =>
      current.includes(nextKey)
        ? current.filter((key) => key !== nextKey)
        : [...current, nextKey]
    );
  }

  return (
    <aside className="canvas-data-panel" aria-label="Data sources window">
      <header className="canvas-data-panel__header">
        <div className="canvas-data-panel__title-group">
          <span className="canvas-data-panel__title-icon" aria-hidden="true">
            <CanvasMenuIcon kind="data" />
          </span>
          <div className="canvas-data-panel__title-copy">
            <strong>Catalog</strong>
            <span>
              {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'} · local DuckDB browser
            </span>
          </div>
        </div>

        <div className="canvas-data-panel__header-actions">
          <button className="canvas-data-panel__button" type="button">Attach DB</button>
          <button className="canvas-data-panel__button canvas-data-panel__button--primary" type="button">
            New Sink
          </button>
        </div>
      </header>

      <div className="canvas-data-panel__workbench">
        <section className="canvas-data-panel__tree" aria-label="Catalog tree">
          <div className="canvas-data-panel__tree-top">
            <div className="canvas-data-panel__section-header">
              <div>
                <h3 className="canvas-data-panel__section-title">Catalog Tree</h3>
                <p className="canvas-data-panel__section-meta">Databases, schemas, and objects</p>
              </div>

              <div className="canvas-data-panel__icon-group" aria-label="Tree actions">
                <button className="canvas-data-panel__icon-button" type="button" aria-label="Settings">
                  <CanvasDataToolbarIcon kind="settings" />
                </button>
                <button
                  className="canvas-data-panel__icon-button"
                  type="button"
                  aria-label="Refresh"
                  onClick={() => {
                    setCatalogState((current) => ({
                      ...current,
                      error: '',
                      status: current.catalogs.length ? 'refreshing' : 'loading'
                    }));
                    void refreshCatalogs();
                  }}
                >
                  <CanvasDataToolbarIcon kind="refresh" />
                </button>
                <button className="canvas-data-panel__icon-button" type="button" aria-label="Add">
                  <CanvasDataToolbarIcon kind="add" />
                </button>
              </div>
            </div>

            <label className="canvas-data-panel__search">
              <input
                aria-label="Search catalog objects"
                onChange={(event) => setTreeQuery(event.target.value)}
                placeholder="Type to search..."
                type="search"
                value={treeQuery}
              />
              <button className="canvas-data-panel__icon-button canvas-data-panel__icon-button--search" type="button" aria-label="Catalog filters">
                <CanvasDataToolbarIcon kind="sliders" />
              </button>
            </label>

            <div className="canvas-data-panel__chip-row">
              <button className="canvas-data-panel__chip" type="button">For you</button>
              <button className="canvas-data-panel__chip is-active" type="button">All</button>
              <button className="canvas-data-panel__chip" type="button">Recent</button>
            </div>
          </div>

          <div className="canvas-data-panel__tree-list" role="tree" aria-label="Catalog hierarchy">
            {catalogState.status === 'loading' && !catalogState.catalogs.length ? (
              <div className="canvas-data-panel__tree-empty">Loading workspace catalog…</div>
            ) : null}

            {catalogState.status === 'error' ? (
              <div className="canvas-data-panel__tree-empty">{catalogState.error}</div>
            ) : null}

            {catalogState.status !== 'loading' && catalogState.status !== 'error' && visibleCatalogs.length
              ? visibleCatalogs.map((catalog) => {
                const catalogKey = catalogTreeKey(catalog);
                const isCatalogOpen =
                  normalizedTreeQuery.length > 0 || expandedCatalogKeys.includes(catalogKey);

                return (
                  <div key={`${catalog.workspace_id}:${catalog.workflow_id}`}>
                    <div className="canvas-data-panel__tree-row canvas-data-panel__tree-row--level-0">
                      <button
                        aria-label={`${
                          isCatalogOpen ? 'Collapse' : 'Expand'
                        } catalog ${formatCatalogDatabaseLabel(catalog)}`}
                        className="canvas-data-panel__tree-toggle"
                        onClick={() => toggleCatalogOpen(catalog)}
                        type="button"
                      >
                        <span className="canvas-data-panel__tree-caret" aria-hidden="true">
                          {isCatalogOpen ? '▾' : '▸'}
                        </span>
                      </button>
                      <button
                        className="canvas-data-panel__tree-item"
                        type="button"
                        role="treeitem"
                        aria-expanded={isCatalogOpen}
                        onClick={() => {
                          if (!catalog.schemas?.length) {
                            return;
                          }

                          setSelection(buildSchemaCatalogSelection(catalog, catalog.schemas[0]));
                          setActiveTab('overview');
                        }}
                      >
                        <span className="canvas-data-panel__tree-glyph" aria-hidden="true">
                          <CanvasDataTreeGlyph kind="database" />
                        </span>
                        <span className="canvas-data-panel__tree-label">
                          {formatCatalogDatabaseLabel(catalog)}
                        </span>
                      </button>
                    </div>

                    {isCatalogOpen
                      ? catalog.visibleSchemas.map((schema) => {
                        const schemaKey = schemaTreeKey(catalog, schema.schema_name);
                        const isSchemaSelected =
                            selection?.kind === 'schema' &&
                            selection.workspaceId === catalog.workspace_id &&
                            selection.workflowId === catalog.workflow_id &&
                            selection.schemaName === schema.schema_name;
                        const isSchemaOpen =
                            normalizedTreeQuery.length > 0 ||
                            expandedSchemaKeys.includes(schemaKey);

                        return (
                          <div key={`${catalog.workspace_id}:${catalog.workflow_id}:${schema.schema_name}`}>
                            <div className="canvas-data-panel__tree-row canvas-data-panel__tree-row--level-1">
                              <button
                                aria-label={`${isSchemaOpen ? 'Collapse' : 'Expand'} schema ${schema.schema_name}`}
                                className="canvas-data-panel__tree-toggle"
                                onClick={() => toggleSchemaOpen(catalog, schema)}
                                type="button"
                              >
                                <span className="canvas-data-panel__tree-caret" aria-hidden="true">
                                  {isSchemaOpen ? '▾' : '▸'}
                                </span>
                              </button>
                              <button
                                className={`canvas-data-panel__tree-item${
                                  isSchemaSelected ? ' is-active' : ''
                                }`}
                                onClick={() => {
                                  setSelection(buildSchemaCatalogSelection(catalog, schema));
                                  setActiveTab('overview');
                                }}
                                type="button"
                                role="treeitem"
                                aria-expanded={isSchemaOpen}
                              >
                                <span className="canvas-data-panel__tree-glyph" aria-hidden="true">
                                  <CanvasDataTreeGlyph kind="schema" />
                                </span>
                                <span className="canvas-data-panel__tree-label">
                                  {schema.schema_name}
                                </span>
                              </button>
                            </div>

                            {isSchemaOpen
                              ? schema.visibleTables.map((table) => {
                                const isTableSelected =
                                      selection?.kind === 'table' &&
                                      selection.workspaceId === catalog.workspace_id &&
                                      selection.workflowId === catalog.workflow_id &&
                                      selection.schemaName === schema.schema_name &&
                                      selection.tableName === table.table_name;
                                const tableSelectionKey = buildCatalogTableSelectionKey(
                                  catalog.workspace_id,
                                  catalog.workflow_id,
                                  schema.schema_name,
                                  table.table_name
                                );
                                const isDeletingTable = deletingTableKey === tableSelectionKey;

                                return (
                                  <div
                                    key={`${catalog.workspace_id}:${catalog.workflow_id}:${schema.schema_name}:${table.table_name}`}
                                  >
                                    <div className="canvas-data-panel__tree-leaf-row">
                                      <button
                                        className={`canvas-data-panel__tree-item canvas-data-panel__tree-item--level-2${
                                          isTableSelected ? ' is-active' : ''
                                        }`}
                                        onClick={() => {
                                          setSelection(
                                            buildTableCatalogSelection(catalog, schema, table)
                                          );
                                        }}
                                        role="treeitem"
                                        type="button"
                                      >
                                        <span className="canvas-data-panel__tree-glyph" aria-hidden="true">
                                          <CanvasDataTreeGlyph kind="table" />
                                        </span>
                                        <span className="canvas-data-panel__tree-label">
                                          {table.table_name}
                                        </span>
                                      </button>
                                      {table.is_deletable ? (
                                        <button
                                          aria-label={`Delete table ${schema.schema_name}.${table.table_name}`}
                                          className="canvas-data-panel__tree-action"
                                          disabled={isDeletingTable}
                                          onClick={() => {
                                            void handleDeleteCatalogTable(catalog, schema, table);
                                          }}
                                          type="button"
                                        >
                                          <CanvasDataToolbarIcon kind="trash" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })
                              : null}
                          </div>
                        );
                      })
                      : null}
                  </div>
                );
              })
              : null}

            {catalogState.status !== 'loading' &&
            catalogState.status !== 'error' &&
            !visibleCatalogs.length ? (
              <div className="canvas-data-panel__tree-empty">
                {normalizedTreeQuery
                  ? 'No matching objects in this workspace catalog.'
                  : 'No workflow DuckDB catalogs are available yet.'}
              </div>
            ) : null}
          </div>
        </section>

        <section className="canvas-data-panel__explorer" aria-label="Catalog explorer">
          <div className="canvas-data-panel__eyebrow">SQL Editor</div>
          <div className="canvas-data-panel__explorer-main" ref={explorerMainRef}>
            <section
              className="canvas-data-panel__editor"
              aria-label="SQL editor"
              style={{ flexBasis: `${editorPaneHeight}px` }}
            >
              <div className="canvas-data-panel__editor-toolbar">
                <button
                  className="canvas-data-panel__run"
                  disabled={
                    !isSampleDataEnabled ||
                    !isSelectedTableDetailCurrent ||
                    isQueryRunning ||
                    !editorQuery.trim()
                  }
                  onClick={handleRunQuery}
                  type="button"
                >
                  {isQueryRunning ? 'Running…' : 'Run query (1000)'}
                </button>
                <span className="canvas-data-panel__editor-meta">{editorMetaLabel}</span>
                <span className="canvas-data-panel__editor-meta">{editorScopeLabel}</span>
              </div>

              <div className="canvas-data-panel__editor-surface" ref={editorSurfaceRef}>
                <div className="canvas-data-panel__editor-gutter" aria-hidden="true">
                  {editorLines.map((lineNumber) => (
                    <span key={lineNumber}>{lineNumber}</span>
                  ))}
                </div>
                <div className="canvas-data-panel__editor-code">
                  <textarea
                    aria-label="SQL query editor"
                    className={`canvas-data-panel__editor-textarea${
                      isEditorOverflowing ? ' is-scrollable' : ' is-fit'
                    }`}
                    onChange={(event) => setEditorQuery(event.target.value)}
                    placeholder={editorPlaceholder}
                    ref={editorTextareaRef}
                    spellCheck={false}
                    value={editorQuery}
                  />
                </div>
              </div>

              {queryState.status === 'error' ? (
                <div
                  className="canvas-data-panel__editor-feedback canvas-data-panel__editor-feedback--error"
                  role="status"
                >
                  {queryState.error}
                </div>
              ) : null}
            </section>

            <div
              aria-label="Resize query editor"
              aria-orientation="horizontal"
              aria-valuemax={Math.round(editorPaneMaxHeight)}
              aria-valuemin={DATA_PANEL_EDITOR_MIN_HEIGHT}
              aria-valuenow={Math.round(editorPaneHeight)}
              className={`canvas-data-panel__splitter${isEditorResizing ? ' is-active' : ''}`}
              onKeyDown={handleEditorResizerKeyDown}
              onLostPointerCapture={finishEditorResize}
              onPointerCancel={finishEditorResize}
              onPointerDown={handleEditorResizerPointerDown}
              onPointerMove={handleEditorResizerPointerMove}
              onPointerUp={finishEditorResize}
              role="separator"
              tabIndex={0}
            >
              <span className="canvas-data-panel__splitter-line" aria-hidden="true" />
            </div>

            <div className="canvas-data-panel__explorer-body">
              <div className="canvas-data-panel__tabs" role="tablist" aria-label="Data explorer tabs">
                <button
                  className={`canvas-data-panel__tab${activeTab === 'overview' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('overview')}
                  role="tab"
                  aria-selected={activeTab === 'overview'}
                  type="button"
                >
                  Overview
                </button>
                <button
                  className={`canvas-data-panel__tab${activeTab === 'sample_data' ? ' is-active' : ''}`}
                  disabled={!isSampleDataEnabled}
                  onClick={() => setActiveTab('sample_data')}
                  role="tab"
                  aria-selected={activeTab === 'sample_data'}
                  type="button"
                >
                  Sample Data
                </button>
              </div>

              {activeTab === 'overview' ? (
                <section className="canvas-data-panel__overview" aria-label="Table overview">
                  <div className="canvas-data-panel__overview-toolbar">
                    <label className="canvas-data-panel__overview-search">
                      <span className="canvas-data-panel__overview-search-icon" aria-hidden="true">
                        <CanvasDataToolbarIcon kind="search" />
                      </span>
                      <input
                        aria-label="Filter columns"
                        onChange={(event) => setOverviewQuery(event.target.value)}
                        placeholder={
                          selection?.kind === 'schema' ? 'Filter tables...' : 'Filter columns...'
                        }
                        type="search"
                        value={overviewQuery}
                      />
                    </label>
                    <span className="canvas-data-panel__overview-count">
                      {selection?.kind === 'schema'
                        ? `${filteredSchemaTables.length} tables`
                        : `${filteredColumns.length} columns`}
                    </span>
                  </div>

                  {!selection ? (
                    <div className="canvas-data-panel__tree-empty">
                      Select a schema or table from the catalog tree.
                    </div>
                  ) : null}

                  {selection?.kind === 'schema' &&
                  schemaDetailState.status === 'loading' &&
                  !schemaDetailState.detail ? (
                    <div className="canvas-data-panel__tree-empty">Loading schema details…</div>
                  ) : null}

                  {selection?.kind === 'schema' && schemaDetailState.status === 'error' ? (
                    <div className="canvas-data-panel__tree-empty">{schemaDetailState.error}</div>
                  ) : null}

                  {selection?.kind === 'schema' &&
                  schemaDetailState.status !== 'error' &&
                  selection ? (
                    <div className="canvas-data-panel__overview-table">
                      <div className="canvas-data-panel__overview-header">
                        <span>Table</span>
                        <span>Type</span>
                        <span>Columns</span>
                      </div>

                      <div className="canvas-data-panel__overview-body">
                        {filteredSchemaTables.length ? (
                          filteredSchemaTables.map((table) => (
                            <button
                              className="canvas-data-panel__overview-row"
                              key={table.table_name}
                              onClick={() => {
                                if (!selectedCatalog || !selectedSchema) {
                                  return;
                                }

                                setSelection(
                                  buildTableCatalogSelection(selectedCatalog, selectedSchema, table)
                                );
                                setActiveTab('overview');
                              }}
                              type="button"
                            >
                              <span className="canvas-data-panel__overview-cell canvas-data-panel__overview-cell--primary">
                                {table.table_name}
                              </span>
                              <span className="canvas-data-panel__overview-cell">
                                {formatCatalogTableType(table.table_type)}
                              </span>
                              <span className="canvas-data-panel__overview-cell canvas-data-panel__overview-cell--muted">
                                {table.column_count}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="canvas-data-panel__tree-empty">
                            No tables found for this schema.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {selection?.kind === 'table' &&
                  tableDetailState.status === 'loading' &&
                  !tableDetailState.detail ? (
                    <div className="canvas-data-panel__tree-empty">Loading table details…</div>
                  ) : null}

                  {selection?.kind === 'table' && tableDetailState.status === 'error' ? (
                    <div className="canvas-data-panel__tree-empty">{tableDetailState.error}</div>
                  ) : null}

                  {selection?.kind === 'table' && tableDetailState.status !== 'error' ? (
                    <div className="canvas-data-panel__overview-table">
                      <div className="canvas-data-panel__overview-header">
                        <span>Column</span>
                        <span>Type</span>
                        <span>Description</span>
                      </div>

                      <div className="canvas-data-panel__overview-body">
                        {filteredColumns.length ? (
                          filteredColumns.map((column) => (
                            <div className="canvas-data-panel__overview-row" key={column.column_name}>
                              <span className="canvas-data-panel__overview-cell canvas-data-panel__overview-cell--primary">
                                {column.column_name}
                              </span>
                              <span className="canvas-data-panel__overview-cell">
                                {column.data_type}
                              </span>
                              <span className="canvas-data-panel__overview-cell canvas-data-panel__overview-cell--muted">
                                {column.description ?? (column.nullable ? 'Nullable column' : 'Required column')}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="canvas-data-panel__tree-empty">
                            No columns found for this table.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : (
                <section className="canvas-data-panel__sample" aria-label="Sample data preview">
                  <div className="canvas-data-panel__sample-header">
                    <strong>Sample</strong>
                    <div className="canvas-data-panel__sample-actions">
                      <button className="canvas-data-panel__sample-icon" type="button" aria-label="Search sample data">
                        <CanvasDataToolbarIcon kind="search" />
                      </button>
                      <button className="canvas-data-panel__sample-icon" type="button" aria-label="Filter sample data">
                        <CanvasDataToolbarIcon kind="filter" />
                      </button>
                    </div>
                  </div>

                  <div className="canvas-data-panel__sample-shell">
                    {!isSampleDataEnabled ? (
                      <div className="canvas-data-panel__tree-empty">
                        Sample data is available once you select a table.
                      </div>
                    ) : null}

                    {isSampleDataEnabled && tableDetailState.status === 'loading' ? (
                      <div className="canvas-data-panel__tree-empty">Loading sample data…</div>
                    ) : null}

                    {isSampleDataEnabled && tableDetailState.status === 'error' ? (
                      <div className="canvas-data-panel__tree-empty">{tableDetailState.error}</div>
                    ) : null}

                    {isSampleDataEnabled && queryState.status === 'loading' ? (
                      <div className="canvas-data-panel__tree-empty">Running preview query…</div>
                    ) : null}

                    {isSampleDataEnabled && queryState.status === 'error' ? (
                      <div className="canvas-data-panel__tree-empty">{queryState.error}</div>
                    ) : null}

                    {isSampleDataEnabled &&
                    queryState.status === 'ready' &&
                    queryColumns.length ? (
                      <div
                        className="canvas-data-panel__sample-grid"
                        style={{
                          gridTemplateColumns: `56px repeat(${queryColumns.length}, minmax(120px, 1fr))`
                        }}
                      >
                        <span className="canvas-data-panel__sample-header-cell canvas-data-panel__sample-header-cell--index" />
                        {queryColumns.map((column) => (
                          <span
                            className="canvas-data-panel__sample-header-cell"
                            key={column.column_name}
                          >
                            <span className="canvas-data-panel__sample-type">
                              {dataColumnTypeBadge(column.data_type)}
                            </span>
                            {column.column_name}
                          </span>
                        ))}

                        {sampleRows.length
                          ? sampleRows.flatMap((row, index) => [
                            (
                              <span
                                className="canvas-data-panel__sample-index-cell"
                                key={`${selectedTableSummary?.table_name ?? 'sample'}-${index}-index`}
                              >
                                {index + 1}
                              </span>
                            ),
                            ...row.map((value, valueIndex) => (
                              <span
                                className="canvas-data-panel__sample-cell"
                                key={`${selectedTableSummary?.table_name ?? 'sample'}-${index}-${valueIndex}`}
                              >
                                {value ?? 'null'}
                              </span>
                            ))
                          ])
                          : (
                            <div
                              className="canvas-data-panel__tree-empty"
                              style={{ gridColumn: '1 / -1' }}
                            >
                              Query returned no rows for this table.
                            </div>
                          )}
                      </div>
                    ) : null}

                    {isSampleDataEnabled &&
                    queryState.status === 'ready' &&
                    !queryColumns.length ? (
                      <div className="canvas-data-panel__tree-empty">
                        Query completed without a tabular result set.
                      </div>
                    ) : null}
                  </div>
                </section>
              )}
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}

function CanvasRunsHistoryPanel({
  activeWorkflowId = null,
  activeWorkspace,
  onInspectRun,
  onOpenRunControl,
  onOpenWorkflow,
  onSelectedRunIdChange = null,
  selectedRunId: selectedRunIdProp = undefined
}) {
  const [runState, setRunState] = useState({
    error: '',
    runs: [],
    status: 'loading',
    workflows: []
  });
  const [statusFilter, setStatusFilter] = useState('all');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [isLast24hOnly, setIsLast24hOnly] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRunIdInternal, setSelectedRunIdInternal] = useState('');
  const [runDetailState, setRunDetailState] = useState({
    error: '',
    events: [],
    logs: [],
    run: null,
    status: 'idle'
  });
  const [runActionState, setRunActionState] = useState({
    cancel: false
  });
  const panelRef = useRef(null);
  const selectedRunId =
    selectedRunIdProp === undefined ? selectedRunIdInternal : selectedRunIdProp;

  function setSelectedRunId(nextRunId) {
    if (selectedRunIdProp === undefined) {
      setSelectedRunIdInternal(nextRunId);
    }

    onSelectedRunIdChange?.(nextRunId);
  }

  useEffect(() => {
    let cancelled = false;

    setWorkflowFilter('all');
    setSearchQuery('');
    setSelectedRunIdInternal('');
    setRunDetailState({
      error: '',
      events: [],
      logs: [],
      run: null,
      status: 'idle'
    });

    async function loadRunsWindowData() {
      try {
        const [runsResponse, workflowsResponse] = await Promise.all([
          getWorkspaceRuns(activeWorkspace.workspace_id),
          getWorkflows(activeWorkspace.workspace_id)
        ]);

        if (cancelled) {
          return;
        }

        const runs = [...(runsResponse.runs ?? [])].sort((left, right) => {
          const leftTime =
            Date.parse(left.started_at ?? '') ||
            Date.parse(left.finished_at ?? '') ||
            0;
          const rightTime =
            Date.parse(right.started_at ?? '') ||
            Date.parse(right.finished_at ?? '') ||
            0;
          return rightTime - leftTime;
        });
        const workflows = [...(workflowsResponse.workflows ?? [])].sort((left, right) =>
          left.name.localeCompare(right.name)
        );

        setRunState({
          error: '',
          runs,
          status: 'ready',
          workflows
        });
      } catch (error) {
        if (!cancelled) {
          setRunState({
            error: error.message ?? 'Unable to load workspace runs.',
            runs: [],
            status: 'error',
            workflows: []
          });
        }
      }
    }

    setRunState((current) => ({
      ...current,
      error: '',
      status: current.runs.length ? 'refreshing' : 'loading'
    }));

    void loadRunsWindowData();
    const intervalId = window.setInterval(() => {
      void loadRunsWindowData();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeWorkspace.workspace_id]);

  useEffect(() => {
    let cancelled = false;

    async function loadRunDetail() {
      if (!selectedRunId) {
        return;
      }

      const selectedSummaryRun =
        runState.runs.find((run) => run.run_id === selectedRunId) ?? null;

      setRunDetailState((current) => ({
        error: '',
        events:
          current.run?.run_id === selectedRunId && current.events.length ? current.events : [],
        logs: current.run?.run_id === selectedRunId && current.logs.length ? current.logs : [],
        run: selectedSummaryRun ?? current.run,
        status: current.run?.run_id === selectedRunId ? 'refreshing' : 'loading'
      }));

      try {
        const [runResponse, eventsResponse, logsResponse] = await Promise.all([
          getWorkspaceRun(activeWorkspace.workspace_id, selectedRunId),
          getWorkspaceRunEvents(activeWorkspace.workspace_id, selectedRunId),
          getWorkspaceRunLogs(activeWorkspace.workspace_id, selectedRunId)
        ]);

        if (cancelled) {
          return;
        }

        setRunDetailState({
          error: '',
          events: eventsResponse.events ?? [],
          logs: logsResponse.logs ?? [],
          run: runResponse.run ?? selectedSummaryRun,
          status: 'ready'
        });
      } catch (error) {
        if (!cancelled) {
          setRunDetailState((current) => ({
            error: error.message ?? 'Unable to load run detail.',
            events: [],
            logs: [],
            run: current.run,
            status: 'error'
          }));
        }
      }
    }

    void loadRunDetail();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.workspace_id, runState.runs, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || !panelRef.current || typeof panelRef.current.scrollTo !== 'function') {
      return;
    }

    panelRef.current.scrollTo({ top: 0, behavior: 'auto' });
  }, [selectedRunId]);

  const workflowNameById = Object.fromEntries(
    runState.workflows.map((workflow) => [workflow.workflow_id, workflow.name])
  );
  const now = Date.now();
  const last24hThreshold = now - 24 * 60 * 60 * 1000;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const filteredRuns = runState.runs.filter((run) => {
    if (statusFilter === 'success' && run.status !== 'succeeded') {
      return false;
    }

    if (statusFilter === 'failed' && !['failed', 'cancelled'].includes(run.status)) {
      return false;
    }

    if (
      statusFilter === 'in_progress' &&
      !['created', 'queued', 'planning', 'running', 'cancelling'].includes(run.status)
    ) {
      return false;
    }

    if (workflowFilter !== 'all' && run.workflow_id !== workflowFilter) {
      return false;
    }

    if (isLast24hOnly) {
      const runTime =
        Date.parse(run.started_at ?? '') ||
        Date.parse(run.finished_at ?? '') ||
        0;
      if (!runTime || runTime < last24hThreshold) {
        return false;
      }
    }

    if (!normalizedSearchQuery) {
      return true;
    }

    const workflowName = workflowNameById[run.workflow_id] ?? run.workflow_id;
    const searchable = [
      run.run_id,
      run.workflow_name_at_run ?? workflowName,
      run.workflow_id,
      run.error?.message ?? '',
      humanizeRunStatus(run.status)
    ]
      .join(' ')
      .toLowerCase();

    return searchable.includes(normalizedSearchQuery);
  });

  const metrics = summarizeWorkspaceRuns(filteredRuns);
  const averageLatency = metrics.averageDuration;
  const averageLag = '—';
  const selectedRunSummary = selectedRunId
    ? runState.runs.find((run) => run.run_id === selectedRunId) ?? null
    : null;
  const selectedRun = runDetailState.run ?? selectedRunSummary ?? null;
  const isRunDetailOpen = Boolean(selectedRunId);
  const canCancelSelectedRun = isWorkspaceRunCancellable(selectedRun);

  function handleExport() {
    if (typeof window === 'undefined' || !filteredRuns.length) {
      return;
    }

    const exportRows = filteredRuns.map((run) => ({
      run_id: run.run_id,
      workflow_id: run.workflow_id,
      workflow_name:
        run.workflow_name_at_run ?? workflowNameById[run.workflow_id] ?? run.workflow_id,
      status: run.status,
      started_at: run.started_at,
      finished_at: run.finished_at,
      duration_ms: runDurationMs(run),
      error_message: run.error?.message ?? null,
      error_count: countRunErrors(run),
      retry_count: countRunRetries(run)
    }));

    const blob = new Blob([JSON.stringify(exportRows, null, 2)], {
      type: 'application/json'
    });
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `${activeWorkspace.slug}-runs.json`;
    anchor.click();
    window.URL.revokeObjectURL(objectUrl);
  }

  async function handleCancelSelectedRun() {
    if (!selectedRun?.run_id || !canCancelSelectedRun) {
      return;
    }

    setRunActionState({ cancel: true });

    try {
      const response = await cancelWorkspaceRun(activeWorkspace.workspace_id, selectedRun.run_id);
      setRunState((current) => ({
        ...current,
        runs: sortRunsByMostRecent(
          current.runs.map((run) => (run.run_id === response.run.run_id ? response.run : run))
        )
      }));
      setRunDetailState((current) => ({
        ...current,
        run: response.run
      }));
      emitWorkspaceRunUpdated(activeWorkspace.workspace_id, response.run);
    } catch (error) {
      setRunDetailState((current) => ({
        ...current,
        error: error.message ?? 'Unable to cancel run.'
      }));
    } finally {
      setRunActionState({ cancel: false });
    }
  }

  return (
    <aside className="canvas-runs-panel" aria-label="Runs history window" ref={panelRef}>
      <header className="canvas-runs-panel__header">
        <div className="canvas-runs-panel__title-group">
          {isRunDetailOpen ? (
            <button
              className="canvas-runs-panel__back"
              onClick={() => {
                setSelectedRunId('');
                setRunDetailState({
                  error: '',
                  events: [],
                  logs: [],
                  run: null,
                  status: 'idle'
                });
              }}
              type="button"
            >
              <span aria-hidden="true">‹</span>
              <span>Back</span>
            </button>
          ) : null}
          <span className="canvas-runs-panel__title-icon" aria-hidden="true">
            <CanvasMenuIcon kind="runs" />
          </span>
          <div className="canvas-runs-panel__title-copy">
            <strong>{isRunDetailOpen ? 'Run Detail' : 'Runs &amp; Logs'}</strong>
            <span>{isRunDetailOpen ? selectedRun?.run_id ?? activeWorkspace.name : activeWorkspace.name}</span>
          </div>
        </div>

        <div className="canvas-runs-panel__header-actions">
          <button
            className="canvas-runs-panel__run-action"
            onClick={() => onOpenRunControl?.()}
            type="button"
          >
            Run workflow
          </button>

          <button className="canvas-runs-panel__export" onClick={handleExport} type="button">
            Export
            <span aria-hidden="true">▾</span>
          </button>
        </div>
      </header>

      {isRunDetailOpen ? (
        <div className="canvas-runs-panel__detail card-stack">
          {selectedRun ? (
            <div className="canvas-runs-panel__detail-actions">
              <button
                className="canvas-runs-panel__run-action canvas-runs-panel__run-action--danger"
                disabled={!canCancelSelectedRun || runActionState.cancel}
                onClick={() => {
                  void handleCancelSelectedRun();
                }}
                type="button"
              >
                {runActionState.cancel || selectedRun.status === 'cancelling'
                  ? 'Cancelling…'
                  : 'Force stop'}
              </button>
            </div>
          ) : null}

          {runDetailState.status === 'error' ? (
            <div className="canvas-runs-panel__empty">{runDetailState.error}</div>
          ) : null}

          {!selectedRun && runDetailState.status === 'loading' ? (
            <div className="canvas-runs-panel__empty">Loading run detail…</div>
          ) : null}

          {selectedRun ? (
            <>
              <div className="card-metric-grid">
                <div className="card-metric">
                  <span>Status</span>
                  <strong>{humanizeRunStatus(selectedRun.status)}</strong>
                </div>
                <div className="card-metric">
                  <span>Workflow</span>
                  <strong>
                    {selectedRun.workflow_name_at_run ??
                      workflowNameById[selectedRun.workflow_id] ??
                      selectedRun.workflow_id}
                  </strong>
                </div>
                <div className="card-metric">
                  <span>Duration</span>
                  <strong>{formatRunDuration(selectedRun)}</strong>
                </div>
                <div className="card-metric">
                  <span>Retries</span>
                  <strong>{countRunRetries(selectedRun)}</strong>
                </div>
              </div>

              {selectedRun.error?.message ? (
                <section className="canvas-runs-panel__detail-callout">
                  <p>
                    <strong>{humanizeRunStatus(selectedRun.error.category)}</strong>
                    {' · '}
                    {selectedRun.error.message}
                  </p>
                </section>
              ) : null}

              <section className="drawer-section">
                <div className="drawer-section__heading">
                  <span>Run Facts</span>
                </div>
                <div className="drawer-kv-list">
                  <div className="drawer-kv">
                    <span>Run ID</span>
                    <strong>{selectedRun.run_id}</strong>
                  </div>
                  <div className="drawer-kv">
                    <span>Started</span>
                    <strong>{formatRunTimestamp(selectedRun.started_at)}</strong>
                  </div>
                  <div className="drawer-kv">
                    <span>Finished</span>
                    <strong>{formatRunTimestamp(selectedRun.finished_at)}</strong>
                  </div>
                  <div className="drawer-kv">
                    <span>Errors</span>
                    <strong>{countRunErrors(selectedRun)}</strong>
                  </div>
                </div>
              </section>

              <section className="drawer-section">
                <div className="drawer-section__heading">
                  <span>Node States</span>
                </div>
                {selectedRun.node_runs?.length ? (
                  <div className="drawer-list">
                    {selectedRun.node_runs.map((nodeRun) => (
                      <div className="drawer-item" key={nodeRun.node_id}>
                        <span className="drawer-item__icon">N</span>
                        <span className="drawer-item__content">
                          <strong>{nodeRun.node_id}</strong>
                          <span>{summarizeRunNodeDetail(nodeRun)}</span>
                        </span>
                        <span className="drawer-item__badge">{humanizeRunStatus(nodeRun.status)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="drawer-empty">No node state has been captured for this run yet.</p>
                )}
              </section>

              <section className="drawer-section">
                <div className="drawer-section__heading">
                  <span>Recent Events</span>
                </div>
                {runDetailState.events.length ? (
                  <div className="drawer-list">
                    {runDetailState.events.slice().reverse().map((event) => (
                      <div className="drawer-item" key={event.event_id}>
                        <span className="drawer-item__icon">&gt;</span>
                        <span className="drawer-item__content">
                          <strong>{summarizeRunEventTitle(event)}</strong>
                          <span>{summarizeRunEventDetail(event)}</span>
                        </span>
                        <span className="drawer-item__badge">{event.sequence}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="drawer-empty">No persisted events are available for this run yet.</p>
                )}
              </section>

              <section className="drawer-section">
                <div className="drawer-section__heading">
                  <span>Recent Logs</span>
                </div>
                {runDetailState.logs.length ? (
                  <div className="drawer-list">
                    {runDetailState.logs.slice().reverse().map((entry, index) => (
                      <div className="drawer-item" key={`${entry.timestamp}-${index}`}>
                        <span className="drawer-item__icon">{formatRunLogLevel(entry.level)}</span>
                        <span className="drawer-item__content">
                          <strong>{entry.message}</strong>
                          <span>{summarizeRunLogDetail(entry)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="drawer-empty">No persisted logs are available for this run yet.</p>
                )}
              </section>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <div className="canvas-runs-panel__toolbar">
            <div className="canvas-runs-panel__filter-group">
              <button
                className={`canvas-runs-panel__chip${statusFilter === 'all' ? ' is-active' : ''}`}
                onClick={() => setStatusFilter('all')}
                type="button"
              >
                All
              </button>
              <button
                className={`canvas-runs-panel__chip${statusFilter === 'success' ? ' is-active' : ''}`}
                onClick={() => setStatusFilter('success')}
                type="button"
              >
                Success
              </button>
              <button
                className={`canvas-runs-panel__chip${statusFilter === 'failed' ? ' is-active' : ''}`}
                onClick={() => setStatusFilter('failed')}
                type="button"
              >
                Failed
              </button>
              <button
                className={`canvas-runs-panel__chip${statusFilter === 'in_progress' ? ' is-active' : ''}`}
                onClick={() => setStatusFilter('in_progress')}
                type="button"
              >
                In progress
              </button>

              <label className="canvas-runs-panel__chip canvas-runs-panel__chip--select">
                <span>Workflows</span>
                <select
                  aria-label="Workflow filter"
                  onChange={(event) => setWorkflowFilter(event.target.value)}
                  value={workflowFilter}
                >
                  <option value="all">All workflows</option>
                  {runState.workflows.map((workflow) => (
                    <option key={workflow.workflow_id} value={workflow.workflow_id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className={`canvas-runs-panel__chip${isLast24hOnly ? ' is-active' : ''}`}
                onClick={() => setIsLast24hOnly((current) => !current)}
                type="button"
              >
                Last 24h
              </button>

              <button className="canvas-runs-panel__chip" disabled type="button">
                More filters
              </button>
            </div>

            <label className="canvas-runs-panel__search">
              <input
                aria-label="Search runs"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Name, ID, errors..."
                type="search"
                value={searchQuery}
              />
              <span aria-hidden="true">⌕</span>
            </label>
          </div>

          <div className="canvas-runs-panel__kpis">
            <article className="canvas-runs-panel__kpi">
              <span className="canvas-runs-panel__kpi-label">Total runs</span>
              <div className="canvas-runs-panel__kpi-value">
                <strong>{metrics.total}</strong>
                <span>
                  {metrics.succeeded} · {metrics.running} · {metrics.failed}
                </span>
              </div>
            </article>

            <article className="canvas-runs-panel__kpi">
              <span className="canvas-runs-panel__kpi-label">Workflow success</span>
              <div className="canvas-runs-panel__kpi-value">
                <strong>{metrics.successRate}</strong>
                <span className="canvas-runs-panel__kpi-good">
                  {metrics.completedRuns ? `${metrics.completedRuns} done` : 'No completed runs'}
                </span>
              </div>
            </article>

            <article className="canvas-runs-panel__kpi">
              <span className="canvas-runs-panel__kpi-label">Average lag</span>
              <div className="canvas-runs-panel__kpi-value">
                <strong>{averageLag}</strong>
                <span>No queue data</span>
              </div>
            </article>

            <article className="canvas-runs-panel__kpi">
              <span className="canvas-runs-panel__kpi-label">Avg latency</span>
              <div className="canvas-runs-panel__kpi-value">
                <strong>{averageLatency}</strong>
                <span>Runtime</span>
              </div>
            </article>
          </div>

          {runState.status === 'error' ? (
            <div className="canvas-runs-panel__empty">{runState.error}</div>
          ) : null}

          {runState.status !== 'error' && !filteredRuns.length ? (
            <div className="canvas-runs-panel__empty">
              <span>
                {runState.status === 'loading'
                  ? 'Loading workspace runs…'
                  : runState.runs.length
                    ? 'No runs match the current filters.'
                    : 'No runs yet in this workspace.'}
              </span>
              {runState.status !== 'loading' ? (
                <button
                  className="canvas-runs-panel__empty-action"
                  onClick={() => onOpenRunControl?.()}
                  type="button"
                >
                  Run workflow
                </button>
              ) : null}
            </div>
          ) : null}

          {filteredRuns.length ? (
            <section className="canvas-runs-panel__table" aria-label="Runs history table">
              <header className="canvas-runs-panel__table-header">
                <span className="canvas-runs-panel__cell canvas-runs-panel__cell--check">
                  <span className="canvas-runs-panel__checkbox" aria-hidden="true" />
                </span>
                <span className="canvas-runs-panel__cell">Run ID</span>
                <span className="canvas-runs-panel__cell">Started</span>
                <span className="canvas-runs-panel__cell">Workflow</span>
                <span className="canvas-runs-panel__cell">Duration</span>
                <span className="canvas-runs-panel__cell">Status</span>
                <span className="canvas-runs-panel__cell">Error</span>
                <span className="canvas-runs-panel__cell">Errors / Retries</span>
              </header>

              <div className="canvas-runs-panel__table-body">
                {filteredRuns.map((run) => {
                  const statusTone = dashboardStatusTone(run.status);
                  const workflowName =
                    run.workflow_name_at_run ?? workflowNameById[run.workflow_id] ?? run.workflow_id;
                  const errorMessage = run.error?.message ?? 'None';
                  const errorCount = countRunErrors(run);
                  const retryCount = countRunRetries(run);

                  return (
                    <div className="canvas-runs-panel__row" key={run.run_id}>
                      <span className="canvas-runs-panel__cell canvas-runs-panel__cell--check">
                        <span className="canvas-runs-panel__checkbox" aria-hidden="true" />
                      </span>
                      <span className="canvas-runs-panel__cell">
                        <button
                          className="canvas-runs-panel__run-link"
                          onClick={() => {
                            setSelectedRunId(run.run_id);
                          }}
                          type="button"
                        >
                          {shortRunId(run.run_id)}
                        </button>
                      </span>
                      <span className="canvas-runs-panel__cell canvas-runs-panel__cell--muted">
                        {formatRunTimestamp(run.started_at)}
                      </span>
                      <span className="canvas-runs-panel__cell canvas-runs-panel__cell--truncate">
                        <button
                          className={`canvas-runs-panel__workflow-link${
                            run.workflow_id === activeWorkflowId ? ' is-current' : ''
                          }`}
                          onClick={() => onOpenWorkflow?.(run.workflow_id)}
                          type="button"
                        >
                          {workflowName}
                        </button>
                      </span>
                      <span className="canvas-runs-panel__cell">{formatRunDuration(run)}</span>
                      <span className="canvas-runs-panel__cell">
                        <span className={`canvas-runs-panel__status canvas-runs-panel__status--${statusTone}`}>
                          <span className="canvas-runs-panel__status-dot" aria-hidden="true" />
                          {humanizeRunStatus(run.status)}
                        </span>
                      </span>
                      <span
                        className={`canvas-runs-panel__cell canvas-runs-panel__cell--truncate${
                          errorMessage === 'None' ? ' canvas-runs-panel__cell--muted' : ''
                        }`}
                      >
                        {errorMessage}
                      </span>
                      <span className="canvas-runs-panel__cell canvas-runs-panel__cell--muted">
                        <strong>{errorCount}</strong> / {retryCount}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}

function CanvasMenuIcon({ kind }) {
  switch (kind) {
    case 'workspace':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path
            d="M4.6 6.15H8.1L9.2 7.5H15.4V13.85H4.6V6.15Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="miter"
          />
          <path
            d="M4.6 8.3H15.4"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="square"
            opacity="0.8"
          />
        </svg>
      );
    case 'workflows':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="4.1" y="4.1" width="11.8" height="11.8" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7.9 4.3V15.7M12.1 4.3V15.7M4.3 7.9H15.7M4.3 12.1H10.9" stroke="currentColor" strokeWidth="1.15" strokeLinecap="square" opacity="0.8" />
        </svg>
      );
    case 'runs':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="4.2" y="4.85" width="11.6" height="10.3" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M7.05 8.4H12.95M7.05 11.15H10.95"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="square"
            opacity="0.82"
          />
        </svg>
      );
    case 'data':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <ellipse cx="10" cy="5.95" rx="4.85" ry="1.8" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5.15 5.95V12.25C5.15 13.24 7.32 14.05 10 14.05C12.68 14.05 14.85 13.24 14.85 12.25V5.95" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="miter" />
          <path d="M5.15 9.1C5.15 10.09 7.32 10.9 10 10.9C12.68 10.9 14.85 10.09 14.85 9.1" stroke="currentColor" strokeWidth="1.15" strokeLinecap="square" opacity="0.82" />
        </svg>
      );
    case 'connections':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path
            d="M8.25 7.05H7.4C5.77 7.05 4.45 8.37 4.45 10C4.45 11.63 5.77 12.95 7.4 12.95H8.95"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          <path
            d="M11.75 12.95H12.6C14.23 12.95 15.55 11.63 15.55 10C15.55 8.37 14.23 7.05 12.6 7.05H11.05"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          <path
            d="M7.95 10H12.05"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="square"
            opacity="0.82"
          />
        </svg>
      );
    case 'canvas':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="4.15" y="4.15" width="11.7" height="11.7" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 4.2V15.8M12 4.2V15.8M4.2 8H15.8M4.2 12H12" stroke="currentColor" strokeWidth="1.15" strokeLinecap="square" strokeLinejoin="miter" opacity="0.76" />
        </svg>
      );
    case 'trigger':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M10 3.7C6.52 3.7 3.7 6.52 3.7 10C3.7 13.48 6.52 16.3 10 16.3C13.48 16.3 16.3 13.48 16.3 10C16.3 8.92 16.03 7.9 15.55 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
          <path d="M10 6.75V10.05L12.55 11.55" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" strokeLinejoin="miter" />
          <path d="M6.05 4.75L3.95 4.7L4 2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'input':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M10 4.3V11.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
          <path d="M7.55 9.25L10 11.7L12.45 9.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" strokeLinejoin="miter" />
          <path d="M4.95 13.2H15.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
          <path d="M5.45 6.9V14.25C5.45 15.02 6.08 15.65 6.85 15.65H13.15C13.92 15.65 14.55 15.02 14.55 14.25V6.9" stroke="currentColor" strokeWidth="1.15" strokeLinecap="square" opacity="0.76" />
        </svg>
      );
    case 'compute':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M6.35 5.45L3.2 10L6.35 14.55M13.65 5.45L16.8 10L13.65 14.55M11.25 4.15L8.75 15.85" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'data_movement':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M3.95 6.6H12.35" stroke="currentColor" strokeWidth="1.28" strokeLinecap="square" />
          <path d="M10.2 4.45L12.95 6.6L10.2 8.75" stroke="currentColor" strokeWidth="1.28" strokeLinecap="square" strokeLinejoin="miter" />
          <path d="M16.05 13.4H7.65" stroke="currentColor" strokeWidth="1.28" strokeLinecap="square" />
          <path d="M9.8 11.25L7.05 13.4L9.8 15.55" stroke="currentColor" strokeWidth="1.28" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'control':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="4.1" y="4.2" width="2.4" height="2.4" rx="0.45" stroke="currentColor" strokeWidth="1.1" />
          <rect x="13.55" y="5.2" width="2.4" height="2.4" rx="0.45" stroke="currentColor" strokeWidth="1.1" />
          <rect x="13.55" y="12.4" width="2.4" height="2.4" rx="0.45" stroke="currentColor" strokeWidth="1.1" />
          <path d="M6.7 5.4H9.15C10.78 5.4 12.1 6.72 12.1 8.35C12.1 9.98 10.78 11.3 9.15 11.3H7.8C6.42 11.3 5.3 12.42 5.3 13.8V14.55" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" strokeLinejoin="miter" />
          <path d="M12.25 8.35H13.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
        </svg>
      );
    case 'output':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="3.65" y="5.15" width="12.7" height="9.7" rx="1.7" stroke="currentColor" strokeWidth="1.2" opacity="0.82" />
          <path d="M5.95 10H12.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" />
          <path d="M10.2 7.95L12.8 10L10.2 12.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'system':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="5.65" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4.75 10H15.25M10 4.35C8.62 5.9 7.82 7.88 7.78 10C7.82 12.12 8.62 14.1 10 15.65M10 4.35C11.38 5.9 12.18 7.88 12.22 10C12.18 12.12 11.38 14.1 10 15.65" stroke="currentColor" strokeWidth="1.05" strokeLinecap="square" />
        </svg>
      );
    case 'exit':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M7.25 4.55H5.9C5.03 4.55 4.3 5.28 4.3 6.15V13.85C4.3 14.72 5.03 15.45 5.9 15.45H7.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
          <path d="M8.85 10H15.45" stroke="currentColor" strokeWidth="1.28" strokeLinecap="square" />
          <path d="M12.9 7.55L15.35 10L12.9 12.45" stroke="currentColor" strokeWidth="1.28" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    default:
      return null;
  }
}

function CanvasDataTreeGlyph({ kind }) {
  switch (kind) {
    case 'database':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <ellipse cx="10" cy="5.65" rx="5" ry="1.9" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5 5.65V12.95C5 14 7.24 14.85 10 14.85C12.76 14.85 15 14 15 12.95V5.65" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5 9.3C5 10.35 7.24 11.2 10 11.2C12.76 11.2 15 10.35 15 9.3" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      );
    case 'schema':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="4.45" y="4.45" width="11.1" height="11.1" rx="1.7" stroke="currentColor" strokeWidth="1.25" />
          <path d="M7.3 4.7V15.3M12.7 4.7V15.3M4.7 7.3H15.3M4.7 12.7H15.3" stroke="currentColor" strokeWidth="1.1" opacity="0.78" />
        </svg>
      );
    case 'table':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="4.6" y="4.7" width="10.8" height="10.6" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="M4.9 8.05H15.1M8 8.2V15M11.95 8.2V15" stroke="currentColor" strokeWidth="1.1" opacity="0.8" />
        </svg>
      );
    default:
      return null;
  }
}

function CanvasDataToolbarIcon({ kind }) {
  switch (kind) {
    case 'settings':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="2.35" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10 3.6V5.1M10 14.9V16.4M16.4 10H14.9M5.1 10H3.6M14.52 5.48L13.46 6.54M6.54 13.46L5.48 14.52M14.52 14.52L13.46 13.46M6.54 6.54L5.48 5.48" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'refresh':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M15.15 8.2A5.55 5.55 0 1 0 16 11.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" />
          <path d="M15.2 4.95V8.3H11.85" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'add':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M10 4.3V15.7M4.3 10H15.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'sliders':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M5.2 4.35V15.65M10 4.35V15.65M14.8 4.35V15.65" stroke="currentColor" strokeWidth="1.45" strokeLinecap="square" strokeLinejoin="miter" />
          <circle cx="5.2" cy="7.2" r="1.55" fill="currentColor" stroke="none" />
          <circle cx="10" cy="11.1" r="1.55" fill="currentColor" stroke="none" />
          <circle cx="14.8" cy="8.5" r="1.55" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'save':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M5.2 4.75H13.15L15.25 6.85V15.25H5.2V4.75Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="miter" />
          <path d="M7.15 4.95V8.25H12.75V4.95" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
          <path d="M7.35 12.05H13.05" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
        </svg>
      );
    case 'kebab':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="5.3" r="1.15" fill="currentColor" />
          <circle cx="10" cy="10" r="1.15" fill="currentColor" />
          <circle cx="10" cy="14.7" r="1.15" fill="currentColor" />
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <circle cx="8.6" cy="8.6" r="4.9" stroke="currentColor" strokeWidth="1.45" />
          <path d="M12.2 12.2L16.2 16.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'filter':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M3.8 5.1H16.2L11.35 10.55V15.45L8.65 14.15V10.55L3.8 5.1Z" stroke="currentColor" strokeWidth="1.45" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'trash':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M6.1 6.2H13.9L13.3 14.65H6.7L6.1 6.2Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="miter" />
          <path d="M4.9 5.6H15.1M7.8 5.6V4.45H12.2V5.6M8.35 8V12.8M11.65 8V12.8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
        </svg>
      );
    default:
      return null;
  }
}

function dataColumnTypeBadge(type) {
  const normalizedType = String(type).toLowerCase();
  if (normalizedType.includes('char') || normalizedType.includes('text') || normalizedType.includes('varchar')) {
    return 'ABC';
  }

  return '123';
}

function CanvasShelfItemIcon({ groupId, typeId }) {
  switch (typeId) {
    case 'quality_check':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path
            d="M5.1 10.3L8.1 13.3L14.9 6.7"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          <circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'checkpoint_write':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path
            d="M6 4.9H12.5L15 7.4V15.1H6V4.9Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="miter"
          />
          <path
            d="M12.3 5.1V7.6H14.8M7.9 10.25L9.5 11.85L12.35 9"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
      );
    case 'checkpoint_read':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="5.75" stroke="currentColor" strokeWidth="1.35" />
          <path
            d="M10 6.9V10.15L12.35 11.65M6.25 6.85L4.8 8.15M6.25 13.15L4.8 11.85"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="square"
          />
        </svg>
      );
    case 'dolt_repo_source':
    case 'dolt_repo_sync':
    case 'dolt_change_manifest':
    case 'dolt_dump':
    case 'dolt_diff_export':
      return (
        <svg viewBox="0 0 16 16" fill="none">
          <path
            d="M4 16C1.791 16 0 14.209 0 12V8C0 5.791 1.791 4 4 4H6V1.75C6 0.784 6.784 0 7.75 0C8.716 0 9.5 0.784 9.5 1.75V12C9.5 14.209 7.709 16 5.5 16H4ZM4 7.5C3.724 7.5 3.5 7.724 3.5 8V12C3.5 12.276 3.724 12.5 4 12.5H5.5C5.776 12.5 6 12.276 6 12V7.5H4Z"
            fill="currentColor"
          />
        </svg>
      );
    case 'load_to_duckdb':
      return (
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" fill="currentColor" r="8" />
          <circle cx="5.2" cy="8" fill="#f8d106" r="3.1" />
          <path
            d="M10.2 6.5H11.65C12.6777 6.5 13.5 7.32235 13.5 8.35C13.5 9.37765 12.6777 10.2 11.65 10.2H10.2V6.5Z"
            fill="#f8d106"
          />
        </svg>
      );
    case 'preview_output':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M2.8 10C4.48 6.85 7.04 5.28 10 5.28C12.96 5.28 15.52 6.85 17.2 10C15.52 13.15 12.96 14.72 10 14.72C7.04 14.72 4.48 13.15 2.8 10Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="miter" />
          <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.35" />
        </svg>
      );
    case 'file_output':
    case 'file_input':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M6.15 5.4H12.05L14.35 7.7V14.5C14.35 15.16 13.81 15.7 13.15 15.7H6.15C5.49 15.7 4.95 15.16 4.95 14.5V6.6C4.95 5.94 5.49 5.4 6.15 5.4Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="miter" />
          <path d="M11.95 5.55V7.95H14.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'json_output':
    case 'json_input':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M7.4 5.6C6.35 5.6 5.8 6.2 5.8 7.2V8.35C5.8 9.05 5.5 9.45 4.85 9.7C5.5 9.95 5.8 10.35 5.8 11.05V12.2C5.8 13.2 6.35 13.8 7.4 13.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" strokeLinejoin="miter" />
          <path d="M12.6 5.6C13.65 5.6 14.2 6.2 14.2 7.2V8.35C14.2 9.05 14.5 9.45 15.15 9.7C14.5 9.95 14.2 10.35 14.2 11.05V12.2C14.2 13.2 13.65 13.8 12.6 13.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'send_email':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M5 6.2H15C15.72 6.2 16.3 6.78 16.3 7.5V12.5C16.3 13.22 15.72 13.8 15 13.8H5C4.28 13.8 3.7 13.22 3.7 12.5V7.5C3.7 6.78 4.28 6.2 5 6.2Z" stroke="currentColor" strokeWidth="1.35" />
          <path d="M4.25 7.15L9.25 10.5C9.71 10.81 10.29 10.81 10.75 10.5L15.75 7.15" stroke="currentColor" strokeWidth="1.35" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'send_telegram':
    case 'notification':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M16 5.2L13.55 15.35C13.42 15.9 12.88 16.21 12.37 15.99L8.6 14.38L6.55 15.98C6.18 16.27 5.63 16.05 5.58 15.59L5.25 12.55L14.6 6.05C14.83 5.89 14.63 5.53 14.36 5.65L3.85 10.15C3.3 10.39 3.32 11.18 3.89 11.39L5.95 12.13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      );
    case 'text_input':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M5.45 5.7H14.55M10 5.9V14.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="square" />
        </svg>
      );
    case 'table_input':
    case 'table_output':
    case 'table_merge':
      return (
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="4.4" y="4.6" width="11.2" height="10.8" rx="1.3" stroke="currentColor" strokeWidth="1.25" />
          <path d="M4.6 8.35H15.4M8.15 4.8V15.2M11.85 4.8V15.2" stroke="currentColor" strokeWidth="1.15" strokeLinecap="square" />
        </svg>
      );
    default:
      return <CanvasMenuIcon kind={groupId} />;
  }
}

function LoginRoute({ onGoogleLogin, onLogin }) {
  const navigate = useNavigate();
  const [authDraft, setAuthDraft] = useState({
    email: 'builder@stitchly.dev',
    password: 'stitchly'
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const googleEnabled = Boolean(GOOGLE_CLIENT_ID);
  const { isReady: isGoogleReady, requestCode: requestGoogleCode } = useGoogleCodeClient({
    clientId: GOOGLE_CLIENT_ID,
    enabled: googleEnabled,
    onCode: async (code) => {
      setError('');
      setIsGoogleSubmitting(true);

      try {
        const session = await onGoogleLogin(code);
        navigate(getDefaultAppPath(session), { replace: true });
      } catch (requestError) {
        setError(requestError.message ?? 'Unable to sign in with Google.');
      } finally {
        setIsGoogleSubmitting(false);
      }
    },
    onError: (message) => {
      setError(message);
      setIsGoogleSubmitting(false);
    }
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const session = await onLogin(authDraft.email, authDraft.password);
      navigate(getDefaultAppPath(session), { replace: true });
    } catch (requestError) {
      setError(requestError.message ?? 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShellLayout>
      <section className="auth-shell__panel auth-brand-panel">
        <div className="auth-brand-panel__guides" aria-hidden="true" />

        <header className="auth-brand-panel__header">
          <div className="auth-wordmark" aria-label="Stitchly brand">
            <span className="auth-wordmark__brand">Stitchly</span>
            <span className="auth-wordmark__label">Workflow Studio</span>
          </div>
        </header>

        <div className="auth-brand-panel__stage">
          <div className="auth-brand-monument" aria-hidden="true">
            <img
              alt=""
              className="auth-brand-monument__symbol"
              src="/brand/symbol/stitchly-symbol-white.svg"
            />
          </div>
        </div>

        <footer className="auth-brand-panel__footer">
          <span>Build and orchestrate AI workflows with clarity.</span>
          <span>Seeded demo access</span>
        </footer>
      </section>

      <section className="auth-shell__panel auth-form-panel">
        <div className="auth-form-card">
          <div className="auth-form-card__topbar">
            <span className="auth-form-card__topmeta">Create an account</span>
          </div>

          <div className="auth-form-card__content auth-form-card__content--login">
            <h1 className="auth-form-card__title">Log in</h1>

            <button
              className="auth-login-provider"
              disabled={isGoogleSubmitting || isSubmitting}
              onClick={() => {
                setError('');

                if (!googleEnabled) {
                  setError(
                    'Google sign-in is not configured yet. Set VITE_GOOGLE_CLIENT_ID on the web app and the matching Google credentials on the Rust backend.'
                  );
                  return;
                }

                if (canUseDevAuthFallback() || shouldUseDevGoogleAuthFallback()) {
                  setIsGoogleSubmitting(true);
                  void onGoogleLogin('dev-google-auth-code')
                    .then((session) => {
                      navigate(getDefaultAppPath(session), { replace: true });
                    })
                    .catch((requestError) => {
                      setError(requestError.message ?? 'Unable to sign in with Google.');
                    })
                    .finally(() => {
                      setIsGoogleSubmitting(false);
                    });
                  return;
                }

                if (!isGoogleReady) {
                  setError('Google sign-in is still loading.');
                  return;
                }

                setIsGoogleSubmitting(true);
                requestGoogleCode();
              }}
              type="button"
            >
              <span className="auth-login-provider__label">Google</span>
              <span className="auth-login-provider__track">
                <span className="auth-login-provider__value">
                  {isGoogleSubmitting ? 'Opening Google…' : 'Continue with Google'}
                </span>
                <span className="auth-login-provider__icon" aria-hidden="true">
                  <GoogleMarkIcon />
                </span>
              </span>
            </button>

            <div className="auth-login-divider" aria-hidden="true">
              <span className="auth-login-divider__line"></span>
              <span className="auth-login-divider__label">or use your email</span>
              <span className="auth-login-divider__line"></span>
            </div>

            <form className="auth-login-form" onSubmit={handleSubmit}>
              <div className="auth-login-form__row">
                <label className="auth-login-field">
                  <span className="auth-login-field__label">Email</span>
                  <span className="auth-login-field__track">
                    <input
                      autoComplete="username"
                      className="auth-login-field__input"
                      onChange={(event) =>
                        setAuthDraft((current) => ({ ...current, email: event.target.value }))
                      }
                      type="email"
                      value={authDraft.email}
                    />
                  </span>
                </label>

                <label className="auth-login-field">
                  <span className="auth-login-field__label">Password</span>
                  <span className="auth-login-field__track auth-login-field__track--password">
                    <input
                      autoComplete="current-password"
                      className="auth-login-field__input auth-login-field__input--password"
                      onChange={(event) =>
                        setAuthDraft((current) => ({
                          ...current,
                          password: event.target.value
                        }))
                      }
                      type="password"
                      value={authDraft.password}
                    />
                    <span aria-hidden="true" className="auth-login-field__icon" />
                  </span>
                </label>
              </div>

              <div className="auth-login-form__helpers">
                <label className="auth-login-check">
                  <input
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="auth-login-check__circle" aria-hidden="true" />
                  <span>Remember me</span>
                </label>

                <span className="auth-login-link">Forgot?</span>
              </div>

              {error ? <p className="auth-card__error">{error}</p> : null}

              <div className="auth-login-form__spacer" aria-hidden="true" />

              <button
                className="auth-form-card__cta"
                disabled={isSubmitting || isGoogleSubmitting}
                type="submit"
              >
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </AuthShellLayout>
  );
}

function CreateWorkspaceRoute({ onCreateWorkspaceComplete, session }) {
  const navigate = useNavigate();
  const [name, setName] = useState('Default Workspace');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isFirstWorkspace = session.workspaces.length === 0;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await createWorkspace(name);
      await onCreateWorkspaceComplete();
      navigate(`/w/${response.workspace.slug}`, { replace: true });
    } catch (requestError) {
      setError(requestError.message ?? 'Unable to create workspace.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="workspace-setup-screen">
      <div className="workspace-setup-screen__backdrop" />

      <div className="workspace-setup-screen__layout">
        <aside className="workspace-setup-rail" aria-hidden="true">
          <div className="workspace-setup-rail__dock">
            <span className="workspace-setup-rail__brand">
              <img alt="" src="/brand/symbol/stitchly-symbol-mark-white.svg" />
            </span>
            <span className="workspace-setup-rail__divider" />
            <span className="workspace-setup-rail__node">W</span>
          </div>
        </aside>

        <section className="workspace-setup-panel">
          <p className="workspace-setup-panel__eyebrow">Workspace Setup</p>

          <div className="workspace-setup-panel__header">
            <div className="workspace-setup-panel__mark">W</div>
            <div className="workspace-setup-panel__copy">
              <h1>{isFirstWorkspace ? 'Create your first workspace' : 'Create a workspace'}</h1>
              <p>
                {isFirstWorkspace
                  ? 'Start with a real persisted workspace, then open flows, runs, and node settings from the canvas shell.'
                  : 'Add another persisted workspace and switch between separate canvas, flow, and run histories.'}
              </p>
            </div>
          </div>

          <form className="workspace-setup-panel__form" onSubmit={handleSubmit}>
            <label className="workspace-setup-field">
              <span>Workspace name</span>
              <input onChange={(event) => setName(event.target.value)} type="text" value={name} />
            </label>

            {error ? <p className="workspace-setup-panel__error">{error}</p> : null}

            <div className="workspace-setup-panel__footer">
              <span className="workspace-setup-panel__hint">
                This becomes your default canvas home.
              </span>

              <button
                className="workspace-setup-panel__submit"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? 'Creating…' : 'Create Workspace'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <AuthShellLayout>
      <section className="auth-shell__panel auth-brand-panel">
        <div className="auth-brand-panel__guides" aria-hidden="true" />
        <header className="auth-brand-panel__header">
          <div className="auth-wordmark">
            <span className="auth-wordmark__brand">Stitchly</span>
            <span className="auth-wordmark__label">Workflow Studio</span>
          </div>
        </header>
        <div className="auth-brand-panel__stage">
          <div className="auth-brand-monument" aria-hidden="true">
            <img
              alt=""
              className="auth-brand-monument__symbol"
              src="/brand/symbol/stitchly-symbol-white.svg"
            />
          </div>
        </div>
      </section>

      <section className="auth-shell__panel auth-form-panel">
        <div className="auth-form-card">
          <div className="auth-form-card__content auth-form-card__content--loading-state">
            <div className="auth-form-card__intro">
              <p className="auth-form-card__eyebrow">Session bootstrap</p>
              <h1 className="auth-form-card__title">Checking session…</h1>
              <p className="auth-form-card__summary">
                Restoring your backend-authenticated Stitchly shell.
              </p>
            </div>
          </div>
        </div>
      </section>
    </AuthShellLayout>
  );
}

function AuthShellLayout({ children }) {
  return (
    <div className="auth-shell-page">
      <div className="auth-shell-page__backdrop" />
      <main className="auth-shell">{children}</main>
    </div>
  );
}

function WorkflowListScreen({ activeWorkspace }) {
  const navigate = useNavigate();
  const [workflowState, setWorkflowState] = useState({
    error: '',
    status: 'loading',
    workflows: []
  });
  const [createMode, setCreateMode] = useState('');
  const [archiveWorkflowId, setArchiveWorkflowId] = useState('');
  const [renameWorkflowId, setRenameWorkflowId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadWorkflows() {
      try {
        const response = await getWorkflows(activeWorkspace.workspace_id);
        if (cancelled) {
          return;
        }

        setWorkflowState({
          error: '',
          status: 'ready',
          workflows: response.workflows ?? []
        });
      } catch (error) {
        if (!cancelled) {
          setWorkflowState({
            error: error.message ?? 'Unable to load workflows.',
            status: 'error',
            workflows: []
          });
        }
      }
    }

    void loadWorkflows();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.workspace_id]);

  async function handleCreate(mode) {
    setCreateMode(mode);

    try {
      const workflow =
        mode === 'starter'
          ? buildStarterWorkflowDefinition()
          : buildBlankWorkflowDefinition();
      const response = await createWorkflow(activeWorkspace.workspace_id, workflow);
      await updateWorkflowState(
        activeWorkspace.workspace_id,
        response.workflow.workflow_id
      ).catch(() => {});
      navigate(buildWorkflowPath(response.workflow.workflow_id, activeWorkspace.workspace_id));
    } catch (error) {
      setWorkflowState((current) => ({
        ...current,
        error: error.message ?? 'Unable to create workflow.',
        status: current.workflows.length ? 'ready' : 'error'
      }));
    } finally {
      setCreateMode('');
    }
  }

  async function handleOpenWorkflow(workflowId) {
    await updateWorkflowState(activeWorkspace.workspace_id, workflowId).catch(() => {});
    navigate(buildWorkflowPath(workflowId, activeWorkspace.workspace_id));
  }

  function startRename(workflow) {
    setRenameWorkflowId(workflow.workflow_id);
    setRenameDraft(workflow.name);
  }

  function cancelRename() {
    setRenameWorkflowId('');
    setRenameDraft('');
  }

  async function handleRename(workflowId) {
    const nextName = renameDraft.trim();
    if (!nextName) {
      return;
    }

    try {
      const existing = await getWorkflow(activeWorkspace.workspace_id, workflowId);
      const response = await updateWorkflow(activeWorkspace.workspace_id, workflowId, {
        ...existing.definition,
        name: nextName
      });

      setWorkflowState((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.workflow_id === workflowId ? response.workflow : workflow
        )
      }));
      cancelRename();
    } catch (error) {
      setWorkflowState((current) => ({
        ...current,
        error: error.message ?? 'Unable to rename workflow.'
      }));
    }
  }

  async function handleArchive(workflow) {
    const shouldArchive = window.confirm(
      `Archive workflow "${workflow.name}"? You can keep working in this workspace, but this workflow will disappear from the active list.`
    );
    if (!shouldArchive) {
      return;
    }

    setArchiveWorkflowId(workflow.workflow_id);

    try {
      await deleteWorkflow(activeWorkspace.workspace_id, workflow.workflow_id);
      setWorkflowState((current) => ({
        ...current,
        workflows: current.workflows.filter(
          (candidate) => candidate.workflow_id !== workflow.workflow_id
        )
      }));
      if (renameWorkflowId === workflow.workflow_id) {
        cancelRename();
      }
    } catch (error) {
      setWorkflowState((current) => ({
        ...current,
        error: error.message ?? 'Unable to archive workflow.'
      }));
    } finally {
      setArchiveWorkflowId('');
    }
  }

  return (
    <div className="workflow-management">
      <section className="dashboard-section-card workflow-management__hero">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Workspace</span>
          <h2>{activeWorkspace.name}</h2>
          <p>
            Create, open, rename, and archive workflows from one management surface before
            dropping back into the canvas.
          </p>
        </div>

        {workflowState.workflows.length ? (
          <div className="workflow-management__actions">
            <button
              className="accent-button"
              disabled={createMode === 'blank' || createMode === 'starter'}
              onClick={() => handleCreate('blank')}
              type="button"
            >
              {createMode === 'blank' ? 'Creating…' : 'Create Blank Workflow'}
            </button>
            <button
              className="secondary-button"
              disabled={createMode === 'blank' || createMode === 'starter'}
              onClick={() => handleCreate('starter')}
              type="button"
            >
              {createMode === 'starter' ? 'Creating…' : 'Create Starter Workflow'}
            </button>
          </div>
        ) : null}
      </section>

      {workflowState.error ? (
        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Workflow state</span>
            <h2>Unable to complete the last workflow action</h2>
            <p>{workflowState.error}</p>
          </div>
        </section>
      ) : null}

      {workflowState.status === 'loading' ? (
        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Workflows</span>
            <h2>Loading workflows…</h2>
            <p>Fetching the active workflow list for this workspace.</p>
          </div>
        </section>
      ) : null}

      {workflowState.status === 'ready' && !workflowState.workflows.length ? (
        <section className="dashboard-section-card workflow-management__empty">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">No workflows yet</span>
            <h2>Create the first workflow in this workspace</h2>
            <p>
              Start from a blank canvas or use the current starter flow so you can jump straight
              into node design and execution.
            </p>
          </div>
          <div className="workflow-management__actions">
            <button
              className="accent-button"
              disabled={Boolean(createMode)}
              onClick={() => handleCreate('blank')}
              type="button"
            >
              Create Blank Workflow
            </button>
            <button
              className="secondary-button"
              disabled={Boolean(createMode)}
              onClick={() => handleCreate('starter')}
              type="button"
            >
              Create Starter Workflow
            </button>
          </div>
        </section>
      ) : null}

      {workflowState.workflows.length ? (
        <section className="dashboard-table-shell workflow-management__table">
          <div className="workflow-management__table-header">
            <span>Name</span>
            <span>Description</span>
            <span>Updated</span>
            <span>Version</span>
            <span>Actions</span>
          </div>

          {workflowState.workflows.map((workflow) => {
            const isRenaming = renameWorkflowId === workflow.workflow_id;
            const isArchiving = archiveWorkflowId === workflow.workflow_id;

            return (
              <div className="workflow-management__row" key={workflow.workflow_id}>
                <div className="workflow-management__primary">
                  {isRenaming ? (
                    <input
                      autoFocus
                      className="workflow-management__rename-input"
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleRename(workflow.workflow_id);
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                      type="text"
                      value={renameDraft}
                    />
                  ) : (
                    <button
                      className="workflow-management__open-button"
                      onClick={() => handleOpenWorkflow(workflow.workflow_id)}
                      type="button"
                    >
                      <strong>{workflow.name}</strong>
                    </button>
                  )}
                  <span className="workflow-management__id">{workflow.workflow_id}</span>
                </div>
                <span className="workflow-management__description">
                  {workflow.description ?? 'No description yet.'}
                </span>
                <span className="dashboard-cell--muted">
                  {formatWorkflowTimestamp(workflow.updated_at)}
                </span>
                <span>v{workflow.version}</span>
                <div className="workflow-management__row-actions">
                  {isRenaming ? (
                    <>
                      <button
                        className="secondary-button"
                        onClick={() => void handleRename(workflow.workflow_id)}
                        type="button"
                      >
                        Save
                      </button>
                      <button className="secondary-button" onClick={cancelRename} type="button">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="secondary-button"
                        onClick={() => handleOpenWorkflow(workflow.workflow_id)}
                        type="button"
                      >
                        Open
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => startRename(workflow)}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        className="secondary-button workflow-management__archive-button"
                        disabled={isArchiving}
                        onClick={() => void handleArchive(workflow)}
                        type="button"
                      >
                        {isArchiving ? 'Archiving…' : 'Archive'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function OverviewScreen({ activeWorkspace, viewMode }) {
  const navigate = useNavigate();

  return (
    <div className="dashboard-overview">
      <div className="dashboard-kpis">
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Workspace</span>
          <span className="dashboard-kpi__value">{activeWorkspace.name}</span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Shell status</span>
          <span className="dashboard-kpi__value">
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--success">✓</span>
              <span>Protected</span>
            </span>
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Viewport mode</span>
          <span className="dashboard-kpi__value">{viewMode}</span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Next slice</span>
          <span className="dashboard-kpi__value">Persist workflows</span>
        </div>
      </div>

      <div className="dashboard-overview__grid">
        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Launch</span>
            <h2>Start with workflow management</h2>
            <p>
              Open the workflow list, create a new blank or starter flow, and then jump into the
              explicit canvas route for that workflow.
            </p>
          </div>
          <div className="dashboard-section-card__actions">
            <button
              className="accent-button"
              onClick={() => navigate(`/w/${activeWorkspace.slug}/workflows`)}
              type="button"
            >
              Open Workflows
            </button>
          </div>
        </section>

        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Platform</span>
            <h2>Real shell is now active</h2>
            <p>
              This workspace lives behind backend session checks and URL-driven routing instead of
              local-only gate state.
            </p>
          </div>
          <SimpleList
            items={[
              'Backend-owned session bootstrap',
              'Protected workspace routes',
              'Persisted workspace membership',
              'Real login, logout, and workflow management'
            ]}
          />
        </section>

        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Next</span>
            <h2>Natural follow-on work</h2>
            <p>
              Workflow persistence is now real. The next pass can deepen versions, history, and
              richer run detail around each workflow.
            </p>
          </div>
          <SimpleList
            items={[
              'Expose workflow version history',
              'Add restore/archive recovery',
              'Connect workflow cards to run health',
              'Introduce detail routes and shareable deep links'
            ]}
          />
        </section>
      </div>
    </div>
  );
}

function CanvasScreen({
  draggedNodeType = null,
  isFullScreen = false,
  onOpenRunInPanel = null,
  onRegisterCanvasActions = null,
  onWorkflowMissing = null,
  onWorkflowResolved = null,
  viewMode = 'desktop',
  workflowId = null,
  workspaceId
}) {
  const viewportVariant = isFullScreen ? 'canvas-route' : viewMode;

  return (
    <div
      className={`workspace-stage workspace-stage--${isFullScreen ? 'canvas-route' : viewMode}`}
    >
      <div className={`workspace-stage__viewport workspace-stage__viewport--${viewportVariant}`}>
        <CanvasWorkspace
          draggedNodeType={draggedNodeType}
          onOpenRunInPanel={onOpenRunInPanel}
          onRegisterCanvasActions={onRegisterCanvasActions}
          onWorkflowMissing={onWorkflowMissing}
          onWorkflowResolved={onWorkflowResolved}
          workflowId={workflowId}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
}

function RunsScreen({ activeWorkspace }) {
  const [runState, setRunState] = useState({
    error: '',
    runs: [],
    status: 'loading'
  });

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      try {
        const response = await getWorkspaceRuns(activeWorkspace.workspace_id);
        if (!cancelled) {
          setRunState({
            error: '',
            runs: response.runs ?? [],
            status: 'ready'
          });
        }
      } catch (error) {
        if (!cancelled) {
          setRunState({
            error: error.message ?? 'Unable to load runs.',
            runs: [],
            status: 'error'
          });
        }
      }
    }

    void loadRuns();
    const intervalId = window.setInterval(() => {
      void loadRuns();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeWorkspace.workspace_id]);

  const metrics = summarizeWorkspaceRuns(runState.runs);

  return (
    <div className="dashboard-runs">
      <div className="dashboard-toolbar">
        <span className="dashboard-pill">All</span>
        <span className="dashboard-pill dashboard-pill--ghost">{metrics.succeeded} Success</span>
        <span className="dashboard-pill dashboard-pill--ghost">{metrics.failed} Failed</span>
        <span className="dashboard-pill dashboard-pill--ghost">{metrics.running} In progress</span>
        <span className="dashboard-pill">{activeWorkspace.name}</span>
        <span className="dashboard-pill">Last sync</span>
        <span className="dashboard-pill">{humanizeRunLoadState(runState.status)}</span>
        <span className="dashboard-pill dashboard-pill--ghost dashboard-toolbar__search">
          <span>{runState.status === 'loading' ? 'Loading runs…' : 'Workspace runs'}</span>
          <span>{runState.runs.length}</span>
        </span>
      </div>

      <div className="dashboard-kpis">
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Total runs</span>
          <span className="dashboard-kpi__value">
            <span>{metrics.total}</span>
            <span className="dashboard-kpi__divider">|</span>
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--success">✓</span>
              <span>{metrics.succeeded}</span>
            </span>
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--running">•</span>
              <span>{metrics.running}</span>
            </span>
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--failed">×</span>
              <span>{metrics.failed}</span>
            </span>
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Workflow success</span>
          <span className="dashboard-kpi__value">
            <span>{metrics.successRate}</span>
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--success">↗</span>
              <span className="dashboard-kpi__delta dashboard-kpi__delta--up">
                {metrics.completedRuns} done
              </span>
            </span>
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Running now</span>
          <span className="dashboard-kpi__value">{metrics.running}</span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Avg duration</span>
          <span className="dashboard-kpi__value">{metrics.averageDuration}</span>
        </div>
      </div>

      {runState.status === 'error' ? (
        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Runs</span>
            <h2>Unable to load workspace runs</h2>
            <p>{runState.error}</p>
          </div>
        </section>
      ) : null}

      {runState.status === 'ready' && !runState.runs.length ? (
        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Runs</span>
            <h2>No runs for this workspace yet</h2>
            <p>
              Execute a workflow from the canvas to create the first workspace-scoped run entry.
            </p>
          </div>
        </section>
      ) : null}

      {runState.runs.length ? (
        <div className="dashboard-table-shell">
        <div className="dashboard-table-header">
          <span className="dashboard-table-header__lead">
            <span className="dashboard-table-check dashboard-table-check--header" aria-hidden="true" />
            <span>Run ID</span>
          </span>
          <span>Started</span>
          <span>Workflow</span>
          <span>Duration</span>
          <span>Status</span>
          <span>Error</span>
          <span>Errors / Retries</span>
        </div>

        {runState.runs.map((run) => {
          const statusTone = dashboardStatusTone(run.status);
          const duration = formatRunDuration(run);
          const started = formatRunTimestamp(run.started_at);
          const error = run.error?.message ?? 'None';
          const retryCount = countRunRetries(run);
          const errorCount = countRunErrors(run);

          return (
            <div className="dashboard-table-row" key={run.run_id}>
            <span className="dashboard-table-row__lead">
              <span className="dashboard-table-check" aria-hidden="true" />
              <span>{shortRunId(run.run_id)}</span>
            </span>
            <span className="dashboard-cell--muted">{started}</span>
            <span className="dashboard-cell--truncate">{run.workflow_id}</span>
            <span>{duration}</span>
            <span className={`dashboard-status dashboard-status--${statusTone}`}>
              <span className={`dashboard-status__dot dashboard-status__dot--${statusTone}`}>
                {statusTone === 'success' ? '✓' : statusTone === 'failed' ? '×' : 'i'}
              </span>
              {humanizeRunStatus(run.status)}
            </span>
            <span className={error === 'None' ? 'dashboard-cell--muted' : 'dashboard-cell--truncate'}>
              {error}
            </span>
            <span>{`${errorCount} / ${retryCount}`}</span>
          </div>
          );
        })}
      </div>
      ) : null}
    </div>
  );
}

function ConnectionsScreen() {
  return (
    <div className="dashboard-overview__grid">
      <section className="dashboard-section-card">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Connections</span>
          <h2>Connection management scaffold</h2>
          <p>
            This screen gives us a future home for secure references, adapter capabilities, and
            environment-specific bindings.
          </p>
        </div>
        <SimpleList
          items={[
            'Warehouse and database connections',
            'Object store and file staging targets',
            'Notification channel destinations',
            'Capability and permission summaries'
          ]}
        />
      </section>

      <section className="dashboard-section-card">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Security</span>
          <h2>Frontend-safe surface</h2>
          <p>
            The UI here should only show safe metadata and references. Secrets stay in the backend
            and never enter browser state.
          </p>
        </div>
        <MetricGrid
          items={[
            { label: 'Secrets', value: 'Backend only' },
            { label: 'Refs', value: 'Visible' },
            { label: 'Adapters', value: 'Planned' }
          ]}
        />
      </section>
    </div>
  );
}

function SettingsScreen({ activeWorkspace, onSelectViewMode, viewMode }) {
  return (
    <div className="dashboard-overview__grid">
      <section className="dashboard-section-card">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Responsive</span>
          <h2>Viewport mode</h2>
          <p>
            The shell can now switch between desktop and mobile preview modes. This is still a
            scaffold for the responsive pass, not the final mobile UX.
          </p>
        </div>
        <ViewModeToggle currentMode={viewMode} onSelect={onSelectViewMode} />
      </section>

      <section className="dashboard-section-card">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Workspace</span>
          <h2>Current workspace</h2>
          <p>
            Workspaces are now persisted in the backend and attached to the authenticated session.
          </p>
        </div>
        <MetricGrid
          items={[
            { label: 'Name', value: activeWorkspace.name },
            { label: 'Slug', value: activeWorkspace.slug },
            { label: 'Role', value: activeWorkspace.role }
          ]}
        />
      </section>
    </div>
  );
}

function ScreenPanel({ actions = null, children, description, eyebrow, title }) {
  return (
    <section className="screen-panel">
      <div className="screen-panel__header">
        <p>{eyebrow}</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </div>

      <div className="screen-panel__body">{children}</div>

      {actions ? <div className="screen-panel__actions">{actions}</div> : null}
    </section>
  );
}

function MetricGrid({ items }) {
  return (
    <div className="screen-metric-grid">
      {items.map((item) => (
        <div key={item.label} className="screen-metric">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function SimpleList({ items }) {
  return (
    <ul className="screen-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ViewModeToggle({ currentMode, onSelect }) {
  return (
    <div className="view-mode-toggle" role="group" aria-label="Viewport mode">
      {VIEW_MODES.map((mode) => (
        <button
          key={mode.id}
          className={`view-mode-toggle__button${currentMode === mode.id ? ' is-active' : ''}`}
          onClick={() => onSelect(mode.id)}
          type="button"
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function DashboardNavIcon({ screenId }) {
  switch (screenId) {
    case 'workflows':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <rect x="3.35" y="3.35" width="11.3" height="11.3" rx="1.8" stroke="currentColor" strokeWidth="1.35" fill="none" />
          <path d="M7 3.5V14.5M11 3.5V14.5M3.5 7H14.5M3.5 11H10.8" stroke="currentColor" strokeWidth="1.15" strokeLinecap="square" fill="none" opacity="0.82" />
        </svg>
      );
    case 'overview':
      return (
        <img
          alt=""
          className="dashboard-nav-item__icon-image dashboard-nav-item__icon-image--overview"
          src="/brand/symbol/stitchly-symbol-white.svg"
        />
      );
    case 'canvas':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <circle cx="4" cy="4.2" r="2.1" fill="currentColor" />
          <circle cx="14" cy="13.8" r="2.1" fill="currentColor" />
          <path d="M6.7 4.2H10.7C12.1 4.2 13.2 5.3 13.2 6.7C13.2 8.1 12.1 9.2 10.7 9.2H7.3C5.9 9.2 4.8 10.3 4.8 11.7C4.8 13.1 5.9 14.2 7.3 14.2H11.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.9" />
        </svg>
      );
    case 'runs':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <circle cx="4" cy="13.8" r="2.1" fill="currentColor" />
          <circle cx="14" cy="4.2" r="2.1" fill="currentColor" />
          <path d="M6.7 13.8H10.7C12.1 13.8 13.2 12.7 13.2 11.3C13.2 9.9 12.1 8.8 10.7 8.8H7.3C5.9 8.8 4.8 7.7 4.8 6.3C4.8 4.9 5.9 3.8 7.3 3.8H11.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.95" />
        </svg>
      );
    case 'connections':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9" cy="9" r="2.5" fill="currentColor" />
          <circle cx="9" cy="9" r="6.3" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.2 2.8" fill="none" opacity="0.72" />
        </svg>
      );
    case 'settings':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9" cy="9" r="2.2" fill="currentColor" />
          <path d="M9 3.2V4.9M9 13.1V14.8M14.8 9H13.1M4.9 9H3.2M13.3 4.7L12.1 5.9M5.9 12.1L4.7 13.3M13.3 13.3L12.1 12.1M5.9 5.9L4.7 4.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="9" cy="9" r="5.2" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.5" />
        </svg>
      );
    default:
      return null;
  }
}

function UtilityIcon({ kind }) {
  if (kind === 'refresh') {
    return (
      <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
        <path d="M14.2 9A5.2 5.2 0 1 1 12.7 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M10.9 4.1H14.6V7.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.3 5.2H3.8V14.2H12.8V11.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M8.4 9.6L14.6 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.7 3.4H14.6V7.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function summarizeWorkspaceRuns(runs) {
  const total = runs.length;
  const succeeded = runs.filter((run) => run.status === 'succeeded').length;
  const failed = runs.filter((run) =>
    ['failed', 'cancelled'].includes(run.status)
  ).length;
  const running = runs.filter((run) =>
    ['created', 'queued', 'planning', 'running', 'cancelling'].includes(run.status)
  ).length;
  const completedRuns = succeeded + failed;

  const durationValues = runs
    .map((run) => runDurationMs(run))
    .filter((value) => Number.isFinite(value) && value > 0);
  const averageDurationMs = durationValues.length
    ? durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length
    : 0;

  return {
    averageDuration: averageDurationMs ? formatDurationMs(averageDurationMs) : '—',
    completedRuns,
    failed,
    running,
    successRate: completedRuns ? `${((succeeded / completedRuns) * 100).toFixed(1)}%` : '—',
    succeeded,
    total
  };
}

function dashboardStatusTone(status) {
  if (status === 'succeeded') {
    return 'success';
  }

  if (status === 'failed' || status === 'cancelled') {
    return 'failed';
  }

  return 'running';
}

function humanizeRunLoadState(status) {
  if (status === 'loading') {
    return 'Loading';
  }

  if (status === 'error') {
    return 'Offline';
  }

  return 'Live';
}

function humanizeRunStatus(status) {
  if (!status) {
    return 'Unknown';
  }

  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isWorkspaceRunCancellable(run) {
  return ['created', 'queued', 'planning', 'running', 'cancelling'].includes(
    String(run?.status ?? '').toLowerCase()
  );
}

function shortRunId(runId) {
  return runId?.startsWith('run_') ? runId.slice(4) : runId;
}

function formatRunTimestamp(timestamp) {
  if (!timestamp) {
    return '—';
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    second: '2-digit',
    year: 'numeric'
  }).format(value);
}

function formatWorkflowTimestamp(timestamp) {
  if (!timestamp) {
    return '—';
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short'
  }).format(value);
}

function sortWorkspaceConnectionsByMostRecent(connections) {
  return [...(connections ?? [])].sort((left, right) => {
    const leftValue = Date.parse(left?.created_at ?? '');
    const rightValue = Date.parse(right?.created_at ?? '');

    if (Number.isNaN(leftValue) && Number.isNaN(rightValue)) {
      return String(left?.display_name ?? '').localeCompare(String(right?.display_name ?? ''));
    }
    if (Number.isNaN(leftValue)) {
      return 1;
    }
    if (Number.isNaN(rightValue)) {
      return -1;
    }

    return rightValue - leftValue;
  });
}

function upsertWorkspaceConnectionList(currentConnections, nextConnection) {
  const next = (currentConnections ?? []).filter(
    (connection) => connection.connection_id !== nextConnection.connection_id
  );
  next.unshift(nextConnection);
  return sortWorkspaceConnectionsByMostRecent(next);
}

function connectorSymbolLabel(entry) {
  switch (entry?.connection_kind ?? entry?.kind) {
    case 'gmail':
      return 'G';
    case 'google_drive':
      return 'D';
    case 'google_calendar':
      return 'C';
    case 'instagram':
      return 'I';
    case 'whatsapp':
      return 'W';
    case 'twitter':
      return 'X';
    case 'telegram':
      return 'T';
    case 'slack':
      return 'S';
    case 'outlook':
      return 'O';
    case 'notion':
      return 'N';
    default:
      return String(entry?.label ?? entry?.display_name ?? '?').charAt(0).toUpperCase() || '?';
  }
}

function formatRunDuration(run) {
  const durationMs = runDurationMs(run);
  return durationMs ? formatDurationMs(durationMs) : '—';
}

function runDurationMs(run) {
  if (Number.isFinite(run?.duration_ms) && run.duration_ms >= 0) {
    return run.duration_ms;
  }

  if (!run?.started_at) {
    return 0;
  }

  const started = new Date(run.started_at).getTime();
  const finished = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();

  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return 0;
  }

  return Math.max(0, finished - started);
}

function formatDurationMs(durationMs) {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function countRunRetries(run) {
  if (Number.isFinite(run?.retry_count)) {
    return Math.max(0, run.retry_count);
  }

  return (run?.node_runs ?? []).reduce(
    (sum, nodeRun) => sum + Math.max(0, (nodeRun.attempt ?? 1) - 1),
    0
  );
}

function countRunErrors(run) {
  if (Number.isFinite(run?.error_count)) {
    return Math.max(0, run.error_count);
  }

  const nodeFailures = (run?.node_runs ?? []).filter((nodeRun) => nodeRun.error).length;
  return run?.error ? Math.max(nodeFailures, 1) : nodeFailures;
}

function sortRunsByMostRecent(runs = []) {
  return [...runs].sort((left, right) => {
    const leftTime =
      Date.parse(left.started_at ?? '') ||
      Date.parse(left.finished_at ?? '') ||
      0;
    const rightTime =
      Date.parse(right.started_at ?? '') ||
      Date.parse(right.finished_at ?? '') ||
      0;

    return rightTime - leftTime;
  });
}

function summarizeRunNodeDetail(nodeRun) {
  const detailParts = [];

  if (nodeRun.error?.message) {
    detailParts.push(nodeRun.error.message);
  }

  if (Number.isFinite(nodeRun.attempt) && nodeRun.attempt > 1) {
    detailParts.push(`Attempt ${nodeRun.attempt}`);
  }

  return detailParts.join(' · ') || 'No additional detail';
}

function summarizeRunEventTitle(event) {
  return humanizeRunStatus(event?.event_type ?? 'unknown');
}

function summarizeRunEventDetail(event) {
  const detailParts = [];

  if (event?.target?.node_id) {
    detailParts.push(event.target.node_id);
  } else if (event?.target?.kind) {
    detailParts.push(event.target.kind);
  }

  if (event?.timestamp) {
    detailParts.push(formatRunTimestamp(event.timestamp));
  }

  if (event?.payload && typeof event.payload === 'object') {
    const payloadSummary = Object.entries(event.payload)
      .slice(0, 2)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(' · ');

    if (payloadSummary) {
      detailParts.push(payloadSummary);
    }
  }

  return detailParts.join(' · ') || 'No additional detail';
}

function formatRunLogLevel(level) {
  if (!level) {
    return 'I';
  }

  const normalizedLevel = String(level).toLowerCase();
  if (normalizedLevel.startsWith('error')) {
    return 'E';
  }
  if (normalizedLevel.startsWith('warn')) {
    return 'W';
  }
  if (normalizedLevel.startsWith('debug')) {
    return 'D';
  }

  return 'I';
}

function summarizeRunLogDetail(entry) {
  const detailParts = [];

  if (entry?.timestamp) {
    detailParts.push(formatRunTimestamp(entry.timestamp));
  }

  if (entry?.node_id) {
    detailParts.push(entry.node_id);
  }

  if (entry?.level) {
    detailParts.push(humanizeRunStatus(entry.level));
  }

  return detailParts.join(' · ') || 'No additional detail';
}

function useGoogleCodeClient({
  clientId,
  enabled,
  onCode,
  onError,
  scope = 'openid email profile'
}) {
  const clientRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!enabled || !clientId || typeof window === 'undefined') {
      clientRef.current = null;
      setIsReady(false);
      return;
    }

    let cancelled = false;

    function initializeClient() {
      const google = window.google;
      if (!google?.accounts?.oauth2?.initCodeClient) {
        return false;
      }

      clientRef.current = google.accounts.oauth2.initCodeClient({
        callback: (response) => {
          if (response?.error) {
            onError?.('Google sign-in was cancelled or could not be completed.');
            return;
          }

          if (!response?.code) {
            onError?.('Google did not return an authorization code.');
            return;
          }

          void onCode(response.code);
        },
        client_id: clientId,
        include_granted_scopes: true,
        prompt: 'consent',
        scope,
        select_account: true,
        ux_mode: 'popup'
      });

      if (!cancelled) {
        setIsReady(true);
      }
      return true;
    }

    if (initializeClient()) {
      return () => {
        cancelled = true;
      };
    }

    const existingScript = document.querySelector('script[data-google-gsi-client="true"]');
    const script =
      existingScript ??
      Object.assign(document.createElement('script'), {
        async: true,
        defer: true,
        src: 'https://accounts.google.com/gsi/client'
      });

    if (!existingScript) {
      script.dataset.googleGsiClient = 'true';
      document.head.appendChild(script);
    }

    function handleLoad() {
      initializeClient();
    }

    function handleError() {
      if (!cancelled) {
        setIsReady(false);
        onError?.('Google sign-in could not be loaded.');
      }
    }

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);

    return () => {
      cancelled = true;
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
  }, [clientId, enabled, onCode, onError, scope]);

  function requestCode() {
    if (!clientRef.current) {
      onError?.('Google sign-in is not ready yet.');
      return;
    }

    clientRef.current.requestCode();
  }

  return { isReady, requestCode };
}

function GoogleMarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M21.64 12.2046C21.64 11.3875 21.5667 10.6012 21.4305 9.84668H12V13.7242H17.3891C17.157 14.9743 16.4523 16.0334 15.3933 16.7501V19.2652H18.6324C20.5289 17.5198 21.64 14.9429 21.64 12.2046Z"
        fill="currentColor"
      />
      <path
        d="M12 22.0001C14.7 22.0001 16.9625 21.1048 18.6324 19.2653L15.3933 16.7502C14.4979 17.3503 13.3541 17.7049 12 17.7049C9.3959 17.7049 7.19317 15.9459 6.407 13.5818H3.05884V16.1787C4.71912 19.477 8.12948 22.0001 12 22.0001Z"
        fill="currentColor"
      />
      <path
        d="M6.407 13.5818C6.207 12.9817 6.09308 12.3409 6.09308 11.6818C6.09308 11.0228 6.207 10.3819 6.407 9.78183V7.18494H3.05884C2.37587 8.54606 2 10.0788 2 11.6818C2 13.2848 2.37587 14.8176 3.05884 16.1787L6.407 13.5818Z"
        fill="currentColor"
      />
      <path
        d="M12 5.65932C13.4778 5.65932 14.8042 6.1685 15.8463 7.16675L18.7058 4.30726C16.9584 2.70418 14.696 1.36395 12 1.36395C8.12948 1.36395 4.71912 3.88703 3.05884 7.18491L6.407 9.7818C7.19317 7.4177 9.3959 5.65932 12 5.65932Z"
        fill="currentColor"
      />
    </svg>
  );
}

async function refreshSession(setSessionState) {
  let session = UNAUTHENTICATED_SESSION;

  try {
    session = normalizeSession(await getSession());
  } catch (error) {
    session = UNAUTHENTICATED_SESSION;
  }

  setSessionState({ status: 'ready', session });
  return session;
}

function normalizeSession(session) {
  return {
    authenticated: Boolean(session?.authenticated),
    active_workspace_id: session?.active_workspace_id ?? null,
    user: session?.user ?? null,
    workspaces: Array.isArray(session?.workspaces) ? session.workspaces : []
  };
}

function getDefaultAppPath(session) {
  if (!session?.authenticated) {
    return '/login';
  }

  if (!session.workspaces.length) {
    return '/workspaces/new';
  }

  const activeWorkspace =
    session.workspaces.find(
      (workspace) => workspace.workspace_id === session.active_workspace_id
    ) ?? session.workspaces[0];

  return buildCanvasHomePath(activeWorkspace.slug);
}

function buildCanvasHomePath(workspaceSlug) {
  return `/w/${workspaceSlug}/canvas`;
}

function buildWorkflowPath(workflowId, workspaceId = null) {
  const basePath = `/flow/${workflowId}`;
  if (!workspaceId) {
    return basePath;
  }

  return `${basePath}?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function readStoredViewMode() {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return raw === 'mobile' ? 'mobile' : 'desktop';
  } catch (error) {
    return 'desktop';
  }
}

function readStoredAttentionCollapsed() {
  if (typeof window === 'undefined') {
    return false;
  }

  const storedValue = window.localStorage.getItem(ATTENTION_COLLAPSE_STORAGE_KEY);
  return storedValue ? storedValue === 'true' : false;
}
