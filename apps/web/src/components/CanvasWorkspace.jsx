import { startTransition, useEffect, useRef, useState, useDeferredValue } from 'react';
import starterWorkflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import connectionFixture from '../../../../tests/fixtures/api/connections.json';
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import WorkflowCanvas from './WorkflowCanvas';
import {
  cancelWorkspaceRun,
  createWorkflow,
  createRun,
  createWorkspaceRun,
  getConnections,
  getNodeDefinitions,
  getRunSnapshot,
  getWorkspaceConnections,
  getWorkspaceRun,
  getWorkspaceRunEvents,
  getWorkspaceRunLogs,
  getWorkspaceRuns,
  getWorkflow,
  getWorkflowState,
  getWorkflows,
  subscribeToRun,
  updateWorkflow,
  updateWorkflowState,
  validateWorkflow
} from '../lib/api';
import {
  buildProblemItems,
  buildSearchResults,
  groupNodeDefinitions,
  humanizeToken,
  SHELL_SECTIONS
} from '../lib/shell';
import {
  emitWorkspaceRunUpdated,
  extractWorkspaceRunUpdate,
  WORKSPACE_RUN_UPDATED_EVENT
} from '../lib/runSync';
import {
  extractWorkspaceWorkflowInvalidation,
  WORKSPACE_WORKFLOWS_INVALIDATED_EVENT
} from '../lib/catalogSync';
import {
  extractWorkspaceConnectionUpdate,
  WORKSPACE_CONNECTIONS_UPDATED_EVENT
} from '../lib/workspaceConnectionsSync';
import { buildStarterWorkflowDefinition } from '../lib/workflowTemplates';
import {
  cloneWorkflow,
  resolveNodeDefinition,
  updateNodeConfig,
  updateNodeLabel
} from '../lib/workflow';

const CANVAS_DEBUG_COLLAPSE_STORAGE_KEY = 'stitchly.canvas.debug-panel-collapsed.v1';

const EMPTY_CANVAS_DEBUG_STATE = {
  activeEdgeId: null,
  activeNodeId: null,
  blockerElement: null,
  connectionFromHandleId: null,
  connectionFromNodeId: null,
  connectionInProgress: false,
  connectionIsValid: null,
  connectionReason: null,
  connectionToHandleId: null,
  connectionToNodeId: null,
  connectionTypes: null,
  edgeSelectedState: false,
  nodeFocusMatch: false,
  nodeHoverMatch: false,
  nodeRect: null,
  nodeSelectedState: false,
  pointer: null,
  pointerInsideNode: false,
  stack: [],
  topElement: null,
  viewport: null
};

export default function CanvasWorkspace({
  draggedNodeType = null,
  onOpenRunInPanel = null,
  onRegisterCanvasActions = null,
  onWorkflowMissing = null,
  onWorkflowResolved = null,
  workflowId = null,
  workspaceId = null
}) {
  const showCanvasDebug = import.meta.env.DEV;
  const [workflow, setWorkflowState] = useState(() => buildCanvasStarterWorkflow());
  const [nodeDefinitions, setNodeDefinitions] = useState(nodeDefinitionFixture.node_definitions);
  const [connections, setConnections] = useState(connectionFixture.connections);
  const [workspaceConnections, setWorkspaceConnections] = useState([]);
  const [validation, setValidation] = useState(null);
  const [runSnapshot, setRunSnapshot] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [runDetailState, setRunDetailState] = useState({
    status: 'idle',
    runId: null,
    events: [],
    logs: []
  });
  const [events, setEvents] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [backendStatus, setBackendStatus] = useState('connecting');
  const [busyState, setBusyState] = useState({ cancel: false, validate: false, run: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('canvas');
  const [drawerQuery, setDrawerQuery] = useState('');
  const [floatingCard, setFloatingCard] = useState(null);
  const [canvasDebugState, setCanvasDebugState] = useState(EMPTY_CANVAS_DEBUG_STATE);
  const [isCanvasDebugCollapsed, setIsCanvasDebugCollapsed] = useState(() =>
    readStoredCanvasDebugCollapsed()
  );
  const [isCanvasZoomMenuOpen, setIsCanvasZoomMenuOpen] = useState(false);
  const [workflowSyncState, setWorkflowSyncState] = useState(
    workspaceId ? 'loading' : 'local'
  );
  const [canvasViewport, setCanvasViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [canvasViewportActions, setCanvasViewportActions] = useState(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState(
    starterWorkflowFixture.workflow_id
  );
  const [isWorkflowTitleEditing, setIsWorkflowTitleEditing] = useState(false);
  const [workflowTitleDraft, setWorkflowTitleDraft] = useState(
    starterWorkflowFixture.name || 'untitled'
  );
  const closeStreamRef = useRef(null);
  const persistedWorkflowSignatureRef = useRef(
    workflowSignature(starterWorkflowFixture)
  );
  const workflowTitleInputRef = useRef(null);
  const deferredEvents = useDeferredValue(events);

  function setWorkflow(nextWorkflow) {
    setWorkflowState((currentWorkflow) =>
      normalizeCanvasWorkflow(
        typeof nextWorkflow === 'function' ? nextWorkflow(currentWorkflow) : nextWorkflow
      )
    );
  }

  const selectedNode = workflow?.nodes?.find((node) => node.node_id === selectedNodeId) ?? null;
  const selectedDefinition = resolveNodeDefinition(selectedNode, nodeDefinitions);
  const displayWorkflowTitle = workflow?.name?.trim() ? workflow.name.trim() : 'untitled';
  const problemItems = buildProblemItems(validation);
  const activeSectionMeta = SHELL_SECTIONS.find((section) => section.id === activeSection) ?? SHELL_SECTIONS[0];
  const groupedNodeDefinitions = groupNodeDefinitions(
    nodeDefinitions,
    activeSection === 'nodes' ? drawerQuery : ''
  );
  const searchResults = buildSearchResults({
    query: activeSection === 'search' ? drawerQuery : '',
    workflow,
    nodeDefinitions,
    connections,
    runHistory,
    validation
  });
  const activeProblem =
    floatingCard?.type === 'problem-detail'
      ? problemItems.find((problem) => problem.id === floatingCard.problemId) ?? null
      : null;
  const activeRun =
    floatingCard?.type === 'run-detail'
      ? runHistory.find((run) => run.run_id === floatingCard.runId) ?? runSnapshot
      : runSnapshot;
  const activeRunEvents =
    floatingCard?.type === 'run-detail' && runDetailState.runId === floatingCard.runId
      ? runDetailState.events
      : activeRun?.run_id === runSnapshot?.run_id
        ? deferredEvents
        : [];
  const activeRunLogs =
    floatingCard?.type === 'run-detail' && runDetailState.runId === floatingCard.runId
      ? runDetailState.logs
      : activeRun?.logs ?? [];
  const latestWorkflowRun = runSnapshot ?? runHistory[0] ?? null;
  const activeLiveRun = isCancellableRun(latestWorkflowRun) ? latestWorkflowRun : null;

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      try {
        const [definitionResponse, connectionResponse] = await Promise.all([
          getNodeDefinitions(),
          getConnections()
        ]);

        if (!cancelled) {
          setNodeDefinitions(definitionResponse.node_definitions);
          setConnections(connectionResponse.connections);
          setBackendStatus('connected');
        }
      } catch (error) {
        if (!cancelled) {
          setBackendStatus('offline');
        }
      }
    }

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setWorkspaceConnections([]);
      return undefined;
    }

    let cancelled = false;

    async function loadWorkspaceConnections() {
      try {
        const response = await getWorkspaceConnections(workspaceId);
        if (!cancelled) {
          setWorkspaceConnections(response.connections ?? []);
        }
      } catch (_error) {
        if (!cancelled) {
          setWorkspaceConnections([]);
        }
      }
    }

    void loadWorkspaceConnections();

    function handleWorkspaceConnectionsUpdated(event) {
      const nextConnection = extractWorkspaceConnectionUpdate(event, workspaceId);
      if (!nextConnection) {
        return;
      }

      setWorkspaceConnections((current) => {
        const next = current.filter(
          (connection) => connection.connection_id !== nextConnection.connection_id
        );
        next.unshift(nextConnection);
        return next;
      });
    }

    window.addEventListener(WORKSPACE_CONNECTIONS_UPDATED_EVENT, handleWorkspaceConnectionsUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener(
        WORKSPACE_CONNECTIONS_UPDATED_EVENT,
        handleWorkspaceConnectionsUpdated
      );
    };
  }, [workspaceId]);

  useEffect(() => {
    if (isWorkflowTitleEditing) {
      return;
    }

    setWorkflowTitleDraft(displayWorkflowTitle);
  }, [displayWorkflowTitle, isWorkflowTitleEditing]);

  useEffect(() => {
    setIsWorkflowTitleEditing(false);
  }, [activeWorkflowId]);

  useEffect(() => {
    if (!isWorkflowTitleEditing || !workflowTitleInputRef.current) {
      return;
    }

    workflowTitleInputRef.current.focus();
    workflowTitleInputRef.current.select();
  }, [isWorkflowTitleEditing]);

  useEffect(() => {
    return () => {
      closeStreamRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !canvasViewportActions) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        shouldIgnoreCanvasShortcut(event)
      ) {
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        void canvasViewportActions.zoomIn?.();
        return;
      }

      if (event.key === '-') {
        event.preventDefault();
        void canvasViewportActions.zoomOut?.();
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        void canvasViewportActions.zoomTo?.(1);
        return;
      }

      if (event.key === '1') {
        event.preventDefault();
        void canvasViewportActions.fitView?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasViewportActions]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      CANVAS_DEBUG_COLLAPSE_STORAGE_KEY,
      JSON.stringify(isCanvasDebugCollapsed)
    );
  }, [isCanvasDebugCollapsed]);

  useEffect(() => {
    if (!onRegisterCanvasActions) {
      return undefined;
    }

    onRegisterCanvasActions({
      addNode(typeId, position = null) {
        const nextState = appendCanvasNode(workflow, typeId, {
          position,
          selectedNodeId
        });

        if (!nextState) {
          return;
        }

        applyWorkflowChange(nextState.workflow);
        setSelectedNodeId(nextState.selectedNodeId);
      },
      openRunDetail(runId) {
        inspectRun(runId);
      },
      openRunControl() {
        openRunControl();
      }
    });

    return () => onRegisterCanvasActions(null);
  }, [
    onOpenRunInPanel,
    onRegisterCanvasActions,
    runHistory,
    runSnapshot,
    selectedNodeId,
    workflow,
    workspaceId
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceWorkflow() {
      if (!workspaceId) {
        const localWorkflow = buildCanvasStarterWorkflow();
        persistedWorkflowSignatureRef.current = workflowSignature(localWorkflow);
        setWorkflow(localWorkflow);
        setActiveWorkflowId(localWorkflow.workflow_id);
        setWorkflowSyncState('local');
        return;
      }

      setWorkflowSyncState('loading');

      try {
        let workflowResponse = null;

        if (workflowId) {
          workflowResponse = await getWorkflow(workspaceId, workflowId);
        } else {
          const rememberedState = await getWorkflowState(workspaceId).catch(() => ({
            last_opened_workflow_id: null
          }));

          if (rememberedState.last_opened_workflow_id) {
            try {
              workflowResponse = await getWorkflow(
                workspaceId,
                rememberedState.last_opened_workflow_id
              );
            } catch (error) {
              if (error?.status !== 404) {
                throw error;
              }
            }
          }

          if (!workflowResponse) {
            const workflowList = await getWorkflows(workspaceId);
            if (workflowList.workflows?.[0]) {
              workflowResponse = await getWorkflow(
                workspaceId,
                workflowList.workflows[0].workflow_id
              );
            } else {
              workflowResponse = await createWorkflow(
                workspaceId,
                buildStarterWorkflowDefinition()
              );
            }
          }
        }

        if (cancelled) {
          return;
        }

        const persistedWorkflow = extractCanvasWorkflowDefinition(workflowResponse);
        const nextWorkflow = normalizeCanvasWorkflow(persistedWorkflow);
        const resolvedWorkflowId = resolveCanvasWorkflowId(workflowResponse, nextWorkflow);
        persistedWorkflowSignatureRef.current = workflowSignature(persistedWorkflow);
        setWorkflow(nextWorkflow);
        setActiveWorkflowId(resolvedWorkflowId);
        setWorkflowSyncState('synced');
        setValidation(null);
        setRunSnapshot(null);
        setRunHistory([]);
        setRunDetailState({
          status: 'idle',
          runId: null,
          events: [],
          logs: []
        });
        setEvents([]);
        setSelectedNodeId(null);
        setConfigDraft('{}');
        setConfigError('');

        if (!workflowId || workflowId !== resolvedWorkflowId) {
          onWorkflowResolved?.(resolvedWorkflowId);
        }

        try {
          await updateWorkflowState(workspaceId, resolvedWorkflowId);
        } catch (stateError) {
          // Remembered workflow state is helpful but not critical to canvas loading.
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (workflowId && error?.status === 404) {
          onWorkflowMissing?.();
          return;
        }

        setWorkflowSyncState('offline');
        setBackendStatus('offline');
      }
    }

    void loadWorkspaceWorkflow();

    return () => {
      cancelled = true;
    };
  }, [onWorkflowMissing, onWorkflowResolved, workflowId, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceRunHistory() {
      if (!workspaceId || !activeWorkflowId) {
        if (!workspaceId) {
          setRunHistory([]);
          setRunDetailState({
            status: 'idle',
            runId: null,
            events: [],
            logs: []
          });
        }
        return;
      }

      try {
        const response = await getWorkspaceRuns(workspaceId);
        if (cancelled) {
          return;
        }

        setRunHistory(
          sortRunsByMostRecent(
            response.runs.filter((run) => run.workflow_id === activeWorkflowId)
          ).slice(0, 8)
        );

        setRunSnapshot((current) =>
          resolveLatestWorkflowRunSnapshot({
            activeWorkflowId,
            currentRun: current,
            runs: response.runs
          })
        );
      } catch (error) {
        if (!cancelled) {
          setBackendStatus('offline');
        }
      }
    }

    void loadWorkspaceRunHistory();

    return () => {
      cancelled = true;
    };
  }, [activeWorkflowId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || typeof window === 'undefined') {
      return undefined;
    }

    function handleWorkspaceRunUpdated(event) {
      const nextRun = extractWorkspaceRunUpdate(event, workspaceId);
      if (!nextRun) {
        return;
      }

      if (nextRun.workflow_id === activeWorkflowId) {
        upsertRunHistory(nextRun);
        setRunSnapshot((current) =>
          resolveLatestWorkflowRunSnapshot({
            activeWorkflowId,
            currentRun: current,
            runs: [nextRun]
          })
        );
      }

      setRunDetailState((current) =>
        current.runId === nextRun.run_id
          ? {
              ...current,
              runId: nextRun.run_id,
              run: nextRun,
              status: current.status === 'idle' ? 'ready' : current.status
            }
          : current
      );
    }

    window.addEventListener(WORKSPACE_RUN_UPDATED_EVENT, handleWorkspaceRunUpdated);
    return () =>
      window.removeEventListener(WORKSPACE_RUN_UPDATED_EVENT, handleWorkspaceRunUpdated);
  }, [activeWorkflowId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !activeWorkflowId || typeof window === 'undefined') {
      return undefined;
    }

    let cancelled = false;

    async function reloadInvalidatedWorkflow() {
      try {
        const workflowResponse = await getWorkflow(workspaceId, activeWorkflowId);
        if (cancelled) {
          return;
        }

        const persistedWorkflow = extractCanvasWorkflowDefinition(workflowResponse);
        const nextWorkflow = normalizeCanvasWorkflow(persistedWorkflow);
        persistedWorkflowSignatureRef.current = workflowSignature(persistedWorkflow);
        setWorkflow(nextWorkflow);
        setValidation(null);
        setWorkflowSyncState('synced');
        setSelectedNodeId((current) =>
          current && nextWorkflow.nodes.some((node) => node.node_id === current) ? current : null
        );
      } catch (_error) {
        if (!cancelled) {
          setWorkflowSyncState('offline');
        }
      }
    }

    function handleWorkflowInvalidation(event) {
      const detail = extractWorkspaceWorkflowInvalidation(event, workspaceId);
      if (!detail?.workflowIds?.includes(activeWorkflowId)) {
        return;
      }

      void reloadInvalidatedWorkflow();
    }

    window.addEventListener(
      WORKSPACE_WORKFLOWS_INVALIDATED_EVENT,
      handleWorkflowInvalidation
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        WORKSPACE_WORKFLOWS_INVALIDATED_EVENT,
        handleWorkflowInvalidation
      );
    };
  }, [activeWorkflowId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !activeWorkflowId || workflowSyncState === 'loading') {
      return;
    }

    const nextSignature = workflowSignature(workflow);
    if (nextSignature === persistedWorkflowSignatureRef.current) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setWorkflowSyncState('saving');

      try {
        const workflowResponse = await updateWorkflow(
          workspaceId,
          activeWorkflowId,
          normalizeCanvasWorkflow(workflow)
        );

        if (cancelled) {
          return;
        }

        const nextWorkflow = extractCanvasWorkflowDefinition(workflowResponse);
        persistedWorkflowSignatureRef.current = workflowSignature(nextWorkflow);
        setActiveWorkflowId(resolveCanvasWorkflowId(workflowResponse, nextWorkflow));
        setWorkflow(nextWorkflow);
        setWorkflowSyncState('synced');
      } catch (error) {
        if (!cancelled) {
          setWorkflowSyncState('offline');
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeWorkflowId, workflow, workspaceId]);

  function applyWorkflowChange(nextWorkflow) {
    setWorkflow(nextWorkflow);
    setValidation(null);

    if (floatingCard?.type === 'problem-detail') {
      setFloatingCard(null);
    }
  }

  async function refreshRun(runId) {
    try {
      const snapshot = workspaceId
        ? (await getWorkspaceRun(workspaceId, runId)).run
        : await getRunSnapshot(runId);
      setRunSnapshot(snapshot);
      upsertRunHistory(snapshot);
    } catch (error) {
      setBackendStatus('stream-error');
    }
  }

  async function refreshRunDetail(runId) {
    if (!runId) {
      return;
    }

    if (!workspaceId) {
      const fallbackRun =
        runHistory.find((run) => run.run_id === runId) ??
        (runSnapshot?.run_id === runId ? runSnapshot : null);
      setRunDetailState({
        status: 'ready',
        runId,
        events: fallbackRun?.run_id === runSnapshot?.run_id ? deferredEvents : [],
        logs: fallbackRun?.logs ?? []
      });
      return;
    }

    setRunDetailState((current) => ({
      status: 'loading',
      runId,
      events: current.runId === runId ? current.events : [],
      logs: current.runId === runId ? current.logs : []
    }));

    try {
      const [runResponse, eventsResponse, logsResponse] = await Promise.all([
        getWorkspaceRun(workspaceId, runId),
        getWorkspaceRunEvents(workspaceId, runId),
        getWorkspaceRunLogs(workspaceId, runId)
      ]);

      setRunSnapshot((current) =>
        current?.run_id === runId ? runResponse.run : current
      );
      upsertRunHistory(runResponse.run);
      setRunDetailState({
        status: 'ready',
        runId,
        events: eventsResponse.events,
        logs: logsResponse.logs
      });
    } catch (error) {
      setRunDetailState((current) => ({
        status: 'error',
        runId,
        events: current.runId === runId ? current.events : [],
        logs: current.runId === runId ? current.logs : []
      }));
      setBackendStatus('stream-error');
    }
  }

  async function handleValidate() {
    setBusyState((current) => ({ ...current, validate: true }));

    try {
      const nextWorkflow = normalizeCanvasWorkflow(workflow);
      if (workflowSignature(nextWorkflow) !== workflowSignature(workflow)) {
        setWorkflow(nextWorkflow);
      }

      const response = await validateWorkflow(nextWorkflow);
      setValidation(response);
      setBackendStatus('connected');

      if (!response.valid) {
        setActiveSection('runs');
        setDrawerOpen(true);
        setFloatingCard({ type: 'run-control' });
      }
    } catch (error) {
      setValidation(error.payload?.validation ?? null);
      setBackendStatus('offline');
    } finally {
      setBusyState((current) => ({ ...current, validate: false }));
    }
  }

  async function handleRun() {
    setBusyState((current) => ({ ...current, run: true }));
    closeStreamRef.current?.();
    setEvents([]);

    try {
      const nextWorkflow = normalizeCanvasWorkflow(workflow);
      if (workflowSignature(nextWorkflow) !== workflowSignature(workflow)) {
        setWorkflow(nextWorkflow);
      }

      const response = workspaceId
        ? await createWorkspaceRun(workspaceId, nextWorkflow)
        : await createRun(nextWorkflow);
      const seededRun = {
        run_id: response.run_id,
        workflow_id: nextWorkflow.workflow_id,
        workflow_version: nextWorkflow.version,
        status: response.status,
        node_runs: [],
        logs: []
      };

      upsertRunHistory(seededRun);
      if (onOpenRunInPanel) {
        onOpenRunInPanel(response.run_id);
      } else {
        setActiveSection('runs');
        setDrawerOpen(true);
        setFloatingCard({ type: 'run-detail', runId: response.run_id });
      }
      setBackendStatus('connected');
      await refreshRun(response.run_id);
      await refreshRunDetail(response.run_id);

      closeStreamRef.current = subscribeToRun(response.run_id, {
        onEvent(event) {
          startTransition(() => {
            setEvents((current) => [...current, event]);
          });
          void refreshRun(response.run_id);
          if (workspaceId) {
            void refreshRunDetail(response.run_id);
          }

          if (isTerminalRunEventType(event?.event_type)) {
            closeStreamRef.current?.();
            closeStreamRef.current = null;
            setBackendStatus('connected');
          }
        },
        onError() {
          if (isRunInProgress(runSnapshot?.status ?? latestWorkflowRun?.status)) {
            setBackendStatus('stream-error');
          }
        }
      });
    } catch (error) {
      setValidation(error.payload?.validation ?? null);
      setBackendStatus('offline');
    } finally {
      setBusyState((current) => ({ ...current, run: false }));
    }
  }

  async function handleCancelRun() {
    if (!workspaceId || !activeLiveRun?.run_id) {
      return;
    }

    setBusyState((current) => ({ ...current, cancel: true }));

    try {
      const response = await cancelWorkspaceRun(workspaceId, activeLiveRun.run_id);
      setRunSnapshot(response.run);
      upsertRunHistory(response.run);
      emitWorkspaceRunUpdated(workspaceId, response.run);
      setBackendStatus('connected');
      await refreshRun(activeLiveRun.run_id);
      await refreshRunDetail(activeLiveRun.run_id);
    } catch (error) {
      setBackendStatus('stream-error');
    } finally {
      setBusyState((current) => ({ ...current, cancel: false }));
    }
  }

  function handleReset() {
    closeStreamRef.current?.();
    const nextWorkflow = buildCanvasStarterWorkflow();
    setWorkflow(nextWorkflow);
    setValidation(null);
    setRunSnapshot(null);
    setRunHistory([]);
    setRunDetailState({
      status: 'idle',
      runId: null,
      events: [],
      logs: []
    });
    setEvents([]);
    setSelectedNodeId(null);
    setConfigDraft('{}');
    setConfigError('');
    setDrawerOpen(false);
    setActiveSection('canvas');
    setDrawerQuery('');
    setFloatingCard(null);
  }

  function handleWorkflowTitleStart() {
    setWorkflowTitleDraft(displayWorkflowTitle);
    setIsWorkflowTitleEditing(true);
  }

  function handleWorkflowTitleCancel() {
    setWorkflowTitleDraft(displayWorkflowTitle);
    setIsWorkflowTitleEditing(false);
  }

  function handleWorkflowTitleCommit() {
    const nextTitle = workflowTitleDraft.trim() || 'untitled';
    setIsWorkflowTitleEditing(false);

    if (nextTitle === displayWorkflowTitle) {
      setWorkflowTitleDraft(nextTitle);
      return;
    }

    setWorkflowTitleDraft(nextTitle);
    applyWorkflowChange({
      ...workflow,
      name: nextTitle
    });
  }

  function handleRailSelect(sectionId) {
    if (sectionId === activeSection && drawerOpen) {
      setDrawerOpen(false);
      setFloatingCard(null);
      return;
    }

    setActiveSection(sectionId);
    setDrawerOpen(true);
    setDrawerQuery('');

    if (sectionId === 'runs') {
      setFloatingCard(runSnapshot ? { type: 'run-detail', runId: runSnapshot.run_id } : { type: 'run-control' });
      return;
    }

    if (sectionId === 'nodes') {
      setFloatingCard(null);
      return;
    }

    setFloatingCard(null);
  }

  function handleDrawerToggle() {
    setDrawerOpen((current) => {
      const next = !current;
      if (!next) {
        setFloatingCard(null);
      }
      return next;
    });
  }

  function focusNodePanel(nodeId) {
    if (!nodeId) {
      return;
    }

    setSelectedNodeId(nodeId);
    setActiveSection('nodes');
    setDrawerOpen(true);
    setFloatingCard(null);
  }

  function handleCanvasSelection(nodeId) {
    if (!nodeId) {
      setSelectedNodeId(null);
      return;
    }

    setSelectedNodeId(nodeId);
  }

  function openProblemDetail(problemId) {
    const problem = problemItems.find((item) => item.id === problemId) ?? null;
    setActiveSection('problems');
    setDrawerOpen(true);
    setFloatingCard({ type: 'problem-detail', problemId });

    if (problem?.target?.nodeId) {
      setSelectedNodeId(problem.target.nodeId);
    }
  }

  function openRunControl() {
    setActiveSection('runs');
    setDrawerOpen(true);
    setFloatingCard({ type: 'run-control' });
  }

  function openRunDetail(runId) {
    setActiveSection('runs');
    setDrawerOpen(true);
    setFloatingCard({ type: 'run-detail', runId });
    void refreshRunDetail(runId);
  }

  function inspectRun(runId) {
    if (!runId) {
      return;
    }

    if (onOpenRunInPanel) {
      onOpenRunInPanel(runId);
      return;
    }

    openRunDetail(runId);
  }

  function handleSearchResult(result) {
    if (result.kind === 'workflow') {
      setActiveSection('canvas');
      setDrawerOpen(true);
      setFloatingCard(null);
      return;
    }

    if (result.kind === 'workflow-node') {
      focusNodePanel(result.nodeId);
      return;
    }

    if (result.kind === 'node-definition') {
      setActiveSection('nodes');
      setDrawerOpen(true);
      setDrawerQuery(result.title);
      setFloatingCard(null);
      return;
    }

    if (result.kind === 'problem') {
      openProblemDetail(result.problemId);
      return;
    }

    if (result.kind === 'run') {
      inspectRun(result.runId);
      return;
    }

    if (result.kind === 'connection') {
      setActiveSection('settings');
      setDrawerOpen(true);
      setFloatingCard(null);
    }
  }

  function closeFloatingCard() {
    setFloatingCard(null);
  }

  function focusProblemTarget(problem) {
    if (problem?.target?.nodeId) {
      focusNodePanel(problem.target.nodeId);
    }
  }

  function upsertRunHistory(nextRun) {
    setRunHistory((current) => {
      const withoutCurrent = current.filter((run) => run.run_id !== nextRun.run_id);
      return [nextRun, ...withoutCurrent].slice(0, 8);
    });
  }

  return (
    <div className="app-shell">
      <WorkflowCanvas
        activeRunSnapshot={activeRun}
        draggedNodeType={draggedNodeType}
        nodeDefinitions={nodeDefinitions}
        onDebugStateChange={showCanvasDebug ? setCanvasDebugState : undefined}
        onNodeTypeDrop={(typeId, position) => {
          const nextState = appendCanvasNode(workflow, typeId, {
            position,
            selectedNodeId
          });

          if (!nextState) {
            return;
          }

          applyWorkflowChange(nextState.workflow);
          setSelectedNodeId(nextState.selectedNodeId);
        }}
        onSelectionChange={handleCanvasSelection}
        onViewportActionsReady={setCanvasViewportActions}
        onViewportChange={setCanvasViewport}
        onWorkflowChange={applyWorkflowChange}
        selectedNodeId={selectedNodeId}
        workflow={workflow}
      />

      {selectedNode ? (
        <CanvasNodeManagementPanel
          definition={selectedDefinition}
          node={selectedNode}
          onNodeConfigChange={(nextConfigUpdater) => {
            if (!selectedNode) {
              return;
            }

            const currentConfig = selectedNode.config ?? {};
            const nextConfig =
              typeof nextConfigUpdater === 'function'
                ? nextConfigUpdater(currentConfig)
                : nextConfigUpdater;

            applyWorkflowChange(updateNodeConfig(workflow, selectedNode.node_id, nextConfig));
          }}
          onNodeLabelChange={(nextLabel) => {
            if (!selectedNode) {
              return;
            }

            applyWorkflowChange(updateNodeLabel(workflow, selectedNode.node_id, nextLabel));
          }}
          workspaceConnections={workspaceConnections}
          workflow={workflow}
          workflowSyncState={workflowSyncState}
        />
      ) : null}

      <CanvasViewportControls
        isZoomMenuOpen={isCanvasZoomMenuOpen}
        onToggleZoomMenu={() => setIsCanvasZoomMenuOpen((current) => !current)}
        onZoomIn={() => {
          void canvasViewportActions?.zoomIn?.();
          setIsCanvasZoomMenuOpen(false);
        }}
        onZoomOut={() => {
          void canvasViewportActions?.zoomOut?.();
          setIsCanvasZoomMenuOpen(false);
        }}
        onZoomToFit={() => {
          void canvasViewportActions?.fitView?.();
          setIsCanvasZoomMenuOpen(false);
        }}
        onZoomToHundred={() => {
          void canvasViewportActions?.zoomTo?.(1);
          setIsCanvasZoomMenuOpen(false);
        }}
        zoomLabel={formatCanvasZoom(canvasViewport.zoom)}
      />

      <div className="canvas-top-left-tools">
        <div className="canvas-top-left-tools__main">
          <CanvasWorkflowTitleBox
            isEditing={isWorkflowTitleEditing}
            onCancel={handleWorkflowTitleCancel}
            onChange={setWorkflowTitleDraft}
            onCommit={handleWorkflowTitleCommit}
            onStartEditing={handleWorkflowTitleStart}
            title={displayWorkflowTitle}
            titleDraft={workflowTitleDraft}
            titleInputRef={workflowTitleInputRef}
          />

          <CanvasWorkflowRunStrip
            onOpenRun={inspectRun}
            run={latestWorkflowRun}
          />
        </div>

        <div
          className={`canvas-top-left-tools__utilities${selectedNode ? ' has-node-panel' : ''}`}
        >
          <div className="canvas-run-control-cluster">
            <CanvasRunControlToggle
              isActive={floatingCard?.type === 'run-control'}
              onClick={() => {
                if (floatingCard?.type === 'run-control') {
                  closeFloatingCard();
                } else {
                  openRunControl();
                }
              }}
            />

            {floatingCard?.type === 'run-control' ? (
              <CanvasRunControlPanel
                activeRun={activeLiveRun}
                backendStatus={backendStatus}
                busyState={busyState}
                deferredEvents={deferredEvents}
                onCancelRun={handleCancelRun}
                onClose={closeFloatingCard}
                onOpenLatestRun={() => {
                  if (runSnapshot?.run_id) {
                    inspectRun(runSnapshot.run_id);
                  }
                }}
                onRun={handleRun}
                onValidate={handleValidate}
                runHistoryCount={runHistory.length}
                runSnapshot={runSnapshot}
                validation={validation}
                validationProblems={problemItems}
                workflowSyncState={workflowSyncState}
              />
            ) : null}
          </div>

          {showCanvasDebug ? (
            <CanvasDebugPanel
              collapsed={isCanvasDebugCollapsed}
              debugState={canvasDebugState}
              onToggleCollapsed={() => setIsCanvasDebugCollapsed((current) => !current)}
            />
          ) : null}
        </div>
      </div>

      <div className="shell-overlay">
        {floatingCard && floatingCard.type !== 'run-control' ? (
          <section className={`floating-card floating-card--${floatingCard.type}`}>
            <CardHeader
              eyebrow={cardEyebrowFor(floatingCard.type)}
              title={cardTitleFor({
                floatingCard,
                activeProblem,
                activeRun,
                selectedNode
              })}
              onClose={closeFloatingCard}
            />

            <div className="floating-card__body">
              {floatingCard.type === 'run-detail' ? (
                <div className="card-stack">
                  <CardMetricGrid
                    metrics={[
                      { label: 'Run', value: activeRun?.run_id ?? 'Unknown' },
                      { label: 'Status', value: humanizeToken(activeRun?.status) },
                      { label: 'Workflow', value: workflow?.name ?? activeRun?.workflow_id ?? 'Unknown' },
                      { label: 'Duration', value: formatCanvasRunDuration(activeRun) },
                      { label: 'Nodes', value: String(activeRun?.node_runs?.length ?? 0) },
                      { label: 'Logs', value: String(activeRunLogs.length) },
                      { label: 'Errors', value: String(countCanvasRunErrors(activeRun)) },
                      { label: 'Retries', value: String(countCanvasRunRetries(activeRun)) }
                    ]}
                  />

                  {activeRun?.error ? (
                    <section className="card-callout card-callout--error">
                      <p>
                        <strong>{humanizeToken(activeRun.error.category)}</strong>
                        {' · '}
                        {activeRun.error.message}
                      </p>
                    </section>
                  ) : null}

                  <SectionBlock title="Run Facts">
                    <div className="drawer-kv-list">
                      <KeyValueRow
                        label="Started"
                        value={formatCanvasRunTimestamp(activeRun?.started_at)}
                      />
                      <KeyValueRow
                        label="Finished"
                        value={formatCanvasRunTimestamp(activeRun?.finished_at)}
                      />
                      <KeyValueRow
                        label="Trigger"
                        value={humanizeToken(activeRun?.trigger?.kind)}
                      />
                      <KeyValueRow
                        label="Failure mode"
                        value={activeRun?.error ? humanizeToken(activeRun.error.category) : 'None'}
                      />
                    </div>
                  </SectionBlock>

                  <SectionBlock title="Node States">
                    {activeRun?.node_runs?.length ? (
                      <div className="drawer-list">
                        {activeRun.node_runs.map((nodeRun) => (
                          <DrawerItemButton
                            key={nodeRun.node_id}
                            icon="N"
                            subtitle={summarizeNodeRunDetail(nodeRun)}
                            title={nodeRun.node_id}
                            badge={humanizeToken(nodeRun.status)}
                            onClick={() => focusNodePanel(nodeRun.node_id)}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState message="Node state will populate once the run begins planning and execution." />
                    )}
                  </SectionBlock>

                  <SectionBlock title="Recent Events">
                    {activeRunEvents.length ? (
                      <div className="drawer-list">
                        {activeRunEvents.slice(-5).reverse().map((event) => (
                          <DrawerItemButton
                            key={event.event_id}
                            icon=">"
                            subtitle={summarizeCanvasEventDetail(event)}
                            title={summarizeCanvasEventTitle(event)}
                            badge={event.sequence}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState message="Event replay appears here once the backend emits lifecycle updates." />
                    )}
                  </SectionBlock>

                  <SectionBlock title="Recent Logs">
                    {activeRunLogs.length ? (
                      <div className="drawer-list">
                        {activeRunLogs.slice(-4).reverse().map((entry, index) => (
                          <DrawerItemButton
                            key={`${entry.timestamp}-${index}`}
                            icon={formatCanvasLogLevelBadge(entry.level)}
                            subtitle={summarizeCanvasLogDetail(entry)}
                            title={entry.message}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState message="Structured logs remain separate from events and will appear here when available." />
                    )}
                  </SectionBlock>
                </div>
              ) : null}

              {floatingCard.type === 'problem-detail' ? (
                <div className="card-stack">
                  <CardMetricGrid
                    metrics={[
                      { label: 'Severity', value: humanizeToken(activeProblem?.severity) },
                      { label: 'Code', value: humanizeToken(activeProblem?.code) },
                      { label: 'Target', value: activeProblem?.target?.label ?? 'Workflow' },
                      { label: 'Path', value: activeProblem?.path ?? 'Workflow' }
                    ]}
                  />

                  <section className="card-callout">
                    <p>{activeProblem?.message ?? 'Issue detail unavailable.'}</p>
                  </section>

                  {activeProblem?.target?.nodeId ? (
                    <button className="accent-button" onClick={() => focusProblemTarget(activeProblem)} type="button">
                      Focus Node
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function CanvasViewportControls({
  isZoomMenuOpen = false,
  onToggleZoomMenu,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
  onZoomToHundred,
  zoomLabel = '100%'
}) {
  return (
    <div className="canvas-viewport-controls" aria-label="Canvas viewport controls">
      <div className="canvas-viewport-controls__dock">
        <button
          aria-label="Pointer tool"
          className="canvas-viewport-controls__button"
          type="button"
        >
          <span className="canvas-viewport-controls__icon canvas-viewport-controls__icon--cursor" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M4.5 3.5L10.6 18.8L12.65 11.95L19.5 9.9L4.5 3.5Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>

        <button
          aria-label="Hand tool"
          className="canvas-viewport-controls__button is-active"
          type="button"
        >
          <span className="canvas-viewport-controls__icon canvas-viewport-controls__icon--hand" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M8.2 10.2V6.2C8.2 5.46 8.8 4.86 9.54 4.86C10.28 4.86 10.88 5.46 10.88 6.2V10.12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M10.88 9.55V4.86C10.88 4.12 11.48 3.52 12.22 3.52C12.96 3.52 13.56 4.12 13.56 4.86V9.7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M13.56 10.1V5.65C13.56 4.91 14.16 4.31 14.9 4.31C15.64 4.31 16.24 4.91 16.24 5.65V11.25"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M16.24 9.88V8.54C16.24 7.8 16.84 7.2 17.58 7.2C18.32 7.2 18.92 7.8 18.92 8.54V12.02C18.92 14.95 16.55 17.32 13.62 17.32H11.92C10.86 17.32 9.84 16.91 9.08 16.18L5.66 12.88C5.13 12.37 5.11 11.52 5.62 10.99C6.14 10.45 6.99 10.44 7.53 10.95L8.2 11.58V10.2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>

        <span className="canvas-viewport-controls__divider" aria-hidden="true" />

        <button
          aria-label="Undo"
          className="canvas-viewport-controls__button"
          type="button"
        >
          <span className="canvas-viewport-controls__icon canvas-viewport-controls__icon--undo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M9 7L4.5 11.5L9 16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5.2 11.5H14.35C17.19 11.5 19.5 13.81 19.5 16.65V17"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>

        <button
          aria-label="Redo"
          className="canvas-viewport-controls__button"
          type="button"
        >
          <span className="canvas-viewport-controls__icon canvas-viewport-controls__icon--redo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M15 7L19.5 11.5L15 16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M18.8 11.5H9.65C6.81 11.5 4.5 13.81 4.5 16.65V17"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>

        <button
          aria-expanded={isZoomMenuOpen}
          aria-label="Zoom options"
          className="canvas-viewport-controls__zoom"
          onClick={onToggleZoomMenu}
          type="button"
        >
          <span>{zoomLabel}</span>
          <span aria-hidden="true" className="canvas-viewport-controls__zoom-caret">
            ˅
          </span>
        </button>
      </div>

      {isZoomMenuOpen ? (
        <aside className="canvas-viewport-controls__menu" aria-label="Zoom menu">
          <button className="canvas-viewport-controls__menu-item" onClick={onZoomIn} type="button">
            <span>Zoom in</span>
            <strong>Ctrl + +</strong>
          </button>
          <button className="canvas-viewport-controls__menu-item" onClick={onZoomOut} type="button">
            <span>Zoom out</span>
            <strong>Ctrl + -</strong>
          </button>
          <button
            className="canvas-viewport-controls__menu-item"
            onClick={onZoomToHundred}
            type="button"
          >
            <span>Zoom to 100%</span>
            <strong>Ctrl + 0</strong>
          </button>
          <button
            className="canvas-viewport-controls__menu-item"
            onClick={onZoomToFit}
            type="button"
          >
            <span>Zoom to fit</span>
            <strong>Ctrl + 1</strong>
          </button>
        </aside>
      ) : null}
    </div>
  );
}

function CanvasNodeManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workspaceConnections = [],
  workflow,
  workflowSyncState = 'local'
}) {
  if (node?.type_id === 'send_email') {
    return (
      <CanvasSendEmailManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workspaceConnections={workspaceConnections}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'text_input') {
    return (
      <CanvasTextInputManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'dolt_repo_source') {
    return (
      <CanvasDoltRepoSourceManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'checkpoint_read') {
    return (
      <CanvasCheckpointReadManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'checkpoint_write') {
    return (
      <CanvasCheckpointWriteManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'quality_check') {
    return (
      <CanvasQualityCheckManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'dolt_repo_sync') {
    return (
      <CanvasDoltRepoSyncManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'dolt_change_manifest') {
    return (
      <CanvasDoltChangeManifestManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'dolt_dump') {
    return (
      <CanvasDoltDumpManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'dolt_diff_export') {
    return (
      <CanvasDoltDiffExportManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'load_to_duckdb') {
    return (
      <CanvasLoadToDuckDbManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'sql_transform') {
    return (
      <CanvasSqlTransformManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'table_merge') {
    return (
      <CanvasTableMergeManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'table_input') {
    return (
      <CanvasTableInputManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'table_schema') {
    return (
      <CanvasTableSchemaManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  if (node?.type_id === 'table_output') {
    return (
      <CanvasTableOutputManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
        workflow={workflow}
        workflowSyncState={workflowSyncState}
      />
    );
  }

  const model = buildCanvasNodeManagementModel(node, definition);
  const executionTiming = normalizeNodeExecutionTimingConfig(node?.config ?? {});

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            {model.icon}
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{model.title}</strong>
            <code className="canvas-node-panel__title-subtitle">{model.subtitle}</code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{model.meta}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        {model.fields.map((field) => (
          <div className="canvas-node-panel__field" key={field.label}>
            <div className="canvas-node-panel__field-head">
              <label>{field.label}</label>
              <span className="canvas-node-panel__hint" aria-hidden="true">
                i
              </span>
            </div>

            {field.kind === 'select' ? (
              <button className="canvas-node-panel__select" type="button">
                <span>{field.value}</span>
                <span className="canvas-node-panel__caret" aria-hidden="true">
                  ⌄
                </span>
              </button>
            ) : (
              <div className="canvas-node-panel__slider-row">
                <div className="canvas-node-panel__slider-track" aria-hidden="true">
                  <span
                    className="canvas-node-panel__slider-fill"
                    style={{ width: `${field.percent}%` }}
                  />
                  <span
                    className="canvas-node-panel__slider-thumb"
                    style={{ left: `${field.percent}%` }}
                  />
                </div>
                <div className="canvas-node-panel__value-box">{field.value}</div>
              </div>
            )}
          </div>
        ))}

        {model.toggles.map((toggle) => (
          <div className="canvas-node-panel__toggle-row" key={toggle.label}>
            <label className="canvas-node-panel__checkbox">
              <input checked={toggle.checked} readOnly type="checkbox" />
              <span className="canvas-node-panel__checkmark" aria-hidden="true" />
              <span>{toggle.label}</span>
            </label>
          </div>
        ))}
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'node'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyGenericNodeConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={executionTiming}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">{model.footerEyebrow}</p>

        <div className="canvas-node-panel__footer-row">
          <span>Runs</span>
          <div className="canvas-node-panel__stepper">
            <button aria-label="Decrease runs" type="button">-</button>
            <strong>1</strong>
            <button aria-label="Increase runs" type="button">+</button>
          </div>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>{model.footerMetricLabel}</span>
          <strong>{model.footerMetricValue}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{model.actionLabel}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasNodePanelSelect({
  id,
  onChange,
  options = [],
  value = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const listboxId = `${id}-listbox`;
  const activeOption =
    options.find((option) => option.value === value) ??
    (value
      ? {
          label: value,
          value
        }
      : options[0] ?? {
          label: 'Select',
          value: ''
        });

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (rootRef.current?.contains(event.target)) {
        return;
      }

      setIsOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      className={`canvas-node-panel__select-wrap${isOpen ? ' is-open' : ''}`}
      ref={rootRef}
    >
      <button
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="canvas-node-panel__select"
        id={id}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        value={activeOption.value}
      >
        <span className="canvas-node-panel__select-label">{activeOption.label}</span>
        <span className="canvas-node-panel__caret" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div
          aria-labelledby={id}
          className="canvas-node-panel__select-panel"
          id={listboxId}
          role="listbox"
        >
          {options.map((option) => {
            const isSelected = option.value === activeOption.value;

            return (
              <button
                aria-selected={isSelected}
                className={`canvas-node-panel__select-option${
                  isSelected ? ' is-selected' : ''
                }`}
                key={option.value}
                onClick={() => {
                  onChange?.(option.value);
                  setIsOpen(false);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                <span
                  aria-hidden="true"
                  className="canvas-node-panel__select-option-check"
                >
                  {isSelected ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CanvasTableShapeSection({
  ariaLabel = 'Result table shape',
  groups = [],
  label = 'Result table shape'
}) {
  return (
    <div className="canvas-node-panel__field">
      <div className="canvas-node-panel__field-head">
        <label>{label}</label>
      </div>

      <div
        aria-label={ariaLabel}
        className="canvas-node-panel__shape-groups"
      >
        {groups.length ? (
          groups.map((group, index) => (
            <details
              className="canvas-node-panel__shape-group"
              key={group.name}
              open={groups.length === 1 || index === 0}
            >
              <summary className="canvas-node-panel__shape-group-summary">
                <span>{group.name}</span>
                <strong>
                  {group.columns.length} col{group.columns.length === 1 ? '' : 's'}
                </strong>
              </summary>

              <div className="canvas-node-panel__code">
                {group.columns.map((column) => (
                  <div className="canvas-node-panel__code-line" key={`${group.name}:${column.name}`}>
                    <span>{column.name}</span>
                    <strong>{column.definition}</strong>
                  </div>
                ))}
              </div>
            </details>
          ))
        ) : (
          <div className="canvas-node-panel__code">
            <div className="canvas-node-panel__code-line">
              <span>Awaiting schema</span>
              <strong>Connect a table schema input</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DoltRepoSourceIcon({ className = '' }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 16C1.791 16 0 14.209 0 12V8C0 5.791 1.791 4 4 4H6V1.75C6 0.784 6.784 0 7.75 0C8.716 0 9.5 0.784 9.5 1.75V12C9.5 14.209 7.709 16 5.5 16H4ZM4 7.5C3.724 7.5 3.5 7.724 3.5 8V12C3.5 12.276 3.724 12.5 4 12.5H5.5C5.776 12.5 6 12.276 6 12V7.5H4Z"
        fill="currentColor"
      />
    </svg>
  );
}

function DuckDbIcon({ className = '' }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" fill="currentColor" r="8" />
      <circle cx="5.2" cy="8" fill="#f8d106" r="3.1" />
      <path
        d="M10.2 6.5H11.65C12.6777 6.5 13.5 7.32235 13.5 8.35C13.5 9.37765 12.6777 10.2 11.65 10.2H10.2V6.5Z"
        fill="#f8d106"
      />
    </svg>
  );
}

function CanvasDoltRepoSourceManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflowSyncState = 'local'
}) {
  const config = normalizeDoltRepoSourcePanelConfig(node);
  const connectionOptions = buildDoltRepoSourceConnectionOptions(config.connection_ref);
  const branchOptions = buildDoltRepoSourceBranchOptions(config.branch);
  const runtimeSummary = buildDoltRepoSourceRuntimeSummary(config);

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon canvas-node-panel__title-icon--dolt" aria-hidden="true">
            <DoltRepoSourceIcon className="canvas-node-panel__brand-icon" />
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Dolt Repo Source'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'dolt_repo_source'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{definition?.outputs?.length === 1 ? '1 output' : `${definition?.outputs?.length ?? 0} outputs`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current repo state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current repo state">
            <div className="canvas-node-panel__code-line">
              <span>repo_family</span>
              <strong>{runtimeSummary.repoFamily}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>sync_strategy</span>
              <strong>{runtimeSummary.syncStrategyLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>working_copy</span>
              <strong>{runtimeSummary.workingCopy}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>current_commit</span>
              <strong>{runtimeSummary.currentCommit}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-source-label">Label</label>
          </div>
          <input
            id="canvas-dolt-repo-source-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-source-connection">Connection ref</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-repo-source-connection"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSourceConfigUpdate(currentConfig, {
                  connection_ref: nextValue
                })
              )
            }
            options={connectionOptions}
            value={config.connection_ref}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-source-repository">Repository</label>
          </div>
          <input
            id="canvas-dolt-repo-source-repository"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSourceConfigUpdate(currentConfig, {
                  repository: event.target.value
                })
              )
            }
            type="text"
            value={config.repository}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-source-branch">Branch</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-repo-source-branch"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSourceConfigUpdate(currentConfig, {
                  branch: nextValue
                })
              )
            }
            options={branchOptions}
            value={config.branch}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-source-checkout-ref">Checkout ref override</label>
          </div>
          <input
            id="canvas-dolt-repo-source-checkout-ref"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSourceConfigUpdate(currentConfig, {
                  checkout_ref: event.target.value
                })
              )
            }
            type="text"
            value={config.checkout_ref}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-source-clone-mode">Clone mode</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-repo-source-clone-mode"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSourceConfigUpdate(currentConfig, {
                  clone_mode: nextValue
                })
              )
            }
            options={[
              { label: 'Reuse local working copy', value: 'reuse_local_copy' },
              { label: 'Fresh clone per run', value: 'fresh_clone' },
              { label: 'Depth 1 checkout', value: 'depth_1' }
            ]}
            value={config.clone_mode}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-source-sync-strategy">Sync strategy</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-repo-source-sync-strategy"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSourceConfigUpdate(currentConfig, {
                  sync_strategy: nextValue
                })
              )
            }
            options={[
              { label: 'Pull before execution', value: 'pull_before_execution' },
              { label: 'Clone only on bootstrap', value: 'clone_only' },
              { label: 'Manual sync only', value: 'manual' }
            ]}
            value={config.sync_strategy}
          />
        </div>

      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'dolt_repo_source'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyDoltRepoSourceConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Output contract</p>

        <div className="canvas-node-panel__footer-row">
          <span>Repo ref</span>
          <strong>{config.repository}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Branch</span>
          <strong>{config.branch}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Sync</span>
          <strong>{runtimeSummary.syncStrategyLabel}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasCheckpointReadManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflowSyncState = 'local'
}) {
  const config = normalizeCheckpointReadPanelConfig(node);
  const runtimeSummary = buildCheckpointReadRuntimeSummary(config);
  const branchOptions = buildDoltRepoSourceBranchOptions(config.branch);
  const outputCount = definition?.outputs?.length ?? 1;

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            R
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Checkpoint Read'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'checkpoint_read'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{outputCount === 1 ? '1 output' : `${outputCount} outputs`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current checkpoint state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current checkpoint state">
            <div className="canvas-node-panel__code-line">
              <span>checkpoint_store</span>
              <strong>{runtimeSummary.checkpointTable}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>last_synced_commit</span>
              <strong>{runtimeSummary.lastSyncedCommit}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>last_success_at</span>
              <strong>{runtimeSummary.lastSuccessAt}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>last_ingest_mode</span>
              <strong>{runtimeSummary.lastIngestMode}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-checkpoint-read-label">Label</label>
          </div>
          <input
            id="canvas-checkpoint-read-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-checkpoint-read-table">Checkpoint table</label>
          </div>
          <input
            id="canvas-checkpoint-read-table"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyCheckpointReadConfigUpdate(currentConfig, {
                  checkpoint_table: event.target.value
                })
              )
            }
            type="text"
            value={config.checkpoint_table}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-checkpoint-read-repo">Source repo</label>
          </div>
          <input
            id="canvas-checkpoint-read-repo"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyCheckpointReadConfigUpdate(currentConfig, {
                  source_repo: event.target.value
                })
              )
            }
            type="text"
            value={config.source_repo}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-checkpoint-read-branch">Branch</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-checkpoint-read-branch"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyCheckpointReadConfigUpdate(currentConfig, {
                  branch: nextValue
                })
              )
            }
            options={branchOptions}
            value={config.branch}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Output contract</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Checkpoint output contract">
            <div className="canvas-node-panel__code-line">
              <span>payload</span>
              <strong>checkpoint_context</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>previous_commit</span>
              <strong>last_synced_commit</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>success_metadata</span>
              <strong>last_success_at + last_ingest_mode</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.emit_bootstrap_marker_if_missing}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyCheckpointReadConfigUpdate(currentConfig, {
                    emit_bootstrap_marker_if_missing: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Emit bootstrap marker if missing</span>
          </label>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.fail_on_stale_checkpoint}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyCheckpointReadConfigUpdate(currentConfig, {
                    fail_on_stale_checkpoint: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Fail on stale checkpoint</span>
          </label>
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'checkpoint_read'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyCheckpointReadConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Recurring handoff</p>

        <div className="canvas-node-panel__footer-row">
          <span>Scope</span>
          <strong>Repo + branch</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Output</span>
          <strong>checkpoint_context</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Downstream</span>
          <strong>dolt_repo_sync</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasDoltRepoSyncManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeDoltRepoSyncPanelConfig(node);
  const runtimeSummary = buildDoltRepoSyncRuntimeSummary(
    config,
    workflow,
    node?.node_id
  );
  const inputCount = definition?.inputs?.length ?? 1;
  const outputCount = definition?.outputs?.length ?? 1;

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon canvas-node-panel__title-icon--dolt" aria-hidden="true">
            <DoltRepoSourceIcon className="canvas-node-panel__brand-icon" />
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Dolt Repo Sync'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'dolt_repo_sync'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`${inputCount} input${inputCount === 1 ? '' : 's'} · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current sync state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current sync state">
            <div className="canvas-node-panel__code-line">
              <span>repo_family</span>
              <strong>{runtimeSummary.repoFamily}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>previous_commit</span>
              <strong>{runtimeSummary.previousCommit}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>current_commit</span>
              <strong>{runtimeSummary.currentCommit}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>sync_action</span>
              <strong>{runtimeSummary.syncActionLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-sync-label">Label</label>
          </div>
          <input
            id="canvas-dolt-repo-sync-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Input repo handle</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Input repo handle">
            <div className="canvas-node-panel__code-line">
              <span>resolved repo</span>
              <strong>{runtimeSummary.repository}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>handle</span>
              <strong>dataset_ref.repo_ref</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Previous commit source</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Previous commit source">
            <div className="canvas-node-panel__code-line">
              <span>checkpoint</span>
              <strong>{runtimeSummary.checkpointSourceLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>resolved value</span>
              <strong>{runtimeSummary.previousCommit}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-sync-action">Sync action</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-repo-sync-action"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSyncConfigUpdate(currentConfig, {
                  sync_action: nextValue
                })
              )
            }
            options={[
              { label: 'Pull remote head', value: 'pull_remote_head' },
              { label: 'Fetch and checkout', value: 'fetch_and_checkout' },
              { label: 'Refresh checkout', value: 'refresh_checkout' }
            ]}
            value={config.sync_action}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-sync-no-change">No-change behavior</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-repo-sync-no-change"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSyncConfigUpdate(currentConfig, {
                  no_change_behavior: nextValue
                })
              )
            }
            options={[
              { label: 'Emit same from/to commit', value: 'emit_current_range' },
              { label: 'Emit no-op marker', value: 'emit_no_op_marker' }
            ]}
            value={config.no_change_behavior}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-sync-branch-guard">Branch guard</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-repo-sync-branch-guard"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSyncConfigUpdate(currentConfig, {
                  branch_guard: nextValue
                })
              )
            }
            options={[
              {
                label: 'Require tracked branch match',
                value: 'require_tracked_branch_match'
              },
              { label: 'Allow detached head', value: 'allow_detached_head' }
            ]}
            value={config.branch_guard}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-repo-sync-dirty-policy">Dirty working copy policy</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-repo-sync-dirty-policy"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltRepoSyncConfigUpdate(currentConfig, {
                  dirty_working_copy_policy: nextValue
                })
              )
            }
            options={[
              { label: 'Fail if local repo is dirty', value: 'fail_if_dirty' },
              { label: 'Stash and continue', value: 'stash_and_continue' }
            ]}
            value={config.dirty_working_copy_policy}
          />
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'dolt_repo_sync'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyDoltRepoSyncConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Output contract</p>

        <div className="canvas-node-panel__footer-row">
          <span>Repo</span>
          <strong>{runtimeSummary.repository}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Range</span>
          <strong>{`${runtimeSummary.previousCommit} -> ${runtimeSummary.currentCommit}`}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Output</span>
          <strong>repo + sync metadata</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasSendEmailManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workspaceConnections = [],
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeSendEmailPanelConfig(node, workflow);
  const connectionOptions = buildSendEmailConnectionOptions(
    config.connection_id,
    workspaceConnections
  );

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            @
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Send Email'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'send_email'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{definition?.inputs?.length === 1 ? '1 input' : `${definition?.inputs?.length ?? 0} inputs`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-send-email-label">Label</label>
          </div>
          <input
            id="canvas-send-email-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-send-email-to">To</label>
          </div>
          <input
            id="canvas-send-email-to"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applySendEmailConfigUpdate(currentConfig, {
                  to: event.target.value
                })
              )
            }
            type="text"
            value={config.to}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-send-email-subject">Subject</label>
          </div>
          <input
            id="canvas-send-email-subject"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applySendEmailConfigUpdate(currentConfig, {
                  subject: event.target.value
                })
              )
            }
            type="text"
            value={config.subject}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-send-email-body-mode">Body source</label>
            <span className="canvas-node-panel__hint" aria-hidden="true">
              i
            </span>
          </div>
          <CanvasNodePanelSelect
            id="canvas-send-email-body-mode"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applySendEmailConfigUpdate(currentConfig, {
                  body_mode: nextValue
                })
              )
            }
            options={[
              { label: 'From input', value: 'input' },
              { label: 'Custom text', value: 'custom' }
            ]}
            value={config.body_mode}
          />
        </div>

        {config.body_mode === 'custom' ? (
          <div className="canvas-node-panel__field">
            <div className="canvas-node-panel__field-head">
              <label htmlFor="canvas-send-email-body">Custom body</label>
            </div>
            <textarea
              id="canvas-send-email-body"
              className="canvas-node-panel__textarea"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applySendEmailConfigUpdate(currentConfig, {
                    body_text: event.target.value
                  })
                )
              }
              rows={5}
              value={config.body_text}
            />
          </div>
        ) : null}

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-send-email-connection">Connection</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-send-email-connection"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applySendEmailConfigUpdate(currentConfig, {
                  connection_id: nextValue
                })
              )
            }
            options={connectionOptions}
            value={config.connection_id}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Format</label>
          </div>
          <div className="canvas-node-panel__segmented" aria-label="Message format">
            <button
              className={`canvas-node-panel__segment${
                config.content_type === 'text/plain' ? ' is-active' : ''
              }`}
              onClick={() =>
                onNodeConfigChange?.((currentConfig) =>
                  applySendEmailConfigUpdate(currentConfig, {
                    content_type: 'text/plain'
                  })
                )
              }
              type="button"
            >
              Plain text
            </button>
            <button
              className={`canvas-node-panel__segment${
                config.content_type === 'text/html' ? ' is-active' : ''
              }`}
              onClick={() =>
                onNodeConfigChange?.((currentConfig) =>
                  applySendEmailConfigUpdate(currentConfig, {
                    content_type: 'text/html'
                  })
                )
              }
              type="button"
            >
              HTML
            </button>
          </div>
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'send_email'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applySendEmailConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Current workflow</p>

        <div className="canvas-node-panel__footer-row">
          <span>Autosave</span>
          <strong>Enabled</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Node ID</span>
          <strong>{node?.node_id ?? 'send_email'}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasTextInputManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflowSyncState = 'local'
}) {
  const config = normalizeTextInputPanelConfig(node);

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            T
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Text Input'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'text_input'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{definition?.outputs?.length === 1 ? '1 output' : `${definition?.outputs?.length ?? 0} outputs`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-text-input-label">Label</label>
          </div>
          <input
            id="canvas-text-input-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-text-input-text">Text</label>
          </div>
          <textarea
            id="canvas-text-input-text"
            className="canvas-node-panel__textarea canvas-node-panel__textarea--tall"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTextInputConfigUpdate(currentConfig, {
                  text: event.target.value
                })
              )
            }
            rows={7}
            value={config.text}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-text-input-trim-mode">Trim mode</label>
            <span className="canvas-node-panel__hint" aria-hidden="true">
              i
            </span>
          </div>
          <CanvasNodePanelSelect
            id="canvas-text-input-trim-mode"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTextInputConfigUpdate(currentConfig, {
                  trim_mode: nextValue
                })
              )
            }
            options={[
              { label: 'Automatic', value: 'automatic' },
              { label: 'Trim edges', value: 'trim' },
              { label: 'Keep exact', value: 'exact' }
            ]}
            value={config.trim_mode}
          />
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.preserve_whitespace}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTextInputConfigUpdate(currentConfig, {
                    preserve_whitespace: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Preserve whitespace</span>
          </label>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.include_line_breaks}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTextInputConfigUpdate(currentConfig, {
                    include_line_breaks: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Include line breaks</span>
          </label>
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'text_input'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyTextInputConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Current workflow</p>

        <div className="canvas-node-panel__footer-row">
          <span>Autosave</span>
          <strong>Enabled</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Length</span>
          <strong>{`${config.text.length} chars`}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasDoltChangeManifestManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeDoltChangeManifestPanelConfig(node);
  const runtimeSummary = buildDoltChangeManifestRuntimeSummary(
    config,
    workflow,
    node?.node_id
  );
  const outputCount = definition?.outputs?.length ?? 1;

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon canvas-node-panel__title-icon--dolt" aria-hidden="true">
            <DoltRepoSourceIcon className="canvas-node-panel__brand-icon" />
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Dolt Change Manifest'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'dolt_change_manifest'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`1 input · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Manifest preview</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Manifest preview">
            <div className="canvas-node-panel__code-line">
              <span>changed_tables</span>
              <strong>{`${runtimeSummary.changedTables.length} tables`}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>schema_drift</span>
              <strong>{runtimeSummary.schemaDriftLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>row_counts</span>
              <strong>best effort</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-change-manifest-label">Label</label>
          </div>
          <input
            id="canvas-dolt-change-manifest-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Input repo handle</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Input repo handle">
            <div className="canvas-node-panel__code-line">
              <span>resolved repo</span>
              <strong>{runtimeSummary.repository}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>handle</span>
              <strong>dataset_ref.repo_ref</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Resolved range</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Resolved range">
            <div className="canvas-node-panel__code-line">
              <span>previous_commit</span>
              <strong>{runtimeSummary.previousCommit}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>current_commit</span>
              <strong>{runtimeSummary.currentCommit}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-change-manifest-scope">Table scope</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-change-manifest-scope"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltChangeManifestConfigUpdate(currentConfig, {
                  table_scope: nextValue
                })
              )
            }
            options={[
              { label: 'All tables in repo', value: 'all_tables' },
              { label: 'Selected tables only', value: 'allowlist' }
            ]}
            value={config.table_scope}
          />
        </div>

        {config.table_scope === 'allowlist' ? (
          <div className="canvas-node-panel__field">
            <div className="canvas-node-panel__field-head">
              <label htmlFor="canvas-dolt-change-manifest-selected-tables">Selected tables</label>
            </div>
            <input
              id="canvas-dolt-change-manifest-selected-tables"
              className="canvas-node-panel__input"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyDoltChangeManifestConfigUpdate(currentConfig, {
                    selected_tables_text: event.target.value
                  })
                )
              }
              placeholder="earnings_calendar, eps_history"
              type="text"
              value={config.selected_tables_text}
            />
          </div>
        ) : null}

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-change-manifest-schema-policy">Schema change policy</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-change-manifest-schema-policy"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltChangeManifestConfigUpdate(currentConfig, {
                  schema_change_policy: nextValue
                })
              )
            }
            options={[
              { label: 'Flag and continue', value: 'flag_and_continue' },
              { label: 'Fail run on schema drift', value: 'fail_run' }
            ]}
            value={config.schema_change_policy}
          />
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'dolt_change_manifest'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyDoltChangeManifestConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Output contract</p>

        <div className="canvas-node-panel__footer-row">
          <span>Range</span>
          <strong>{`${runtimeSummary.previousCommit} -> ${runtimeSummary.currentCommit}`}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Scope</span>
          <strong>{runtimeSummary.scopeLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Output</span>
          <strong>manifest + change metadata</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasDoltDumpManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeDoltDumpPanelConfig(node);
  const runtimeSummary = buildDoltDumpRuntimeSummary(config, workflow, node?.node_id);
  const outputCount = definition?.outputs?.length ?? 1;

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon canvas-node-panel__title-icon--dolt" aria-hidden="true">
            <DoltRepoSourceIcon className="canvas-node-panel__brand-icon" />
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Dolt Dump'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'dolt_dump'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`1 input · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current export state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current export state">
            <div className="canvas-node-panel__code-line">
              <span>repo_family</span>
              <strong>{runtimeSummary.repoFamily}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>source_kind</span>
              <strong>{runtimeSummary.sourceKind}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>scope</span>
              <strong>{runtimeSummary.scopeLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>export_format</span>
              <strong>{runtimeSummary.formatLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-dump-label">Label</label>
          </div>
          <input
            id="canvas-dolt-dump-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Input handle</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Input handle">
            <div className="canvas-node-panel__code-line">
              <span>resolved repo</span>
              <strong>{runtimeSummary.repository}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>handle kind</span>
              <strong>{runtimeSummary.sourceHandleLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-dump-selection-mode">Table selection mode</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-dump-selection-mode"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltDumpConfigUpdate(currentConfig, {
                  table_selection_mode: nextValue
                })
              )
            }
            options={[
              {
                label: 'Prefer manifest scope, else all tables',
                value: 'prefer_manifest_scope'
              },
              { label: 'All tables in repo', value: 'all_tables' },
              { label: 'Manual table list', value: 'manual_tables' }
            ]}
            value={config.table_selection_mode}
          />
        </div>

        {config.table_selection_mode === 'manual_tables' ? (
          <div className="canvas-node-panel__field">
            <div className="canvas-node-panel__field-head">
              <label htmlFor="canvas-dolt-dump-selected-tables">Selected tables</label>
            </div>
            <input
              id="canvas-dolt-dump-selected-tables"
              className="canvas-node-panel__input"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyDoltDumpConfigUpdate(currentConfig, {
                    selected_tables_text: event.target.value
                  })
                )
              }
              placeholder="earnings_calendar, income_statement"
              type="text"
              value={config.selected_tables_text}
            />
          </div>
        ) : null}

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-dump-output-format">File format</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-dump-output-format"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltDumpConfigUpdate(currentConfig, {
                  output_format: nextValue
                })
              )
            }
            options={[
              { label: 'Parquet', value: 'parquet' },
              { label: 'CSV', value: 'csv' }
            ]}
            value={config.output_format}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-dump-retention">Artifact retention</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-dump-retention"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltDumpConfigUpdate(currentConfig, {
                  artifact_retention: nextValue
                })
              )
            }
            options={[
              { label: 'Keep latest successful bundle', value: 'keep_latest_success' },
              { label: 'Ephemeral per run', value: 'ephemeral_per_run' },
              { label: 'Persist all bundles', value: 'persist_all' }
            ]}
            value={config.artifact_retention}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-dump-output-directory">Output directory policy</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-dump-output-directory"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltDumpConfigUpdate(currentConfig, {
                  output_directory_policy: nextValue
                })
              )
            }
            options={[
              { label: 'Ephemeral run bundle', value: 'ephemeral_run_bundle' },
              { label: 'Stable repo cache', value: 'stable_repo_cache' }
            ]}
            value={config.output_directory_policy}
          />
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'dolt_dump'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyDoltDumpConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Output contract</p>

        <div className="canvas-node-panel__footer-row">
          <span>Format</span>
          <strong>{runtimeSummary.formatLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Tables</span>
          <strong>{runtimeSummary.scopeLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Output</span>
          <strong>directory_ref + table manifest</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasDoltDiffExportManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeDoltDiffExportPanelConfig(node);
  const runtimeSummary = buildDoltDiffExportRuntimeSummary(config, workflow, node?.node_id);
  const outputCount = definition?.outputs?.length ?? 1;

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon canvas-node-panel__title-icon--dolt" aria-hidden="true">
            <DoltRepoSourceIcon className="canvas-node-panel__brand-icon" />
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Dolt Diff Export'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'dolt_diff_export'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`1 input · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current delta state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current delta state">
            <div className="canvas-node-panel__code-line">
              <span>range</span>
              <strong>{runtimeSummary.rangeLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>changed_tables</span>
              <strong>{runtimeSummary.scopeLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>change_filter</span>
              <strong>{runtimeSummary.filterLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>delete_rows</span>
              <strong>{runtimeSummary.deleteRowsLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-diff-export-label">Label</label>
          </div>
          <input
            id="canvas-dolt-diff-export-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Input manifest</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Input manifest">
            <div className="canvas-node-panel__code-line">
              <span>resolved repo</span>
              <strong>{runtimeSummary.repository}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>scope</span>
              <strong>{runtimeSummary.scopeLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-diff-export-change-filter">Change filter</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-diff-export-change-filter"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltDiffExportConfigUpdate(currentConfig, {
                  change_filter: nextValue
                })
              )
            }
            options={[
              { label: 'All changes', value: 'all_changes' },
              { label: 'Non-delete changes', value: 'non_delete_changes' },
              { label: 'Added only', value: 'added_only' },
              { label: 'Modified only', value: 'modified_only' },
              { label: 'Removed only', value: 'removed_only' }
            ]}
            value={config.change_filter}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-diff-export-output-format">File format</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-diff-export-output-format"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltDiffExportConfigUpdate(currentConfig, {
                  output_format: nextValue
                })
              )
            }
            options={[
              { label: 'Parquet', value: 'parquet' },
              { label: 'CSV', value: 'csv' }
            ]}
            value={config.output_format}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-dolt-diff-export-delete-handling">Deleted row handling</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-dolt-diff-export-delete-handling"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyDoltDiffExportConfigUpdate(currentConfig, {
                  deleted_row_handling: nextValue
                })
              )
            }
            options={[
              { label: 'Emit delete markers', value: 'emit_delete_markers' },
              { label: 'Omit delete rows', value: 'omit_delete_rows' }
            ]}
            value={config.deleted_row_handling}
          />
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'dolt_diff_export'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyDoltDiffExportConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Output contract</p>

        <div className="canvas-node-panel__footer-row">
          <span>Range</span>
          <strong>{runtimeSummary.rangeLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Filter</span>
          <strong>{runtimeSummary.filterLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Output</span>
          <strong>directory_ref + delta manifest</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasCheckpointWriteManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeCheckpointWritePanelConfig(node);
  const runtimeSummary = buildCheckpointWriteRuntimeSummary(
    config,
    workflow,
    node?.node_id
  );
  const outputCount = definition?.outputs?.length ?? 1;

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            W
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Checkpoint Write'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'checkpoint_write'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`1 input · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current checkpoint plan</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current checkpoint plan">
            <div className="canvas-node-panel__code-line">
              <span>checkpoint_store</span>
              <strong>{runtimeSummary.checkpointTable}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>current_commit</span>
              <strong>{runtimeSummary.currentCommit}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>last_ingest_mode</span>
              <strong>{runtimeSummary.lastIngestMode}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>scope</span>
              <strong>{runtimeSummary.scopeLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-checkpoint-write-label">Label</label>
          </div>
          <input
            id="canvas-checkpoint-write-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Input durable table</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Input durable table">
            <div className="canvas-node-panel__code-line">
              <span>repo</span>
              <strong>{runtimeSummary.repository}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>tables</span>
              <strong>{runtimeSummary.sourceTablesLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>commit_source</span>
              <strong>{runtimeSummary.commitSource}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-checkpoint-write-table">Checkpoint table</label>
          </div>
          <input
            id="canvas-checkpoint-write-table"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyCheckpointWriteConfigUpdate(currentConfig, {
                  checkpoint_table: event.target.value
                })
              )
            }
            type="text"
            value={config.checkpoint_table}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-checkpoint-write-commit-source">Commit source</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-checkpoint-write-commit-source"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyCheckpointWriteConfigUpdate(currentConfig, {
                  commit_source: nextValue
                })
              )
            }
            options={[
              {
                label: 'metadata.current_commit',
                value: 'metadata.current_commit'
              }
            ]}
            value={config.commit_source}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-checkpoint-write-timing">Write timing</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-checkpoint-write-timing"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyCheckpointWriteConfigUpdate(currentConfig, {
                  write_timing: nextValue
                })
              )
            }
            options={[
              { label: 'After merge success', value: 'after_merge_success' },
              { label: 'After quality gate', value: 'after_quality_gate' }
            ]}
            value={config.write_timing}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Output contract</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Checkpoint write output contract">
            <div className="canvas-node-panel__code-line">
              <span>table_ref</span>
              <strong>pass-through durable table</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>metadata.checkpoint_write</span>
              <strong>checkpoint_write_result</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>persisted fields</span>
              <strong>last_synced_commit + persisted_at</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.only_persist_on_full_success}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyCheckpointWriteConfigUpdate(currentConfig, {
                    only_persist_on_full_success: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Only persist on full success</span>
          </label>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.advance_on_partial_success}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyCheckpointWriteConfigUpdate(currentConfig, {
                    advance_on_partial_success: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Advance on partial success</span>
          </label>
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'checkpoint_write'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyCheckpointWriteConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Checkpoint persistence</p>

        <div className="canvas-node-panel__footer-row">
          <span>Write gate</span>
          <strong>{runtimeSummary.writeGateLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Timing</span>
          <strong>{runtimeSummary.writeTimingLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Commit source</span>
          <strong>{runtimeSummary.commitSource}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasQualityCheckManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeQualityCheckPanelConfig(node);
  const runtimeSummary = buildQualityCheckRuntimeSummary(config, workflow, node?.node_id);
  const outputCount = definition?.outputs?.length ?? 1;

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            Q
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Quality Check'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'quality_check'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`1 input · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current gate state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current gate state">
            <div className="canvas-node-panel__code-line">
              <span>suite</span>
              <strong>{runtimeSummary.suitePresetLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>gate_status</span>
              <strong>{runtimeSummary.gateStatusLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>approved_tables</span>
              <strong>{runtimeSummary.approvedTablesLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>current_commit</span>
              <strong>{runtimeSummary.currentCommit}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-quality-check-label">Label</label>
          </div>
          <input
            id="canvas-quality-check-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Input durable table</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Input durable table">
            <div className="canvas-node-panel__code-line">
              <span>repo</span>
              <strong>{runtimeSummary.repository}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>tables</span>
              <strong>{runtimeSummary.sourceTablesLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>scope</span>
              <strong>{runtimeSummary.scopeLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-quality-check-suite-preset">Suite preset</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-quality-check-suite-preset"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyQualityCheckConfigUpdate(currentConfig, {
                  suite_preset: nextValue
                })
              )
            }
            options={[
              { label: 'Post-merge ingest gate', value: 'post_merge_ingest_gate' },
              { label: 'Custom rule bundle', value: 'custom_rule_bundle' }
            ]}
            value={config.suite_preset}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-quality-check-schema-drift-rule">Schema drift rule</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-quality-check-schema-drift-rule"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyQualityCheckConfigUpdate(currentConfig, {
                  schema_drift_rule: nextValue
                })
              )
            }
            options={[
              {
                label: 'Fail on required column drift',
                value: 'fail_on_required_column_drift'
              },
              {
                label: 'Allow additive schema notes',
                value: 'allow_additive_schema_notes'
              }
            ]}
            value={config.schema_drift_rule}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-quality-check-null-key-policy">Null key policy</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-quality-check-null-key-policy"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyQualityCheckConfigUpdate(currentConfig, {
                  null_key_policy: nextValue
                })
              )
            }
            options={[
              {
                label: 'Block on primary-key nulls',
                value: 'block_on_primary_key_nulls'
              },
              {
                label: 'Allow nulls with warning',
                value: 'allow_nulls_with_warning'
              }
            ]}
            value={config.null_key_policy}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-quality-check-warning-budget">Warning budget</label>
          </div>
          <input
            id="canvas-quality-check-warning-budget"
            className="canvas-node-panel__input"
            min="0"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyQualityCheckConfigUpdate(currentConfig, {
                  warning_budget: event.target.value
                })
              )
            }
            type="number"
            value={config.warning_budget}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Output contract</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Quality check output contract">
            <div className="canvas-node-panel__code-line">
              <span>table_ref</span>
              <strong>pass-through durable table</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>metadata.quality_check</span>
              <strong>quality_gate_result</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>gate payload</span>
              <strong>pass | warn | fail</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.block_checkpoint_write_on_failure}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyQualityCheckConfigUpdate(currentConfig, {
                    block_checkpoint_write_on_failure: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Block checkpoint write on failure</span>
          </label>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.allow_warning_only_runs_to_continue}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyQualityCheckConfigUpdate(currentConfig, {
                    allow_warning_only_runs_to_continue: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Allow warning-only runs to continue</span>
          </label>
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'quality_check'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyQualityCheckConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Quality gate</p>

        <div className="canvas-node-panel__footer-row">
          <span>Last result</span>
          <strong>{runtimeSummary.lastResultLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Gate</span>
          <strong>{runtimeSummary.gateLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Warning budget</span>
          <strong>{runtimeSummary.warningBudgetLabel}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasLoadToDuckDbManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeLoadToDuckDbPanelConfig(node);
  const runtimeSummary = buildLoadToDuckDbRuntimeSummary(config, workflow, node?.node_id);
  const outputCount = definition?.outputs?.length ?? 1;
  const targetSchemaOptions = buildLoadToDuckDbSchemaOptions(config.target_schema);

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span
            className="canvas-node-panel__title-icon canvas-node-panel__title-icon--duckdb"
            aria-hidden="true"
          >
            <DuckDbIcon className="canvas-node-panel__brand-icon" />
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Load to DuckDB'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'load_to_duckdb'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`1 input · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current staging state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current staging state">
            <div className="canvas-node-panel__code-line">
              <span>bundle_mode</span>
              <strong>{runtimeSummary.bundleModeLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>loaded_tables</span>
              <strong>{runtimeSummary.loadedTablesLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>target_schema</span>
              <strong>{runtimeSummary.targetSchema}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>merge_context</span>
              <strong>{runtimeSummary.mergeContextLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-load-to-duckdb-label">Label</label>
          </div>
          <input
            id="canvas-load-to-duckdb-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Input bundle</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Input bundle">
            <div className="canvas-node-panel__code-line">
              <span>accepted kinds</span>
              <strong>dump + diff bundles</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>resolved input</span>
              <strong>{runtimeSummary.sourceTypeLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>repo</span>
              <strong>{runtimeSummary.repository}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-load-to-duckdb-target-schema">Target schema</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-load-to-duckdb-target-schema"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyLoadToDuckDbConfigUpdate(currentConfig, {
                  target_schema: nextValue
                })
              )
            }
            options={targetSchemaOptions}
            value={config.target_schema}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-load-to-duckdb-table-mapping">Table mapping</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-load-to-duckdb-table-mapping"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyLoadToDuckDbConfigUpdate(currentConfig, {
                  table_mapping: nextValue
                })
              )
            }
            options={[
              {
                label: 'Bundle-aware staging names',
                value: 'bundle_aware_staging_names'
              }
            ]}
            value={config.table_mapping}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-load-to-duckdb-schema-handling">Schema handling</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-load-to-duckdb-schema-handling"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyLoadToDuckDbConfigUpdate(currentConfig, {
                  schema_handling: nextValue
                })
              )
            }
            options={[
              {
                label: 'Infer first, validate later',
                value: 'infer_on_first_load_validate_on_recurring'
              }
            ]}
            value={config.schema_handling}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-load-to-duckdb-delta-context">Delta context preservation</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-load-to-duckdb-delta-context"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyLoadToDuckDbConfigUpdate(currentConfig, {
                  delta_context_preservation: nextValue
                })
              )
            }
            options={[
              {
                label: 'Preserve commit range and delete flags',
                value: 'preserve_commit_range_and_delete_flags'
              }
            ]}
            value={config.delta_context_preservation}
          />
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'load_to_duckdb'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyLoadToDuckDbConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Output contract</p>

        <div className="canvas-node-panel__footer-row">
          <span>Target</span>
          <strong>{runtimeSummary.targetSchema}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Loaded tables</span>
          <strong>{runtimeSummary.loadedTablesLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Output</span>
          <strong>table_ref + load manifest metadata</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasSqlTransformManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeSqlTransformPanelConfig(node);
  const runtimeSummary = buildSqlTransformRuntimeSummary(config, workflow, node?.node_id);
  const outputCount = definition?.outputs?.length ?? 1;
  const targetSchemaOptions = buildSqlTransformSchemaOptions(config.target_schema);

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            SQL
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'SQL Transform'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'sql_transform'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`1 input · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current transform state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current transform state">
            <div className="canvas-node-panel__code-line">
              <span>engine</span>
              <strong>workflow DuckDB</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>mode</span>
              <strong>{runtimeSummary.materializationModeLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>source_table</span>
              <strong>{runtimeSummary.sourceTableLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>target</span>
              <strong>{runtimeSummary.targetLocationLabel}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-sql-transform-label">Label</label>
          </div>
          <input
            id="canvas-sql-transform-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Input table</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Input table">
            <div className="canvas-node-panel__code-line">
              <span>resolved source</span>
              <strong>{runtimeSummary.sourceTableLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>source type</span>
              <strong>{runtimeSummary.sourceTypeLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>override</span>
              <strong>
                {config.source_table_name?.trim()
                  ? config.source_table_name.trim()
                  : 'auto-resolve single upstream table'}
              </strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-sql-transform-source-table">Source table override</label>
          </div>
          <input
            id="canvas-sql-transform-source-table"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applySqlTransformConfigUpdate(currentConfig, {
                  source_table_name: event.target.value
                })
              )
            }
            placeholder="Leave blank to auto-resolve"
            type="text"
            value={config.source_table_name}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-sql-transform-target-schema">Target schema</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-sql-transform-target-schema"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applySqlTransformConfigUpdate(currentConfig, {
                  target_schema: nextValue
                })
              )
            }
            options={targetSchemaOptions}
            value={config.target_schema}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-sql-transform-output-table">Output table name</label>
          </div>
          <input
            id="canvas-sql-transform-output-table"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applySqlTransformConfigUpdate(currentConfig, {
                  output_table_name: event.target.value
                })
              )
            }
            placeholder="rates__us_treasury__snapshot_normalized"
            type="text"
            value={config.output_table_name}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-sql-transform-materialization-mode">Materialization mode</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-sql-transform-materialization-mode"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applySqlTransformConfigUpdate(currentConfig, {
                  materialization_mode: nextValue
                })
              )
            }
            options={[{ label: 'View', value: 'view' }]}
            value={config.materialization_mode}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-sql-transform-sql-text">SQL</label>
          </div>
          <textarea
            id="canvas-sql-transform-sql-text"
            className="canvas-node-panel__textarea canvas-node-panel__textarea--code"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applySqlTransformConfigUpdate(currentConfig, {
                  sql_text: event.target.value
                })
              )
            }
            spellCheck={false}
            value={config.sql_text}
          />
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'sql_transform'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applySqlTransformConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Transform contract</p>

        <div className="canvas-node-panel__footer-row">
          <span>Mode</span>
          <strong>{runtimeSummary.materializationModeLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Target</span>
          <strong>{runtimeSummary.targetLocationLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Authoring</span>
          <strong>{runtimeSummary.sqlModeLabel}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasTableMergeManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeTableMergePanelConfig(node);
  const runtimeSummary = buildTableMergeRuntimeSummary(config, workflow, node?.node_id);
  const outputCount = definition?.outputs?.length ?? 1;
  const targetSchemaOptions = buildTableMergeSchemaOptions(config.target_schema);

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            G
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Table Merge'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'table_merge'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{`1 input · ${outputCount} output${outputCount === 1 ? '' : 's'}`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Current merge state</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Current merge state">
            <div className="canvas-node-panel__code-line">
              <span>source_tables</span>
              <strong>{runtimeSummary.sourceTablesLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>write_policy</span>
              <strong>{runtimeSummary.writePolicyLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>delete_handling</span>
              <strong>{runtimeSummary.deleteHandlingLabel}</strong>
            </div>
            <div className="canvas-node-panel__code-line">
              <span>target_schema</span>
              <strong>{runtimeSummary.targetSchema}</strong>
            </div>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-merge-label">Label</label>
          </div>
          <input
            id="canvas-table-merge-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-merge-target-schema">Target schema</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-merge-target-schema"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableMergeConfigUpdate(currentConfig, {
                  target_schema: nextValue
                })
              )
            }
            options={targetSchemaOptions}
            value={config.target_schema}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-merge-write-policy">Write policy</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-merge-write-policy"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableMergeConfigUpdate(currentConfig, {
                  write_policy: nextValue
                })
              )
            }
            options={[
              { label: 'Upsert', value: 'upsert' },
              { label: 'Append only', value: 'append_only' },
              { label: 'Snapshot replace', value: 'snapshot_replace' }
            ]}
            value={config.write_policy}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-merge-key-columns">Merge key</label>
          </div>
          <input
            id="canvas-table-merge-key-columns"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableMergeConfigUpdate(currentConfig, {
                  merge_key_columns_text: event.target.value
                })
              )
            }
            placeholder="symbol, report_date"
            type="text"
            value={config.merge_key_columns_text}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-merge-delete-handling">Delete handling</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-merge-delete-handling"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableMergeConfigUpdate(currentConfig, {
                  delete_handling: nextValue
                })
              )
            }
            options={[
              { label: 'Apply delete markers', value: 'apply_delete_markers' },
              { label: 'Ignore delete markers', value: 'ignore_delete_markers' }
            ]}
            value={config.delete_handling}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-merge-schema-drift">Schema drift behavior</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-merge-schema-drift"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableMergeConfigUpdate(currentConfig, {
                  schema_drift_behavior: nextValue
                })
              )
            }
            options={[
              { label: 'Fail and require review', value: 'fail_and_require_review' },
              { label: 'Allow additive changes', value: 'allow_additive_changes' }
            ]}
            value={config.schema_drift_behavior}
          />
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'table_merge'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyTableMergeConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Durable merge</p>

        <div className="canvas-node-panel__footer-row">
          <span>Policy</span>
          <strong>{runtimeSummary.writePolicyLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Merge key</span>
          <strong>{runtimeSummary.mergeKeyLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Schema drift</span>
          <strong>{runtimeSummary.schemaDriftLabel}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasTableInputManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflowSyncState = 'local'
}) {
  const config = normalizeTableInputPanelConfig(node);
  const schemaOptions = buildTableInputSchemaOptions(config.schema_name);
  const tableOptions = buildTableInputTableOptions(config.schema_name, config.table_name);
  const selectedColumnsLabel =
    config.selected_columns.length === 0
      ? 'All columns'
      : config.selected_columns.length === 1
        ? config.selected_columns[0]
        : `${config.selected_columns.length} columns`;
  const sourceLabel = `${resolveTableInputDisplayValue(config.schema_name, DEFAULT_TABLE_INPUT_SCHEMA, '[select schema]')}.${resolveTableInputDisplayValue(config.table_name, DEFAULT_TABLE_INPUT_TABLE_NAME, '[select table]')}`;
  const rowLimitValue = config.row_limit === null ? 'none' : String(config.row_limit);

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            []
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Table Input'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'table_input'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{definition?.outputs?.length === 1 ? '1 output' : `${definition?.outputs?.length ?? 0} outputs`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-label">Label</label>
          </div>
          <input
            id="canvas-table-input-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-catalog">Catalog</label>
            <span className="canvas-node-panel__hint" aria-hidden="true">
              i
            </span>
          </div>
          <input
            id="canvas-table-input-catalog"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableInputConfigUpdate(currentConfig, {
                  catalog: event.target.value
                })
              )
            }
            type="text"
            value={config.catalog}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-schema">Schema</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-input-schema"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableInputConfigUpdate(currentConfig, {
                  schema_name: nextValue
                })
              )
            }
            options={schemaOptions}
            value={config.schema_name}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-table">Source table</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-input-table"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableInputConfigUpdate(currentConfig, {
                  table_name: nextValue
                })
              )
            }
            options={tableOptions}
            value={config.table_name}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-alias">Output alias</label>
          </div>
          <input
            id="canvas-table-input-alias"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableInputConfigUpdate(currentConfig, {
                  output_alias: event.target.value
                })
              )
            }
            type="text"
            value={config.output_alias}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-columns">Selected columns</label>
          </div>
          <input
            id="canvas-table-input-columns"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableInputConfigUpdate(currentConfig, {
                  selected_columns: event.target.value
                })
              )
            }
            placeholder="All columns"
            type="text"
            value={config.selected_columns_text}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-filter">Row filter</label>
          </div>
          <input
            id="canvas-table-input-filter"
            className="canvas-node-panel__input"
            onChange={(event) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableInputConfigUpdate(currentConfig, {
                  row_filter: event.target.value
                })
              )
            }
            type="text"
            value={config.row_filter}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-row-limit">Row limit</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-input-row-limit"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableInputConfigUpdate(currentConfig, {
                  row_limit: nextValue
                })
              )
            }
            options={[
              { label: 'No limit', value: 'none' },
              { label: '100 rows', value: '100' },
              { label: '1000 rows', value: '1000' }
            ]}
            value={rowLimitValue}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label>Generated query</label>
          </div>
          <div className="canvas-node-panel__code" aria-label="Generated query">
            {buildTableInputQueryPreview(config).map((line) => (
              <div className="canvas-node-panel__code-line" key={line.label}>
                <span>{line.text}</span>
                <strong>{line.label}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.refresh_schema}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableInputConfigUpdate(currentConfig, {
                    refresh_schema: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Refresh schema before execution</span>
          </label>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.open_in_catalog}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableInputConfigUpdate(currentConfig, {
                    open_in_catalog: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Open source in catalog on inspect</span>
          </label>
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'table_input'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyTableInputConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Current source</p>

        <div className="canvas-node-panel__footer-row">
          <span>Selected columns</span>
          <strong>{selectedColumnsLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Source</span>
          <strong>{sourceLabel}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasTableSchemaManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflowSyncState = 'local'
}) {
  const config = normalizeTableSchemaPanelConfig(node);
  const [draft, setDraft] = useState(() => formatTableSchemaAuthoringConfig(config));
  const [draftFeedback, setDraftFeedback] = useState(null);
  const destinationLabel =
    config.tables.length === 1 ? config.table_name : `${config.tables.length} tables declared`;
  const primaryKeySummary =
    config.tables.length === 1
      ? config.primary_key.length > 0
        ? config.primary_key.join(', ')
        : 'None'
      : `${config.tables.filter((table) => table.primary_key.length > 0).length} keyed`;
  const resultShapeGroups = buildTableSchemaResultShapeGroups(config);
  const totalColumnCount = config.tables.reduce(
    (count, table) => count + table.columns.length,
    0
  );

  useEffect(() => {
    setDraft(formatTableSchemaAuthoringConfig(config));
  }, [node]);

  useEffect(() => {
    setDraftFeedback(null);
  }, [node?.node_id]);

  function handleDraftChange(nextDraft) {
    setDraft(nextDraft);
    setDraftFeedback(buildTableSchemaDraftFeedback(nextDraft, node?.config ?? {}));
  }

  function handleFormat() {
    try {
      const parsedConfig = parseTableSchemaAuthoringConfigText(draft, node?.config ?? {});
      setDraft(formatTableSchemaAuthoringConfig(parsedConfig));
      setDraftFeedback({
        tone: 'success',
        message: `Formatted schema JSON for ${buildTableSchemaFeedbackTarget(parsedConfig)}.`
      });
    } catch (error) {
      setDraftFeedback({
        tone: 'error',
        message: error.message
      });
    }
  }

  function handleApply() {
    try {
      const parsedConfig = parseTableSchemaAuthoringConfigText(draft, node?.config ?? {});
      onNodeConfigChange?.(parsedConfig);
      setDraft(formatTableSchemaAuthoringConfig(parsedConfig));
      setDraftFeedback({
        tone: 'success',
        message: `Applied schema JSON to ${buildTableSchemaFeedbackTarget(parsedConfig)}.`
      });
    } catch (error) {
      setDraftFeedback({
        tone: 'error',
        message: error.message
      });
    }
  }

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            []
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Table Schema'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'table_schema'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{definition?.outputs?.length === 1 ? '1 output' : `${definition?.outputs?.length ?? 0} outputs`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-schema-label">Label</label>
          </div>
          <input
            id="canvas-table-schema-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-schema-json">Schema JSON</label>
            <span className="canvas-node-panel__hint" aria-hidden="true">
              i
            </span>
          </div>
          <textarea
            id="canvas-table-schema-json"
            className="canvas-node-panel__textarea canvas-node-panel__textarea--code"
            onChange={(event) => handleDraftChange(event.target.value)}
            rows={14}
            value={draft}
          />
        </div>

        {draftFeedback ? (
          <section
            aria-live="polite"
            className={`card-callout${draftFeedback.tone === 'error' ? ' card-callout--error' : ''}`}
          >
            <p>{draftFeedback.message}</p>
          </section>
        ) : null}

        <div className="drawer-action-grid canvas-node-panel__button-grid">
          <button
            className="canvas-node-panel__button canvas-node-panel__button--secondary"
            onClick={handleFormat}
            type="button"
          >
            Format JSON
          </button>
          <button
            className="canvas-node-panel__button canvas-node-panel__button--primary"
            onClick={handleApply}
            type="button"
          >
            Apply Schema
          </button>
        </div>

        <CanvasTableShapeSection
          ariaLabel="Result table shape"
          groups={resultShapeGroups}
          label="Result table shape"
        />
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'table_schema'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyTableSchemaConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Declared tables</p>

        <div className="canvas-node-panel__footer-row">
          <span>Tables</span>
          <strong>{destinationLabel}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Columns</span>
          <strong>{String(totalColumnCount)}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>{config.tables.length === 1 ? 'Primary key' : 'Keys'}</span>
          <strong>{primaryKeySummary}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasTableOutputManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflow,
  workflowSyncState = 'local'
}) {
  const config = normalizeTableOutputPanelConfig(node);
  const schemaOptions = buildTableOutputSchemaOptions(config.target_schema);
  const resultShape = buildTableOutputResultShape(config, workflow, node?.node_id);
  const resultShapeGroups =
    config.input_shape === 'table_schema'
      ? buildTableOutputResultShapeGroups(config, workflow, node?.node_id)
      : [];
  const destination = `${resolveTableOutputDisplayValue(config.target_schema, 'outputs', '[select schema]')}.${resolveTableOutputDisplayValue(config.table_name, 'news_brief', '[select table]')}`;
  const destinationLabel =
    config.input_shape === 'table_schema'
      ? buildTableOutputSchemaBootstrapDestinationLabel(
          config,
          workflow,
          node?.node_id
        )
      : destination;
  const schemaBootstrapSummary =
    resultShapeGroups.length > 0
      ? `${resultShapeGroups.length} table${resultShapeGroups.length === 1 ? '' : 's'}`
      : 'Awaiting schema';

  return (
    <aside className="canvas-node-panel" aria-label="Node management panel">
      <header className="canvas-node-panel__header">
        <div className="canvas-node-panel__title-group">
          <span className="canvas-node-panel__title-icon" aria-hidden="true">
            []
          </span>
          <div className="canvas-node-panel__title-copy">
            <strong>{node?.label ?? definition?.display_name ?? 'Table Output'}</strong>
            <code className="canvas-node-panel__title-subtitle">
              {node?.node_id ?? 'table_output'}
            </code>
          </div>
        </div>

        <div className="canvas-node-panel__header-meta">
          <span className="canvas-node-panel__meta-dot" aria-hidden="true" />
          <span>{definition?.inputs?.length === 1 ? '1 input' : `${definition?.inputs?.length ?? 0} inputs`}</span>
        </div>
      </header>

      <section className="canvas-node-panel__section">
        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-output-label">Label</label>
          </div>
          <input
            id="canvas-table-output-label"
            className="canvas-node-panel__input"
            onChange={(event) => onNodeLabelChange?.(event.target.value)}
            type="text"
            value={node?.label ?? ''}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-output-schema">Target schema</label>
            <span className="canvas-node-panel__hint" aria-hidden="true">
              i
            </span>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-output-schema"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableOutputConfigUpdate(currentConfig, {
                  target_schema: nextValue
                })
              )
            }
            options={schemaOptions}
            value={config.target_schema}
          />
        </div>

        {config.input_shape === 'table_schema' ? null : (
          <div className="canvas-node-panel__field">
            <div className="canvas-node-panel__field-head">
              <label htmlFor="canvas-table-output-table">Target table</label>
            </div>
            <input
              id="canvas-table-output-table"
              className="canvas-node-panel__input"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableOutputConfigUpdate(currentConfig, {
                    table_name: event.target.value
                  })
                )
              }
              type="text"
              value={config.table_name}
            />
          </div>
        )}

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-output-mode">Write mode</label>
            <span className="canvas-node-panel__hint" aria-hidden="true">
              i
            </span>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-output-mode"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableOutputConfigUpdate(currentConfig, {
                  write_mode: nextValue
                })
              )
            }
            options={[
              { label: 'Append rows', value: 'append' },
              { label: 'Replace table', value: 'replace' }
            ]}
            value={config.write_mode}
          />
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-output-shape">Input shape</label>
          </div>
          <CanvasNodePanelSelect
            id="canvas-table-output-shape"
            onChange={(nextValue) =>
              onNodeConfigChange?.((currentConfig) =>
                applyTableOutputConfigUpdate(currentConfig, {
                  input_shape: nextValue
                })
              )
            }
            options={[
              { label: 'Single text row', value: 'single_text_row' },
              { label: 'Source table', value: 'source_table' },
              { label: 'Schema bootstrap', value: 'table_schema' }
            ]}
            value={config.input_shape}
          />
        </div>

        {config.input_shape === 'single_text_row' ? (
          <div className="canvas-node-panel__field">
            <div className="canvas-node-panel__field-head">
              <label htmlFor="canvas-table-output-column">Value column</label>
            </div>
            <input
              id="canvas-table-output-column"
              className="canvas-node-panel__input"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableOutputConfigUpdate(currentConfig, {
                    value_column: event.target.value
                  })
                )
              }
              type="text"
              value={config.value_column}
            />
          </div>
        ) : null}

        {config.input_shape === 'table_schema' ? (
          <CanvasTableShapeSection
            ariaLabel="Result table shape"
            groups={resultShapeGroups}
            label="Result table shape"
          />
        ) : (
          <div className="canvas-node-panel__field">
            <div className="canvas-node-panel__field-head">
              <label>Result table shape</label>
            </div>
            <div className="canvas-node-panel__code" aria-label="Result table shape">
              {resultShape.map((column) => (
                <div className="canvas-node-panel__code-line" key={column.name}>
                  <span>{column.name}</span>
                  <strong>{column.type}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.include_run_id}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableOutputConfigUpdate(currentConfig, {
                    include_run_id: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Include run id</span>
          </label>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.include_written_at}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableOutputConfigUpdate(currentConfig, {
                    include_written_at: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Include written timestamp</span>
          </label>
        </div>

        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={config.open_in_catalog}
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableOutputConfigUpdate(currentConfig, {
                    open_in_catalog: event.target.checked
                  })
                )
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Open table in catalog after write</span>
          </label>
        </div>
      </section>

      <CanvasNodeExecutionTimingSection
        nodeId={node?.node_id ?? 'table_output'}
        onTimingChange={(patch) =>
          onNodeConfigChange?.((currentConfig) =>
            applyTableOutputConfigUpdate(
              currentConfig,
              buildExecutionTimingConfigPatch(currentConfig, patch)
            )
          )
        }
        timing={config.execution}
      />

      <footer className="canvas-node-panel__footer">
        <p className="canvas-node-panel__footer-eyebrow">Current mapping</p>

        <div className="canvas-node-panel__footer-row">
          <span>Rows per run</span>
          <strong>
            {config.input_shape === 'table_schema'
              ? schemaBootstrapSummary
              : config.input_shape === 'source_table'
                ? 'Table copy'
                : '1 row'}
          </strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Destination</span>
          <strong>{destinationLabel}</strong>
        </div>

        <button className="canvas-node-panel__action" type="button">
          <span aria-hidden="true">→</span>
          <span>{workflowSyncStateLabel(workflowSyncState)}</span>
        </button>
      </footer>
    </aside>
  );
}

function CanvasNodeExecutionTimingSection({
  nodeId = 'node',
  onTimingChange,
  timing
}) {
  const waitBeforeEnabled = timing.wait_before_seconds > 0;
  const waitAfterEnabled = timing.wait_after_seconds > 0;

  return (
    <section className="canvas-node-panel__section canvas-node-panel__section--timing">
      <p className="canvas-node-panel__section-eyebrow">Execution timing</p>

      <div className="canvas-node-panel__timing-block">
        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={waitBeforeEnabled}
              onChange={(event) =>
                onTimingChange?.({
                  wait_before_seconds: event.target.checked
                    ? Math.max(1, Math.round(timing.wait_before_seconds || 1))
                    : 0
                })
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Wait before execution</span>
          </label>
        </div>

        {waitBeforeEnabled ? (
          <div className="canvas-node-panel__timing-input-row">
            <label htmlFor={`${nodeId}-wait-before-seconds`}>Seconds</label>
            <input
              id={`${nodeId}-wait-before-seconds`}
              className="canvas-node-panel__input canvas-node-panel__input--timing"
              min="0"
              onChange={(event) =>
                onTimingChange?.({
                  wait_before_seconds: parseExecutionWaitSeconds(event.target.value)
                })
              }
              step="1"
              type="number"
              value={timing.wait_before_seconds}
            />
          </div>
        ) : null}
      </div>

      <div className="canvas-node-panel__timing-block">
        <div className="canvas-node-panel__toggle-row">
          <label className="canvas-node-panel__checkbox">
            <input
              checked={waitAfterEnabled}
              onChange={(event) =>
                onTimingChange?.({
                  wait_after_seconds: event.target.checked
                    ? Math.max(1, Math.round(timing.wait_after_seconds || 1))
                    : 0
                })
              }
              type="checkbox"
            />
            <span className="canvas-node-panel__checkmark" aria-hidden="true" />
            <span>Wait after execution</span>
          </label>
        </div>

        {waitAfterEnabled ? (
          <div className="canvas-node-panel__timing-input-row">
            <label htmlFor={`${nodeId}-wait-after-seconds`}>Seconds</label>
            <input
              id={`${nodeId}-wait-after-seconds`}
              className="canvas-node-panel__input canvas-node-panel__input--timing"
              min="0"
              onChange={(event) =>
                onTimingChange?.({
                  wait_after_seconds: parseExecutionWaitSeconds(event.target.value)
                })
              }
              step="1"
              type="number"
              value={timing.wait_after_seconds}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CanvasWorkflowTitleBox({
  isEditing = false,
  onCancel,
  onChange,
  onCommit,
  onStartEditing,
  title = 'untitled',
  titleDraft = 'untitled',
  titleInputRef
}) {
  return (
    <div className="canvas-workflow-title">
      {isEditing ? (
        <form
          className="canvas-workflow-title__form"
          onSubmit={(event) => {
            event.preventDefault();
            onCommit?.();
          }}
        >
          <input
            aria-label="Workflow title"
            className="canvas-workflow-title__input"
            onBlur={() => onCommit?.()}
            onChange={(event) => onChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel?.();
              }
            }}
            ref={titleInputRef}
            spellCheck={false}
            type="text"
            value={titleDraft}
          />
        </form>
      ) : (
        <button
          aria-label={`Rename workflow ${title}`}
          className="canvas-workflow-title__button"
          onClick={() => onStartEditing?.()}
          type="button"
        >
          <span className="canvas-workflow-title__label">{title}</span>
        </button>
      )}
    </div>
  );
}

function CanvasWorkflowRunStrip({ onOpenRun, run = null }) {
  const status = run?.status ?? 'idle';
  const nodeRuns = run?.node_runs ?? [];
  const completedNodeCount = nodeRuns.filter((nodeRun) =>
    ['succeeded', 'failed', 'cancelled', 'skipped'].includes(
      normalizeRunStatusToken(nodeRun.status)
    )
  ).length;
  const summary =
    nodeRuns.length > 0
      ? `${completedNodeCount}/${nodeRuns.length} nodes`
      : run?.started_at
        ? formatCanvasRunTimestamp(run.started_at)
        : 'No activity yet';
  const title =
    run?.error?.message ??
    (run?.run_id ? `Latest run ${run.run_id}` : 'No runs have been recorded yet.');

  return (
    <button
      aria-label="Workflow run status"
      className={`canvas-workflow-run-strip${
        run ? ` is-${normalizeRunStatusToken(status)}` : ' is-idle'
      }`}
      disabled={!run?.run_id}
      onClick={() => {
        if (run?.run_id) {
          onOpenRun?.(run.run_id);
        }
      }}
      title={title}
      type="button"
    >
      <span className="canvas-workflow-run-strip__eyebrow">
        {run?.run_id ? 'Latest run' : 'Run status'}
      </span>
      <span className="canvas-workflow-run-strip__row">
        <span className="canvas-workflow-run-strip__status">
          <span className="canvas-workflow-run-strip__dot" aria-hidden="true" />
          <strong>{run?.run_id ? humanizeToken(status) : 'No runs yet'}</strong>
          <span className="canvas-workflow-run-strip__inline-meta">{summary}</span>
        </span>
        {run?.run_id ? (
          <span className="canvas-workflow-run-strip__run-id">
            {shortCanvasRunId(run.run_id)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function CanvasRunControlToggle({ isActive = false, onClick }) {
  return (
    <button
      aria-label="Open run control"
      className={`canvas-run-control-toggle${isActive ? ' is-active' : ''}`}
      onClick={() => onClick?.()}
      type="button"
    >
      <span className="canvas-run-control-toggle__eyebrow">Execution</span>
      <span className="canvas-run-control-toggle__label">Run Control</span>
    </button>
  );
}

function CanvasRunControlPanel({
  activeRun,
  backendStatus,
  busyState,
  deferredEvents,
  onCancelRun,
  onClose,
  onOpenLatestRun,
  onRun,
  onValidate,
  runHistoryCount,
  runSnapshot,
  validation,
  validationProblems = [],
  workflowSyncState
}) {
  const canCancelRun = isCancellableRun(activeRun);
  const isCancelling = normalizeRunStatusToken(activeRun?.status) === 'cancelling';
  const primaryValidationProblem = validationProblems[0] ?? null;
  const additionalValidationProblemCount = Math.max(0, validationProblems.length - 1);

  return (
    <aside className="canvas-run-control-panel" aria-label="Run control panel">
      <div className="canvas-run-control-panel__header">
        <div className="canvas-run-control-panel__header-copy">
          <strong>Run Control</strong>
          <span>Validate and execute this workflow</span>
        </div>
        <button
          aria-label="Collapse run control"
          className="canvas-run-control-panel__collapse"
          onClick={onClose}
          type="button"
        >
          Collapse
        </button>
      </div>

      <div className="card-stack">
        <CardMetricGrid
          metrics={[
            { label: 'Backend', value: humanizeToken(backendStatus) },
            { label: 'Workflow', value: humanizeToken(workflowSyncState) },
            { label: 'Validation', value: validation ? (validation.valid ? 'Valid' : 'Issues') : 'Idle' },
            { label: 'Runs', value: String(runHistoryCount) }
          ]}
        />

        <div className="drawer-action-grid">
          <button
            className="accent-button"
            onClick={onValidate}
            type="button"
            disabled={
              busyState.validate ||
              busyState.cancel ||
              workflowSyncState === 'loading' ||
              isCancelling
            }
          >
            {busyState.validate ? 'Validating…' : 'Validate Workflow'}
          </button>
          <button
            className="secondary-button"
            onClick={onRun}
            type="button"
            disabled={
              busyState.run ||
              busyState.cancel ||
              workflowSyncState === 'loading' ||
              canCancelRun
            }
          >
            {busyState.run ? 'Starting…' : 'Run Workflow'}
          </button>
        </div>

        {validation?.valid ? (
          <section className="card-callout">
            <p>Validation passed. This workflow is ready to run.</p>
          </section>
        ) : primaryValidationProblem ? (
          <SectionBlock title="Validation Issue">
            <section className="card-callout card-callout--error">
              <p>
                <strong>{humanizeToken(primaryValidationProblem.code)}</strong>
                {' · '}
                {primaryValidationProblem.message}
              </p>
              {additionalValidationProblemCount > 0 ? (
                <p>
                  {additionalValidationProblemCount} more validation issue
                  {additionalValidationProblemCount === 1 ? '' : 's'} remain.
                </p>
              ) : null}
            </section>
          </SectionBlock>
        ) : null}

        {activeRun?.run_id ? (
          <div className="drawer-action-grid drawer-action-grid--tertiary">
            <button
              className="secondary-button secondary-button--danger"
              disabled={!canCancelRun || busyState.cancel}
              onClick={onCancelRun}
              type="button"
            >
              {busyState.cancel || isCancelling ? 'Cancelling…' : 'Force Stop'}
            </button>
          </div>
        ) : null}

        <SectionBlock title="Latest Activity">
          {deferredEvents.length ? (
            <div className="drawer-list">
              {deferredEvents.slice(-4).reverse().map((event) => (
                <DrawerItemButton
                  key={event.event_id}
                  icon=">"
                  subtitle={event.target.node_id ?? 'run'}
                  title={humanizeToken(event.event_type)}
                  onClick={onOpenLatestRun}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              message={
                runSnapshot?.run_id
                  ? 'No live events yet for the selected run.'
                  : 'No live events yet. Start a run to stream lifecycle activity here.'
              }
            />
          )}
        </SectionBlock>
      </div>
    </aside>
  );
}

function DrawerHeader({ description, onClose, title }) {
  return (
    <header className="shell-drawer__header">
      <div className="shell-drawer__brand">
        <div className="shell-drawer__mark">S</div>
        <div>
          <strong>Stitchly</strong>
          <span>{title}</span>
        </div>
      </div>

      <button className="shell-circle-button" onClick={onClose} type="button">
        <span>&lt;</span>
      </button>

      <p className="shell-drawer__description">{description}</p>
    </header>
  );
}

function CardHeader({ eyebrow, title, onClose }) {
  return (
    <header className="floating-card__header">
      <div>
        <p className="floating-card__eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <button className="shell-circle-button" onClick={onClose} type="button">
        <span>x</span>
      </button>
    </header>
  );
}

function RailButton({ active, badge, icon, label, onClick }) {
  return (
    <button
      aria-label={label}
      className={`shell-rail__button${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className="shell-rail__icon">{icon}</span>
      {badge ? <span className="shell-rail__badge">{badge}</span> : null}
    </button>
  );
}

function SectionBlock({ children, title }) {
  return (
    <section className="drawer-section">
      <div className="drawer-section__heading">
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function DrawerItemButton({ active = false, badge, icon, onClick, subtitle, title }) {
  return (
    <button
      className={`drawer-item${active ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="drawer-item__icon">{icon}</span>
      <span className="drawer-item__content">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </span>
      {badge ? <span className="drawer-item__badge">{badge}</span> : null}
    </button>
  );
}

function CardMetricGrid({ metrics }) {
  return (
    <div className="card-metric-grid">
      {metrics.map((metric) => (
        <div key={metric.label} className="card-metric">
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

function KeyValueRow({ label, value }) {
  return (
    <div className="drawer-kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ message }) {
  return <p className="drawer-empty">{message}</p>;
}

function CanvasDebugPanel({
  collapsed = false,
  debugState,
  onToggleCollapsed
}) {
  return (
    <div className="canvas-debug-cluster" aria-live="polite">
      <button
        aria-expanded={!collapsed}
        aria-label="Open canvas debug"
        className={`canvas-debug-toggle${collapsed ? '' : ' is-active'}`}
        onClick={onToggleCollapsed}
        type="button"
      >
        <span className="canvas-debug-toggle__eyebrow">Canvas</span>
        <span className="canvas-debug-toggle__label">Debug</span>
      </button>

      {collapsed ? null : (
        <aside className="canvas-debug-panel">
          <div className="canvas-debug-panel__header">
            <div className="canvas-debug-panel__header-copy">
              <strong>Canvas Debug</strong>
              <span>Inspect live pointer and selection state</span>
            </div>
            <button
              aria-label="Collapse canvas debug"
              className="canvas-debug-panel__collapse"
              onClick={onToggleCollapsed}
              type="button"
            >
              Collapse
            </button>
          </div>

          <div className="canvas-debug-panel__grid">
            <DebugValue label="Pointer" value={debugState.pointer ? `${debugState.pointer.x}, ${debugState.pointer.y}` : 'Idle'} />
            <DebugValue label="Active Node" value={humanizeToken(debugState.activeNodeId ?? 'none')} />
            <DebugValue label="Active Edge" value={humanizeToken(debugState.activeEdgeId ?? 'none')} />
            <DebugValue label="Connect Drag" value={debugState.connectionInProgress ? 'yes' : 'no'} />
            <DebugValue
              label="Connect Valid"
              value={formatConnectionValidity(debugState.connectionIsValid)}
            />
            <DebugValue
              label="Connect Reason"
              value={humanizeToken(debugState.connectionReason ?? 'none')}
            />
            <DebugValue
              label="Connect Types"
              value={debugState.connectionTypes ?? 'unknown'}
            />
            <DebugValue
              label="Connect From"
              value={formatConnectionEndpoint(
                debugState.connectionFromNodeId,
                debugState.connectionFromHandleId
              )}
            />
            <DebugValue
              label="Connect To"
              value={formatConnectionEndpoint(
                debugState.connectionToNodeId,
                debugState.connectionToHandleId
              )}
            />
            <DebugValue
              label="Viewport"
              value={
                debugState.viewport
                  ? `${debugState.viewport.width}×${debugState.viewport.height} ${debugState.viewport.breakpoint}`
                  : 'Unknown'
              }
            />
            <DebugValue label="Node :hover" value={debugState.nodeHoverMatch ? 'yes' : 'no'} />
            <DebugValue label="Node :focus" value={debugState.nodeFocusMatch ? 'yes' : 'no'} />
            <DebugValue label="Node Selected" value={debugState.nodeSelectedState ? 'yes' : 'no'} />
            <DebugValue label="Edge Selected" value={debugState.edgeSelectedState ? 'yes' : 'no'} />
            <DebugValue label="Inside Node" value={debugState.pointerInsideNode ? 'yes' : 'no'} />
          </div>

          {/* <section className="canvas-debug-panel__section">
            <p className="canvas-debug-panel__label">Node Rect</p>
            <div className="canvas-debug-panel__stack">
              <DebugRectDescriptor label="Node Rect" rect={debugState.nodeRect} />
            </div>
          </section>

          <section className="canvas-debug-panel__section">
            <p className="canvas-debug-panel__label">Top Element</p>
            {debugState.topElement ? (
              <DebugElementDescriptor element={debugState.topElement} />
            ) : (
              <p className="canvas-debug-panel__empty">Move over the canvas to inspect the live stack.</p>
            )}
          </section>

          <section className="canvas-debug-panel__section">
            <p className="canvas-debug-panel__label">Element Stack</p>
            {debugState.stack.length ? (
              <div className="canvas-debug-panel__stack">
                {debugState.stack.map((element, index) => (
                  <DebugElementDescriptor
                    key={`${element?.tag ?? 'unknown'}-${element?.className ?? 'empty'}-${index}`}
                    element={element}
                    index={index}
                  />
                ))}
              </div>
            ) : (
              <p className="canvas-debug-panel__empty">No canvas elements under the pointer yet.</p>
            )}
          </section>

          <section className="canvas-debug-panel__section">
            <p className="canvas-debug-panel__label">Possible Blocker</p>
            {debugState.blockerElement ? (
              <DebugElementDescriptor element={debugState.blockerElement} />
            ) : (
              <p className="canvas-debug-panel__empty">No top-level blocker detected outside the active node.</p>
            )}
          </section> */}
        </aside>
      )}
    </div>
  );
}

function DebugValue({ label, value }) {
  return (
    <div className="canvas-debug-panel__kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DebugElementDescriptor({ element, index = null }) {
  if (!element) {
    return null;
  }

  return (
    <div className="canvas-debug-panel__item">
      <div className="canvas-debug-panel__item-head">
        <strong>
          {index != null ? `${index}. ` : ''}
          {element.tag}
        </strong>
        <span>{element.pointerEvents}</span>
      </div>
      <code>{element.className || '(no classes)'}</code>
      <span className="canvas-debug-panel__meta">z-index {element.zIndex}</span>
    </div>
  );
}

function DebugRectDescriptor({ label, meta = null, rect }) {
  return (
    <div className="canvas-debug-panel__item">
      <div className="canvas-debug-panel__item-head">
        <strong>{label}</strong>
        <span>{meta?.pointerEvents ?? 'n/a'}</span>
      </div>
      {rect ? (
        <code>{`x:${rect.left} y:${rect.top} w:${rect.width} h:${rect.height} r:${rect.right} b:${rect.bottom}`}</code>
      ) : (
        <p className="canvas-debug-panel__empty">No rect available.</p>
      )}
      {meta ? <span className="canvas-debug-panel__meta">{meta.className || '(no classes)'}</span> : null}
    </div>
  );
}

function formatConnectionEndpoint(nodeId, handleId) {
  if (!nodeId) {
    return 'none'
  }

  if (!handleId) {
    return humanizeToken(nodeId)
  }

  return `${humanizeToken(nodeId)}.${humanizeToken(handleId)}`
}

function formatCanvasZoom(zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return '100%';
  }

  return `${Math.round(zoom * 100)}%`;
}

function shouldIgnoreCanvasShortcut(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

function formatConnectionValidity(value) {
  if (value == null) {
    return 'unknown'
  }

  return value ? 'yes' : 'no'
}

function toneFromStatus(status) {
  if (status === 'connected' || status === 'succeeded' || status === 'valid') {
    return 'good';
  }

  if (status === 'offline' || status === 'failed' || status === 'invalid' || status === 'stream-error') {
    return 'alert';
  }

  return 'neutral';
}

function cardEyebrowFor(type) {
  if (type === 'run-control') {
    return 'Run Control';
  }

  if (type === 'run-detail') {
    return 'Run Detail';
  }

  if (type === 'problem-detail') {
    return 'Problem Detail';
  }

  return 'Context';
}

function cardTitleFor({ floatingCard, activeProblem, activeRun }) {
  if (floatingCard.type === 'run-control') {
    return 'Validate + Execute';
  }

  if (floatingCard.type === 'run-detail') {
    return activeRun?.run_id ?? 'Latest Run';
  }

  if (floatingCard.type === 'problem-detail') {
    return humanizeToken(activeProblem?.code);
  }

  return 'Context';
}

function workflowSignature(workflow) {
  return JSON.stringify(workflow);
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

function resolveLatestWorkflowRunSnapshot({
  activeWorkflowId,
  currentRun = null,
  runs = []
}) {
  const matchingRuns = sortRunsByMostRecent(
    runs.filter((run) => run.workflow_id === activeWorkflowId)
  );
  const latestRun = matchingRuns[0] ?? null;

  if (!latestRun) {
    return null;
  }

  if (!currentRun || currentRun.workflow_id !== activeWorkflowId) {
    return latestRun;
  }

  if (currentRun.run_id === latestRun.run_id) {
    return preferRunSnapshot(currentRun, latestRun);
  }

  if (isRunInProgress(currentRun.status)) {
    return currentRun;
  }

  return latestRun;
}

function preferRunSnapshot(currentRun, candidateRun) {
  if (!currentRun) {
    return candidateRun ?? null;
  }

  if (!candidateRun) {
    return currentRun;
  }

  const currentInProgress = isRunInProgress(currentRun.status);
  const candidateInProgress = isRunInProgress(candidateRun.status);

  if (currentInProgress && !candidateInProgress) {
    return candidateRun;
  }

  if (!currentInProgress && candidateInProgress) {
    return currentRun;
  }

  if (countCompletedCanvasNodes(candidateRun) > countCompletedCanvasNodes(currentRun)) {
    return candidateRun;
  }

  const currentFinishedAt = Date.parse(currentRun.finished_at ?? '') || 0;
  const candidateFinishedAt = Date.parse(candidateRun.finished_at ?? '') || 0;
  if (candidateFinishedAt > currentFinishedAt) {
    return candidateRun;
  }

  const currentStartedAt = Date.parse(currentRun.started_at ?? '') || 0;
  const candidateStartedAt = Date.parse(candidateRun.started_at ?? '') || 0;
  if (candidateStartedAt > currentStartedAt) {
    return candidateRun;
  }

  if ((candidateRun.logs?.length ?? 0) > (currentRun.logs?.length ?? 0)) {
    return candidateRun;
  }

  return currentRun;
}

function isRunInProgress(status) {
  return ['created', 'queued', 'planning', 'running', 'cancelling'].includes(
    normalizeRunStatusToken(status)
  );
}

function isCancellableRun(run) {
  return Boolean(run?.run_id) && isRunInProgress(run.status);
}

function isTerminalRunEventType(eventType) {
  return ['run_succeeded', 'run_failed', 'run_cancelled'].includes(
    String(eventType ?? '').toLowerCase()
  );
}

function normalizeRunStatusToken(status) {
  return typeof status === 'string' ? status.toLowerCase() : String(status ?? '').toLowerCase();
}

function shortCanvasRunId(runId = '') {
  if (!runId) {
    return '—';
  }

  return runId.length > 12 ? runId.slice(0, 12) : runId;
}

function formatCanvasRunTimestamp(timestamp) {
  if (!timestamp) {
    return 'No activity yet';
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return 'No activity yet';
  }

  return value.toLocaleString(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short'
  });
}

function formatCanvasRunDuration(run) {
  const durationMs = canvasRunDurationMs(run);
  return durationMs ? formatCanvasDurationMs(durationMs) : '—';
}

function canvasRunDurationMs(run) {
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

function formatCanvasDurationMs(durationMs) {
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

function countCanvasRunRetries(run) {
  if (Number.isFinite(run?.retry_count)) {
    return Math.max(0, run.retry_count);
  }

  return (run?.node_runs ?? []).reduce(
    (sum, nodeRun) => sum + Math.max(0, (nodeRun.attempt ?? 1) - 1),
    0
  );
}

function countCanvasRunErrors(run) {
  if (Number.isFinite(run?.error_count)) {
    return Math.max(0, run.error_count);
  }

  const nodeFailures = (run?.node_runs ?? []).filter((nodeRun) => nodeRun.error).length;
  return run?.error ? Math.max(nodeFailures, 1) : nodeFailures;
}

function countCompletedCanvasNodes(run) {
  return (run?.node_runs ?? []).filter((nodeRun) =>
    ['succeeded', 'failed', 'skipped', 'cancelled'].includes(
      normalizeRunStatusToken(nodeRun.status)
    )
  ).length;
}

function summarizeNodeRunDetail(nodeRun) {
  const statusDetail = `${humanizeToken(nodeRun.type_id)} · ${
    nodeRun.attempt === 1 ? '1 attempt' : `${nodeRun.attempt} attempts`
  } · ${nodeRun.log_count ?? 0} logs`;

  if (nodeRun.error?.message) {
    return `${statusDetail} · ${nodeRun.error.message}`;
  }

  return statusDetail;
}

function summarizeCanvasEventTitle(event) {
  if (event.event_type === 'run_failed' && event.payload?.message) {
    return event.payload.message;
  }

  if (event.event_type === 'node_log' && event.payload?.message) {
    return event.payload.message;
  }

  return humanizeToken(event.event_type);
}

function summarizeCanvasEventDetail(event) {
  const targetLabel = event.target?.node_id ?? 'workflow';
  const timeLabel = formatCanvasRunTimestamp(event.timestamp);
  const payloadLabel = summarizeCanvasEventPayload(event);
  return [targetLabel, timeLabel, payloadLabel].filter(Boolean).join(' · ');
}

function summarizeCanvasEventPayload(event) {
  const payload = event.payload ?? {};

  if (payload.status) {
    return humanizeToken(payload.status);
  }

  if (payload.type_id) {
    return humanizeToken(payload.type_id);
  }

  if (Number.isFinite(payload.planned_nodes)) {
    return `${payload.planned_nodes} planned`;
  }

  if (Number.isFinite(payload.completed_nodes)) {
    return `${payload.completed_nodes} completed`;
  }

  if (Number.isFinite(payload.attempt)) {
    return payload.attempt === 1 ? '1 attempt' : `${payload.attempt} attempts`;
  }

  if (payload.category) {
    return humanizeToken(payload.category);
  }

  return '';
}

function summarizeCanvasLogDetail(entry) {
  return [
    humanizeToken(entry.level),
    entry.node_id ?? 'workflow',
    formatCanvasRunTimestamp(entry.timestamp)
  ]
    .filter(Boolean)
    .join(' · ');
}

function formatCanvasLogLevelBadge(level) {
  const normalizedLevel = String(level ?? '').toLowerCase();
  if (normalizedLevel === 'error') {
    return '!';
  }
  if (normalizedLevel === 'warn') {
    return 'W';
  }
  if (normalizedLevel === 'debug') {
    return 'D';
  }
  return 'L';
}

function buildCanvasNodeManagementModel(node, definition) {
  const nodeTypeId = node?.type_id ?? definition?.type_id ?? null;
  const inputCount = definition?.inputs?.length ?? 0;
  const outputCount = definition?.outputs?.length ?? 0;
  const portCount = inputCount + outputCount;
  const base = {
    title: node?.label ?? definition?.display_name ?? humanizeToken(node?.type_id ?? 'node'),
    subtitle: node?.node_id ?? definition?.type_id ?? humanizeToken(node?.type_id ?? 'node'),
    meta: portCount ? `${portCount} port${portCount === 1 ? '' : 's'}` : 'Selected',
    icon:
      nodeTypeId === 'checkpoint_read'
        ? 'R'
        : nodeTypeId === 'checkpoint_write'
          ? 'W'
        : nodeTypeId === 'quality_check'
          ? 'Q'
        : nodeTypeId === 'dolt_repo_source' || nodeTypeId === 'dolt_repo_sync' || nodeTypeId === 'dolt_change_manifest' || nodeTypeId === 'dolt_dump' || nodeTypeId === 'dolt_diff_export'
        ? 'd'
        : nodeTypeId === 'load_to_duckdb'
          ? 'O'
        : nodeTypeId === 'sql_transform'
          ? 'SQL'
        : nodeTypeId === 'send_email'
        ? '@'
        : nodeTypeId === 'table_input' || nodeTypeId === 'table_output' || nodeTypeId === 'table_schema'
          ? '[]'
          : nodeTypeId === 'table_merge'
            ? 'G'
          : 'T',
    footerEyebrow: 'Run selected node',
    footerMetricLabel: 'Estimated load',
    footerMetricValue: '24 units',
    actionLabel: 'Apply changes'
  };

  if (nodeTypeId === 'send_email') {
    const subjectLength = String(node?.config?.subject ?? '').length || 32;

    return {
      ...base,
      fields: [
        { kind: 'slider', label: 'Delay Before Send', percent: 62, value: '15s' },
        { kind: 'slider', label: 'Retry Attempts', percent: 42, value: '2' },
        { kind: 'slider', label: 'Timeout', percent: 78, value: '30s' },
        { kind: 'select', label: 'Delivery Mode', value: 'Immediate' },
        {
          kind: 'slider',
          label: 'Preview Length',
          percent: Math.max(24, Math.min(84, Math.round(subjectLength * 1.2))),
          value: String(subjectLength)
        },
        { kind: 'slider', label: 'Priority', percent: 31, value: '3' }
      ],
      toggles: [
        { checked: true, label: 'Track opens' },
        { checked: true, label: 'Pin node' }
      ]
    };
  }

  const textLength = String(node?.config?.text ?? '').length || 120;

  return {
    ...base,
    fields: [
      {
        kind: 'slider',
        label: 'Text Length',
        percent: Math.max(20, Math.min(86, Math.round(textLength / 3))),
        value: String(textLength)
      },
      { kind: 'slider', label: 'Preview Lines', percent: 38, value: '3' },
      { kind: 'select', label: 'Trim Mode', value: 'Automatic' },
      { kind: 'slider', label: 'Token Budget', percent: 68, value: '120' },
      { kind: 'select', label: 'Output Format', value: 'Plain text' },
      { kind: 'slider', label: 'Priority', percent: 20, value: '1' }
    ],
    toggles: [
      { checked: true, label: 'Preserve whitespace' },
      { checked: true, label: 'Include line breaks' }
    ],
    footerMetricLabel: 'Preview bytes',
    footerMetricValue: `${Math.max(32, textLength)} b`,
    actionLabel: 'Preview output'
  };
}

const DEFAULT_TABLE_OUTPUT_SCHEMA = 'outputs';
const DEFAULT_TABLE_OUTPUT_TABLE_NAME = 'news_brief';
const DEFAULT_TABLE_OUTPUT_VALUE_COLUMN = 'content';
const DEFAULT_TABLE_OUTPUT_INPUT_SHAPE = 'single_text_row';
const DEFAULT_TABLE_OUTPUT_WRITE_MODE = 'append';
const DEFAULT_DOLT_REPO_SOURCE_CONNECTION_REF = 'dolthub_public';
const DEFAULT_DOLT_REPO_SOURCE_REPOSITORY = 'post-no-preference/earnings';
const DEFAULT_DOLT_REPO_SOURCE_BRANCH = 'main';
const DEFAULT_DOLT_REPO_SOURCE_CLONE_MODE = 'reuse_local_copy';
const DEFAULT_DOLT_REPO_SOURCE_SYNC_STRATEGY = 'pull_before_execution';
const DEFAULT_CHECKPOINT_READ_TABLE = 'tables.ingest_checkpoints';
const DEFAULT_CHECKPOINT_READ_SOURCE_REPO = DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
const DEFAULT_CHECKPOINT_READ_BRANCH = DEFAULT_DOLT_REPO_SOURCE_BRANCH;
const DEFAULT_CHECKPOINT_READ_EMIT_BOOTSTRAP_MARKER_IF_MISSING = true;
const DEFAULT_CHECKPOINT_READ_FAIL_ON_STALE_CHECKPOINT = false;
const DEFAULT_CHECKPOINT_WRITE_TABLE = 'tables.ingest_checkpoints';
const DEFAULT_CHECKPOINT_WRITE_COMMIT_SOURCE = 'metadata.current_commit';
const DEFAULT_CHECKPOINT_WRITE_TIMING = 'after_merge_success';
const DEFAULT_CHECKPOINT_WRITE_ONLY_PERSIST_ON_FULL_SUCCESS = true;
const DEFAULT_CHECKPOINT_WRITE_ADVANCE_ON_PARTIAL_SUCCESS = false;
const DEFAULT_QUALITY_CHECK_SUITE_PRESET = 'post_merge_ingest_gate';
const DEFAULT_QUALITY_CHECK_SCHEMA_DRIFT_RULE = 'fail_on_required_column_drift';
const DEFAULT_QUALITY_CHECK_NULL_KEY_POLICY = 'block_on_primary_key_nulls';
const DEFAULT_QUALITY_CHECK_WARNING_BUDGET = 2;
const DEFAULT_QUALITY_CHECK_BLOCK_CHECKPOINT_WRITE_ON_FAILURE = true;
const DEFAULT_QUALITY_CHECK_ALLOW_WARNING_ONLY_RUNS_TO_CONTINUE = true;
const DEFAULT_DOLT_REPO_SYNC_ACTION = 'pull_remote_head';
const DEFAULT_DOLT_REPO_SYNC_NO_CHANGE_BEHAVIOR = 'emit_current_range';
const DEFAULT_DOLT_REPO_SYNC_BRANCH_GUARD = 'require_tracked_branch_match';
const DEFAULT_DOLT_REPO_SYNC_DIRTY_WORKING_COPY_POLICY = 'fail_if_dirty';
const DEFAULT_DOLT_CHANGE_MANIFEST_TABLE_SCOPE = 'all_tables';
const DEFAULT_DOLT_CHANGE_MANIFEST_SCHEMA_CHANGE_POLICY = 'flag_and_continue';
const DEFAULT_DOLT_DUMP_OUTPUT_FORMAT = 'parquet';
const DEFAULT_DOLT_DUMP_TABLE_SELECTION_MODE = 'prefer_manifest_scope';
const DEFAULT_DOLT_DUMP_ARTIFACT_RETENTION = 'keep_latest_success';
const DEFAULT_DOLT_DUMP_OUTPUT_DIRECTORY_POLICY = 'ephemeral_run_bundle';
const DEFAULT_DOLT_DIFF_EXPORT_OUTPUT_FORMAT = 'parquet';
const DEFAULT_DOLT_DIFF_EXPORT_CHANGE_FILTER = 'all_changes';
const DEFAULT_DOLT_DIFF_EXPORT_DELETED_ROW_HANDLING = 'emit_delete_markers';
const DEFAULT_LOAD_TO_DUCKDB_TARGET_SCHEMA = 'staging';
const DEFAULT_LOAD_TO_DUCKDB_TABLE_MAPPING = 'bundle_aware_staging_names';
const DEFAULT_LOAD_TO_DUCKDB_SCHEMA_HANDLING =
  'infer_on_first_load_validate_on_recurring';
const DEFAULT_LOAD_TO_DUCKDB_DELTA_CONTEXT_PRESERVATION =
  'preserve_commit_range_and_delete_flags';
const DEFAULT_SQL_TRANSFORM_TARGET_SCHEMA = 'staging_curated';
const DEFAULT_SQL_TRANSFORM_OUTPUT_TABLE_NAME = 'normalized_view';
const DEFAULT_SQL_TRANSFORM_MATERIALIZATION_MODE = 'view';
const DEFAULT_SQL_TRANSFORM_SQL_TEXT = 'select *\nfrom {{source}}';
const DEFAULT_TABLE_MERGE_TARGET_SCHEMA = 'tables';
const DEFAULT_TABLE_MERGE_WRITE_POLICY = 'upsert';
const DEFAULT_TABLE_MERGE_DELETE_HANDLING = 'apply_delete_markers';
const DEFAULT_TABLE_MERGE_SCHEMA_DRIFT_BEHAVIOR = 'fail_and_require_review';
const DEFAULT_TABLE_MERGE_KEY_COLUMNS = ['symbol', 'report_date'];
const DEFAULT_RATES_TABLE_MERGE_KEY_COLUMNS = ['curve_date', 'tenor'];
const DEFAULT_TABLE_INPUT_CATALOG = 'workflow.duckdb';
const DEFAULT_TABLE_INPUT_SCHEMA = 'runs';
const DEFAULT_TABLE_INPUT_TABLE_NAME = 'workflow_runs';
const DEFAULT_TABLE_INPUT_OUTPUT_ALIAS = 'workflow_runs';
const DEFAULT_TABLE_SCHEMA_CATALOG = 'workflow.duckdb';
const DEFAULT_TABLE_SCHEMA_SCHEMA = 'tables';
const DEFAULT_TABLE_SCHEMA_TABLE_NAME = 'orders_fact';
const DEFAULT_TABLE_SCHEMA_OUTPUT_ALIAS = 'orders_fact_definition';
const DEFAULT_TABLE_SCHEMA_CREATE_MODE = 'create_if_missing';
const DEFAULT_TABLE_SCHEMA_IF_TARGET_EXISTS = 'keep_existing';
const DEFAULT_TABLE_SCHEMA_COLUMNS = [
  {
    name: 'order_id',
    nullable: false,
    primary_key: true,
    type: 'bigint'
  }
];
const TABLE_OUTPUT_SCHEMA_CHOICES = [
  { label: 'outputs', value: 'outputs' },
  { label: 'tables', value: 'tables' },
  { label: 'staging', value: 'staging' },
  { label: 'runs', value: 'runs' }
];
const TABLE_INPUT_SCHEMA_CHOICES = [
  { label: 'runs', value: 'runs' },
  { label: 'staging', value: 'staging' },
  { label: 'tables', value: 'tables' },
  { label: 'outputs', value: 'outputs' }
];
const LOAD_TO_DUCKDB_SCHEMA_CHOICES = [
  { label: 'staging', value: 'staging' },
  { label: 'tables', value: 'tables' },
  { label: 'outputs', value: 'outputs' },
  { label: 'runs', value: 'runs' }
];
const SQL_TRANSFORM_SCHEMA_CHOICES = [
  { label: 'staging_curated', value: 'staging_curated' },
  { label: 'intermediate', value: 'intermediate' },
  { label: 'staging', value: 'staging' },
  { label: 'outputs', value: 'outputs' },
  { label: 'runs', value: 'runs' }
];
const TABLE_MERGE_SCHEMA_CHOICES = [
  { label: 'tables', value: 'tables' },
  { label: 'outputs', value: 'outputs' }
];
const DOLT_REPO_SOURCE_CONNECTION_CHOICES = [
  { label: 'dolthub_public', value: 'dolthub_public' }
];
const DOLT_REPO_SOURCE_BRANCH_CHOICES = [
  { label: 'main', value: 'main' },
  { label: 'master', value: 'master' }
];

function normalizeSendEmailPanelConfig(node, workflow) {
  const config = node?.config ?? {};
  const hasIncomingBody = hasInputConnection(workflow, node?.node_id, 'body');
  const inferredBodyMode =
    config.body_mode === 'custom' || config.body_mode === 'input'
      ? config.body_mode
      : hasIncomingBody
        ? 'input'
        : typeof config.body === 'string' && config.body.trim()
          ? 'custom'
          : 'input';

  return {
    body: typeof config.body === 'string' ? config.body : '',
    body_mode: inferredBodyMode,
    body_text:
      typeof config.body_text === 'string'
        ? config.body_text
        : typeof config.body === 'string'
          ? config.body
          : '',
    execution: normalizeNodeExecutionTimingConfig(config),
    connection_id:
      typeof config.connection_id === 'string' && config.connection_id.trim()
        ? config.connection_id
        : 'default_mailer',
    content_type:
      config.content_type === 'text/html' ? 'text/html' : 'text/plain',
    subject: typeof config.subject === 'string' ? config.subject : '',
    to: typeof config.to === 'string' ? config.to : ''
  };
}

function normalizeTextInputPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    execution: normalizeNodeExecutionTimingConfig(config),
    include_line_breaks:
      typeof config.include_line_breaks === 'boolean'
        ? config.include_line_breaks
        : true,
    preserve_whitespace:
      typeof config.preserve_whitespace === 'boolean'
        ? config.preserve_whitespace
        : true,
    text: typeof config.text === 'string' ? config.text : '',
    trim_mode:
      config.trim_mode === 'trim' || config.trim_mode === 'exact'
        ? config.trim_mode
      : 'automatic'
  };
}

function normalizeDoltRepoSourcePanelConfig(node) {
  const config = node?.config ?? {};

  return {
    branch: normalizeNodeConfigTextField(
      config,
      'branch',
      DEFAULT_DOLT_REPO_SOURCE_BRANCH
    ),
    checkout_ref:
      typeof config.checkout_ref === 'string' ? config.checkout_ref : '',
    clone_mode:
      config.clone_mode === 'fresh_clone' || config.clone_mode === 'depth_1'
        ? config.clone_mode
        : DEFAULT_DOLT_REPO_SOURCE_CLONE_MODE,
    connection_ref: normalizeNodeConfigTextField(
      config,
      'connection_ref',
      DEFAULT_DOLT_REPO_SOURCE_CONNECTION_REF
    ),
    execution: normalizeNodeExecutionTimingConfig(config),
    repository: normalizeNodeConfigTextField(
      config,
      'repository',
      DEFAULT_DOLT_REPO_SOURCE_REPOSITORY
    ),
    sync_strategy:
      config.sync_strategy === 'clone_only' || config.sync_strategy === 'manual'
        ? config.sync_strategy
        : DEFAULT_DOLT_REPO_SOURCE_SYNC_STRATEGY
  };
}

function normalizeDoltRepoSyncPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    branch_guard:
      config.branch_guard === 'allow_detached_head'
        ? config.branch_guard
        : DEFAULT_DOLT_REPO_SYNC_BRANCH_GUARD,
    dirty_working_copy_policy:
      config.dirty_working_copy_policy === 'stash_and_continue'
        ? config.dirty_working_copy_policy
        : DEFAULT_DOLT_REPO_SYNC_DIRTY_WORKING_COPY_POLICY,
    execution: normalizeNodeExecutionTimingConfig(config),
    no_change_behavior:
      config.no_change_behavior === 'emit_no_op_marker'
        ? config.no_change_behavior
        : DEFAULT_DOLT_REPO_SYNC_NO_CHANGE_BEHAVIOR,
    sync_action:
      config.sync_action === 'fetch_and_checkout' ||
      config.sync_action === 'refresh_checkout'
        ? config.sync_action
        : DEFAULT_DOLT_REPO_SYNC_ACTION
  };
}

function normalizeDoltChangeManifestPanelConfig(node) {
  const config = node?.config ?? {};
  const selectedTables = normalizeDoltChangeManifestSelectedTables(config.selected_tables);

  return {
    execution: normalizeNodeExecutionTimingConfig(config),
    schema_change_policy:
      config.schema_change_policy === 'fail_run'
        ? config.schema_change_policy
        : DEFAULT_DOLT_CHANGE_MANIFEST_SCHEMA_CHANGE_POLICY,
    selected_tables: selectedTables,
    selected_tables_text: selectedTables.join(', '),
    table_scope:
      config.table_scope === 'allowlist'
        ? config.table_scope
        : DEFAULT_DOLT_CHANGE_MANIFEST_TABLE_SCOPE
  };
}

function normalizeDoltDumpPanelConfig(node) {
  const config = node?.config ?? {};
  const selectedTables = normalizeDoltDumpSelectedTables(config.selected_tables);

  return {
    artifact_retention:
      config.artifact_retention === 'ephemeral_per_run' ||
      config.artifact_retention === 'persist_all'
        ? config.artifact_retention
        : DEFAULT_DOLT_DUMP_ARTIFACT_RETENTION,
    execution: normalizeNodeExecutionTimingConfig(config),
    output_directory_policy:
      config.output_directory_policy === 'stable_repo_cache'
        ? config.output_directory_policy
        : DEFAULT_DOLT_DUMP_OUTPUT_DIRECTORY_POLICY,
    output_format:
      config.output_format === 'csv' ? 'csv' : DEFAULT_DOLT_DUMP_OUTPUT_FORMAT,
    selected_tables: selectedTables,
    selected_tables_text: selectedTables.join(', '),
    table_selection_mode:
      config.table_selection_mode === 'all_tables' ||
      config.table_selection_mode === 'manual_tables'
        ? config.table_selection_mode
        : DEFAULT_DOLT_DUMP_TABLE_SELECTION_MODE
  };
}

function normalizeDoltDiffExportPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    change_filter:
      config.change_filter === 'non_delete_changes' ||
      config.change_filter === 'added_only' ||
      config.change_filter === 'modified_only' ||
      config.change_filter === 'removed_only'
        ? config.change_filter
        : DEFAULT_DOLT_DIFF_EXPORT_CHANGE_FILTER,
    deleted_row_handling:
      config.deleted_row_handling === 'omit_delete_rows'
        ? config.deleted_row_handling
        : DEFAULT_DOLT_DIFF_EXPORT_DELETED_ROW_HANDLING,
    execution: normalizeNodeExecutionTimingConfig(config),
    output_format:
      config.output_format === 'csv' ? 'csv' : DEFAULT_DOLT_DIFF_EXPORT_OUTPUT_FORMAT
  };
}

function normalizeLoadToDuckDbPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    delta_context_preservation:
      config.delta_context_preservation === 'preserve_commit_range_and_delete_flags'
        ? config.delta_context_preservation
        : DEFAULT_LOAD_TO_DUCKDB_DELTA_CONTEXT_PRESERVATION,
    execution: normalizeNodeExecutionTimingConfig(config),
    schema_handling:
      config.schema_handling === 'infer_on_first_load_validate_on_recurring'
        ? config.schema_handling
        : DEFAULT_LOAD_TO_DUCKDB_SCHEMA_HANDLING,
    table_mapping:
      config.table_mapping === 'bundle_aware_staging_names'
        ? config.table_mapping
        : DEFAULT_LOAD_TO_DUCKDB_TABLE_MAPPING,
    target_schema: normalizeNodeConfigTextField(
      config,
      'target_schema',
      DEFAULT_LOAD_TO_DUCKDB_TARGET_SCHEMA
    )
  };
}

function normalizeSqlTransformPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    execution: normalizeNodeExecutionTimingConfig(config),
    materialization_mode:
      config.materialization_mode === 'view'
        ? config.materialization_mode
        : DEFAULT_SQL_TRANSFORM_MATERIALIZATION_MODE,
    output_table_name: normalizeNodeConfigTextField(
      config,
      'output_table_name',
      DEFAULT_SQL_TRANSFORM_OUTPUT_TABLE_NAME
    ),
    source_table_name:
      typeof config.source_table_name === 'string' ? config.source_table_name : '',
    sql_text:
      typeof config.sql_text === 'string' && config.sql_text.trim()
        ? config.sql_text
        : DEFAULT_SQL_TRANSFORM_SQL_TEXT,
    target_schema: normalizeNodeConfigTextField(
      config,
      'target_schema',
      DEFAULT_SQL_TRANSFORM_TARGET_SCHEMA
    )
  };
}

function normalizeCheckpointReadPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    branch: normalizeNodeConfigTextField(
      config,
      'branch',
      DEFAULT_CHECKPOINT_READ_BRANCH
    ),
    checkpoint_table: normalizeNodeConfigTextField(
      config,
      'checkpoint_table',
      DEFAULT_CHECKPOINT_READ_TABLE
    ),
    emit_bootstrap_marker_if_missing:
      typeof config.emit_bootstrap_marker_if_missing === 'boolean'
        ? config.emit_bootstrap_marker_if_missing
        : DEFAULT_CHECKPOINT_READ_EMIT_BOOTSTRAP_MARKER_IF_MISSING,
    execution: normalizeNodeExecutionTimingConfig(config),
    fail_on_stale_checkpoint:
      typeof config.fail_on_stale_checkpoint === 'boolean'
        ? config.fail_on_stale_checkpoint
        : DEFAULT_CHECKPOINT_READ_FAIL_ON_STALE_CHECKPOINT,
    source_repo: normalizeNodeConfigTextField(
      config,
      'source_repo',
      DEFAULT_CHECKPOINT_READ_SOURCE_REPO
    )
  };
}

function normalizeCheckpointWritePanelConfig(node) {
  const config = node?.config ?? {};

  return {
    advance_on_partial_success:
      typeof config.advance_on_partial_success === 'boolean'
        ? config.advance_on_partial_success
        : DEFAULT_CHECKPOINT_WRITE_ADVANCE_ON_PARTIAL_SUCCESS,
    checkpoint_table: normalizeNodeConfigTextField(
      config,
      'checkpoint_table',
      DEFAULT_CHECKPOINT_WRITE_TABLE
    ),
    commit_source:
      config.commit_source === 'metadata.current_commit'
        ? config.commit_source
        : DEFAULT_CHECKPOINT_WRITE_COMMIT_SOURCE,
    execution: normalizeNodeExecutionTimingConfig(config),
    only_persist_on_full_success:
      typeof config.only_persist_on_full_success === 'boolean'
        ? config.only_persist_on_full_success
        : DEFAULT_CHECKPOINT_WRITE_ONLY_PERSIST_ON_FULL_SUCCESS,
    write_timing:
      config.write_timing === 'after_quality_gate'
        ? config.write_timing
        : DEFAULT_CHECKPOINT_WRITE_TIMING
  };
}

function normalizeQualityCheckWarningBudget(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }

  return DEFAULT_QUALITY_CHECK_WARNING_BUDGET;
}

function normalizeQualityCheckPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    allow_warning_only_runs_to_continue:
      typeof config.allow_warning_only_runs_to_continue === 'boolean'
        ? config.allow_warning_only_runs_to_continue
        : DEFAULT_QUALITY_CHECK_ALLOW_WARNING_ONLY_RUNS_TO_CONTINUE,
    block_checkpoint_write_on_failure:
      typeof config.block_checkpoint_write_on_failure === 'boolean'
        ? config.block_checkpoint_write_on_failure
        : DEFAULT_QUALITY_CHECK_BLOCK_CHECKPOINT_WRITE_ON_FAILURE,
    execution: normalizeNodeExecutionTimingConfig(config),
    null_key_policy:
      config.null_key_policy === 'allow_nulls_with_warning'
        ? config.null_key_policy
        : DEFAULT_QUALITY_CHECK_NULL_KEY_POLICY,
    schema_drift_rule:
      config.schema_drift_rule === 'allow_additive_schema_notes'
        ? config.schema_drift_rule
        : DEFAULT_QUALITY_CHECK_SCHEMA_DRIFT_RULE,
    suite_preset:
      config.suite_preset === 'custom_rule_bundle'
        ? config.suite_preset
        : DEFAULT_QUALITY_CHECK_SUITE_PRESET,
    warning_budget: normalizeQualityCheckWarningBudget(config.warning_budget)
  };
}

function normalizeTableMergeKeyColumns(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean))];
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
  }

  return [...DEFAULT_TABLE_MERGE_KEY_COLUMNS];
}

function normalizeTableMergePanelConfig(node) {
  const config = node?.config ?? {};
  const mergeKeyColumns = normalizeTableMergeKeyColumns(config.merge_key_columns);

  return {
    delete_handling:
      config.delete_handling === 'ignore_delete_markers'
        ? config.delete_handling
        : DEFAULT_TABLE_MERGE_DELETE_HANDLING,
    execution: normalizeNodeExecutionTimingConfig(config),
    merge_key_columns: mergeKeyColumns,
    merge_key_columns_text: mergeKeyColumns.join(', '),
    schema_drift_behavior:
      config.schema_drift_behavior === 'allow_additive_changes'
        ? config.schema_drift_behavior
        : DEFAULT_TABLE_MERGE_SCHEMA_DRIFT_BEHAVIOR,
    target_schema: normalizeNodeConfigTextField(
      config,
      'target_schema',
      DEFAULT_TABLE_MERGE_TARGET_SCHEMA
    ),
    write_policy:
      config.write_policy === 'append_only' || config.write_policy === 'snapshot_replace'
        ? config.write_policy
        : DEFAULT_TABLE_MERGE_WRITE_POLICY
  };
}

function normalizeTableInputPanelConfig(node) {
  const config = node?.config ?? {};
  const selectedColumns = normalizeTableInputSelectedColumns(config.selected_columns);

  return {
    catalog: normalizeNodeConfigTextField(config, 'catalog', DEFAULT_TABLE_INPUT_CATALOG),
    execution: normalizeNodeExecutionTimingConfig(config),
    open_in_catalog:
      typeof config.open_in_catalog === 'boolean' ? config.open_in_catalog : false,
    output_alias: normalizeNodeConfigTextField(
      config,
      'output_alias',
      DEFAULT_TABLE_INPUT_OUTPUT_ALIAS
    ),
    refresh_schema:
      typeof config.refresh_schema === 'boolean' ? config.refresh_schema : true,
    row_filter: typeof config.row_filter === 'string' ? config.row_filter : '',
    row_limit:
      typeof config.row_limit === 'number' && Number.isFinite(config.row_limit) && config.row_limit > 0
        ? Math.round(config.row_limit)
        : null,
    schema_name: normalizeNodeConfigTextField(
      config,
      'schema_name',
      DEFAULT_TABLE_INPUT_SCHEMA
    ),
    selected_columns: selectedColumns,
    selected_columns_text: selectedColumns.join(', '),
    table_name: normalizeNodeConfigTextField(
      config,
      'table_name',
      DEFAULT_TABLE_INPUT_TABLE_NAME
    )
  };
}

function normalizeTableSchemaPanelConfig(node) {
  const config = node?.config ?? {};
  const tables = normalizeStoredTableSchemaDefinitions(config);
  const primaryTable = tables[0];

  return {
    catalog: normalizeTableSchemaTextValue(config.catalog, DEFAULT_TABLE_SCHEMA_CATALOG),
    checks: primaryTable.checks,
    columns: primaryTable.columns,
    create_mode: primaryTable.create_mode,
    execution: normalizeNodeExecutionTimingConfig(config),
    if_target_exists: primaryTable.if_target_exists,
    open_in_catalog:
      typeof config.open_in_catalog === 'boolean' ? config.open_in_catalog : false,
    output_alias: primaryTable.output_alias,
    primary_key: primaryTable.primary_key,
    schema_name: primaryTable.schema_name,
    table_name: primaryTable.table_name,
    tables
  };
}

function normalizeStoredTableSchemaDefinitions(config = {}) {
  if (Array.isArray(config.tables) && config.tables.length > 0) {
    return config.tables.map((tableConfig, index) =>
      normalizeStoredTableSchemaDefinition(tableConfig, index)
    );
  }

  return [normalizeStoredTableSchemaDefinition(config, 0)];
}

function normalizeStoredTableSchemaDefinition(config = {}, index = 0) {
  const schemaName = normalizeNodeConfigTextField(
    config,
    'schema_name',
    DEFAULT_TABLE_SCHEMA_SCHEMA
  );
  const tableName = normalizeNodeConfigTextField(
    config,
    'table_name',
    index === 0 ? DEFAULT_TABLE_SCHEMA_TABLE_NAME : `table_${index + 1}`
  );
  const primaryKey = normalizeTableSchemaPrimaryKeyNames(config.primary_key);
  const columns = normalizeStoredTableSchemaColumns(config.columns, primaryKey);

  return {
    checks: normalizeTableSchemaChecks(config.checks),
    columns,
    create_mode: normalizeTableSchemaTextValue(
      config.create_mode,
      DEFAULT_TABLE_SCHEMA_CREATE_MODE
    ),
    if_target_exists: normalizeTableSchemaTextValue(
      config.if_target_exists,
      DEFAULT_TABLE_SCHEMA_IF_TARGET_EXISTS
    ),
    output_alias: normalizeTableSchemaTextValue(
      config.output_alias,
      deriveTableSchemaOutputAlias(tableName)
    ),
    primary_key: columns
      .filter((column) => column.primary_key)
      .map((column) => column.name),
    schema_name: schemaName,
    table_name: tableName
  };
}

function normalizeTableOutputPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    execution: normalizeNodeExecutionTimingConfig(config),
    include_run_id:
      typeof config.include_run_id === 'boolean' ? config.include_run_id : true,
    include_written_at:
      typeof config.include_written_at === 'boolean' ? config.include_written_at : true,
    input_shape:
      config.input_shape === 'single_text_row' ||
      config.input_shape === 'source_table' ||
      config.input_shape === 'table_schema'
        ? config.input_shape
        : DEFAULT_TABLE_OUTPUT_INPUT_SHAPE,
    open_in_catalog:
      typeof config.open_in_catalog === 'boolean' ? config.open_in_catalog : false,
    table_name: normalizeNodeConfigTextField(
      config,
      'table_name',
      DEFAULT_TABLE_OUTPUT_TABLE_NAME
    ),
    target_schema: normalizeNodeConfigTextField(
      config,
      'target_schema',
      DEFAULT_TABLE_OUTPUT_SCHEMA
    ),
    value_column: normalizeNodeConfigTextField(
      config,
      'value_column',
      DEFAULT_TABLE_OUTPUT_VALUE_COLUMN
    ),
    write_mode:
      config.write_mode === 'replace' ? 'replace' : DEFAULT_TABLE_OUTPUT_WRITE_MODE
  };
}

function applySendEmailConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeSendEmailPanelConfig({ config: currentConfig }, null),
    ...currentConfig,
    ...patch
  };

  const normalizedBodyText =
    typeof next.body_text === 'string'
      ? next.body_text
      : typeof next.body === 'string'
        ? next.body
        : '';

  return {
    ...next,
    body: normalizedBodyText,
    body_mode: next.body_mode === 'custom' ? 'custom' : 'input',
    body_text: normalizedBodyText,
    execution: normalizeNodeExecutionTimingConfig(next),
    connection_id:
      typeof next.connection_id === 'string' && next.connection_id.trim()
        ? next.connection_id
        : 'default_mailer',
    content_type: next.content_type === 'text/html' ? 'text/html' : 'text/plain',
    subject: typeof next.subject === 'string' ? next.subject : '',
    to: typeof next.to === 'string' ? next.to : ''
  };
}

function applyTextInputConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeTextInputPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    execution: normalizeNodeExecutionTimingConfig(next),
    include_line_breaks:
      typeof next.include_line_breaks === 'boolean'
        ? next.include_line_breaks
        : true,
    preserve_whitespace:
      typeof next.preserve_whitespace === 'boolean'
        ? next.preserve_whitespace
        : true,
    text: typeof next.text === 'string' ? next.text : '',
    trim_mode:
      next.trim_mode === 'trim' || next.trim_mode === 'exact'
        ? next.trim_mode
      : 'automatic'
  };
}

function applyCheckpointReadConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeCheckpointReadPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    branch: normalizeNodeConfigTextField(next, 'branch', DEFAULT_CHECKPOINT_READ_BRANCH),
    checkpoint_table: normalizeNodeConfigTextField(
      next,
      'checkpoint_table',
      DEFAULT_CHECKPOINT_READ_TABLE
    ),
    emit_bootstrap_marker_if_missing:
      typeof next.emit_bootstrap_marker_if_missing === 'boolean'
        ? next.emit_bootstrap_marker_if_missing
        : DEFAULT_CHECKPOINT_READ_EMIT_BOOTSTRAP_MARKER_IF_MISSING,
    execution: normalizeNodeExecutionTimingConfig(next),
    fail_on_stale_checkpoint:
      typeof next.fail_on_stale_checkpoint === 'boolean'
        ? next.fail_on_stale_checkpoint
        : DEFAULT_CHECKPOINT_READ_FAIL_ON_STALE_CHECKPOINT,
    source_repo: normalizeNodeConfigTextField(
      next,
      'source_repo',
      DEFAULT_CHECKPOINT_READ_SOURCE_REPO
    )
  };
}

function applyCheckpointWriteConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeCheckpointWritePanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    advance_on_partial_success:
      typeof next.advance_on_partial_success === 'boolean'
        ? next.advance_on_partial_success
        : DEFAULT_CHECKPOINT_WRITE_ADVANCE_ON_PARTIAL_SUCCESS,
    checkpoint_table: normalizeNodeConfigTextField(
      next,
      'checkpoint_table',
      DEFAULT_CHECKPOINT_WRITE_TABLE
    ),
    commit_source:
      next.commit_source === 'metadata.current_commit'
        ? next.commit_source
        : DEFAULT_CHECKPOINT_WRITE_COMMIT_SOURCE,
    execution: normalizeNodeExecutionTimingConfig(next),
    only_persist_on_full_success:
      typeof next.only_persist_on_full_success === 'boolean'
        ? next.only_persist_on_full_success
        : DEFAULT_CHECKPOINT_WRITE_ONLY_PERSIST_ON_FULL_SUCCESS,
    write_timing:
      next.write_timing === 'after_quality_gate'
        ? next.write_timing
        : DEFAULT_CHECKPOINT_WRITE_TIMING
  };
}

function applyQualityCheckConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeQualityCheckPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    allow_warning_only_runs_to_continue:
      typeof next.allow_warning_only_runs_to_continue === 'boolean'
        ? next.allow_warning_only_runs_to_continue
        : DEFAULT_QUALITY_CHECK_ALLOW_WARNING_ONLY_RUNS_TO_CONTINUE,
    block_checkpoint_write_on_failure:
      typeof next.block_checkpoint_write_on_failure === 'boolean'
        ? next.block_checkpoint_write_on_failure
        : DEFAULT_QUALITY_CHECK_BLOCK_CHECKPOINT_WRITE_ON_FAILURE,
    execution: normalizeNodeExecutionTimingConfig(next),
    null_key_policy:
      next.null_key_policy === 'allow_nulls_with_warning'
        ? next.null_key_policy
        : DEFAULT_QUALITY_CHECK_NULL_KEY_POLICY,
    schema_drift_rule:
      next.schema_drift_rule === 'allow_additive_schema_notes'
        ? next.schema_drift_rule
        : DEFAULT_QUALITY_CHECK_SCHEMA_DRIFT_RULE,
    suite_preset:
      next.suite_preset === 'custom_rule_bundle'
        ? next.suite_preset
        : DEFAULT_QUALITY_CHECK_SUITE_PRESET,
    warning_budget: normalizeQualityCheckWarningBudget(next.warning_budget)
  };
}

function applyDoltRepoSourceConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeDoltRepoSourcePanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    branch: normalizeNodeConfigTextField(
      next,
      'branch',
      DEFAULT_DOLT_REPO_SOURCE_BRANCH
    ),
    checkout_ref:
      typeof next.checkout_ref === 'string' ? next.checkout_ref : '',
    clone_mode:
      next.clone_mode === 'fresh_clone' || next.clone_mode === 'depth_1'
        ? next.clone_mode
        : DEFAULT_DOLT_REPO_SOURCE_CLONE_MODE,
    connection_ref: normalizeNodeConfigTextField(
      next,
      'connection_ref',
      DEFAULT_DOLT_REPO_SOURCE_CONNECTION_REF
    ),
    execution: normalizeNodeExecutionTimingConfig(next),
    repository: normalizeNodeConfigTextField(
      next,
      'repository',
      DEFAULT_DOLT_REPO_SOURCE_REPOSITORY
    ),
    sync_strategy:
      next.sync_strategy === 'clone_only' || next.sync_strategy === 'manual'
        ? next.sync_strategy
        : DEFAULT_DOLT_REPO_SOURCE_SYNC_STRATEGY
  };
}

function applyDoltRepoSyncConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeDoltRepoSyncPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    branch_guard:
      next.branch_guard === 'allow_detached_head'
        ? next.branch_guard
        : DEFAULT_DOLT_REPO_SYNC_BRANCH_GUARD,
    dirty_working_copy_policy:
      next.dirty_working_copy_policy === 'stash_and_continue'
        ? next.dirty_working_copy_policy
        : DEFAULT_DOLT_REPO_SYNC_DIRTY_WORKING_COPY_POLICY,
    execution: normalizeNodeExecutionTimingConfig(next),
    no_change_behavior:
      next.no_change_behavior === 'emit_no_op_marker'
        ? next.no_change_behavior
        : DEFAULT_DOLT_REPO_SYNC_NO_CHANGE_BEHAVIOR,
    sync_action:
      next.sync_action === 'fetch_and_checkout' ||
      next.sync_action === 'refresh_checkout'
        ? next.sync_action
        : DEFAULT_DOLT_REPO_SYNC_ACTION
  };
}

function applyDoltChangeManifestConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeDoltChangeManifestPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };
  const { selected_tables_text: _selectedTablesText, ...rest } = next;
  const selectedTables = normalizeDoltChangeManifestSelectedTables(
    next.selected_tables_text ?? next.selected_tables
  );

  return {
    ...rest,
    execution: normalizeNodeExecutionTimingConfig(next),
    schema_change_policy:
      next.schema_change_policy === 'fail_run'
        ? next.schema_change_policy
        : DEFAULT_DOLT_CHANGE_MANIFEST_SCHEMA_CHANGE_POLICY,
    selected_tables: selectedTables,
    table_scope:
      next.table_scope === 'allowlist'
        ? next.table_scope
        : DEFAULT_DOLT_CHANGE_MANIFEST_TABLE_SCOPE
  };
}

function applyDoltDumpConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeDoltDumpPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };
  const { selected_tables_text: _selectedTablesText, ...rest } = next;
  const selectedTables = normalizeDoltDumpSelectedTables(
    next.selected_tables_text ?? next.selected_tables
  );

  return {
    ...rest,
    artifact_retention:
      next.artifact_retention === 'ephemeral_per_run' ||
      next.artifact_retention === 'persist_all'
        ? next.artifact_retention
        : DEFAULT_DOLT_DUMP_ARTIFACT_RETENTION,
    execution: normalizeNodeExecutionTimingConfig(next),
    output_directory_policy:
      next.output_directory_policy === 'stable_repo_cache'
        ? next.output_directory_policy
        : DEFAULT_DOLT_DUMP_OUTPUT_DIRECTORY_POLICY,
    output_format:
      next.output_format === 'csv' ? 'csv' : DEFAULT_DOLT_DUMP_OUTPUT_FORMAT,
    selected_tables: selectedTables,
    table_selection_mode:
      next.table_selection_mode === 'all_tables' ||
      next.table_selection_mode === 'manual_tables'
        ? next.table_selection_mode
        : DEFAULT_DOLT_DUMP_TABLE_SELECTION_MODE
  };
}

function applyDoltDiffExportConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeDoltDiffExportPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    change_filter:
      next.change_filter === 'non_delete_changes' ||
      next.change_filter === 'added_only' ||
      next.change_filter === 'modified_only' ||
      next.change_filter === 'removed_only'
        ? next.change_filter
        : DEFAULT_DOLT_DIFF_EXPORT_CHANGE_FILTER,
    deleted_row_handling:
      next.deleted_row_handling === 'omit_delete_rows'
        ? next.deleted_row_handling
        : DEFAULT_DOLT_DIFF_EXPORT_DELETED_ROW_HANDLING,
    execution: normalizeNodeExecutionTimingConfig(next),
    output_format:
      next.output_format === 'csv' ? 'csv' : DEFAULT_DOLT_DIFF_EXPORT_OUTPUT_FORMAT
  };
}

function applyLoadToDuckDbConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeLoadToDuckDbPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    delta_context_preservation:
      next.delta_context_preservation === 'preserve_commit_range_and_delete_flags'
        ? next.delta_context_preservation
        : DEFAULT_LOAD_TO_DUCKDB_DELTA_CONTEXT_PRESERVATION,
    execution: normalizeNodeExecutionTimingConfig(next),
    schema_handling:
      next.schema_handling === 'infer_on_first_load_validate_on_recurring'
        ? next.schema_handling
        : DEFAULT_LOAD_TO_DUCKDB_SCHEMA_HANDLING,
    table_mapping:
      next.table_mapping === 'bundle_aware_staging_names'
        ? next.table_mapping
        : DEFAULT_LOAD_TO_DUCKDB_TABLE_MAPPING,
    target_schema: normalizeNodeConfigTextField(
      next,
      'target_schema',
      DEFAULT_LOAD_TO_DUCKDB_TARGET_SCHEMA
    )
  };
}

function applySqlTransformConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeSqlTransformPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    execution: normalizeNodeExecutionTimingConfig(next),
    materialization_mode:
      next.materialization_mode === 'view'
        ? next.materialization_mode
        : DEFAULT_SQL_TRANSFORM_MATERIALIZATION_MODE,
    output_table_name: normalizeNodeConfigTextField(
      next,
      'output_table_name',
      DEFAULT_SQL_TRANSFORM_OUTPUT_TABLE_NAME
    ),
    source_table_name:
      typeof next.source_table_name === 'string' ? next.source_table_name : '',
    sql_text:
      typeof next.sql_text === 'string' && next.sql_text.trim()
        ? next.sql_text
        : DEFAULT_SQL_TRANSFORM_SQL_TEXT,
    target_schema: normalizeNodeConfigTextField(
      next,
      'target_schema',
      DEFAULT_SQL_TRANSFORM_TARGET_SCHEMA
    )
  };
}

function applyTableMergeConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeTableMergePanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    delete_handling:
      next.delete_handling === 'ignore_delete_markers'
        ? next.delete_handling
        : DEFAULT_TABLE_MERGE_DELETE_HANDLING,
    execution: normalizeNodeExecutionTimingConfig(next),
    merge_key_columns: normalizeTableMergeKeyColumns(
      next.merge_key_columns_text ?? next.merge_key_columns
    ),
    schema_drift_behavior:
      next.schema_drift_behavior === 'allow_additive_changes'
        ? next.schema_drift_behavior
        : DEFAULT_TABLE_MERGE_SCHEMA_DRIFT_BEHAVIOR,
    target_schema: normalizeNodeConfigTextField(
      next,
      'target_schema',
      DEFAULT_TABLE_MERGE_TARGET_SCHEMA
    ),
    write_policy:
      next.write_policy === 'append_only' || next.write_policy === 'snapshot_replace'
        ? next.write_policy
        : DEFAULT_TABLE_MERGE_WRITE_POLICY
  };
}

function applyTableInputConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeTableInputPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };
  const { selected_columns_text: _selectedColumnsText, ...rest } = next;
  const selectedColumns = normalizeTableInputSelectedColumns(
    next.selected_columns_text ?? next.selected_columns
  );
  const parsedRowLimit =
    next.row_limit === 'none' || next.row_limit === '' || next.row_limit == null
      ? null
      : Number(next.row_limit);

  return {
    ...rest,
    catalog: normalizeNodeConfigTextField(next, 'catalog', DEFAULT_TABLE_INPUT_CATALOG),
    execution: normalizeNodeExecutionTimingConfig(next),
    open_in_catalog:
      typeof next.open_in_catalog === 'boolean' ? next.open_in_catalog : false,
    output_alias:
      typeof next.output_alias === 'string' && next.output_alias.trim()
        ? next.output_alias
        : resolveTableInputDisplayValue(next.table_name, DEFAULT_TABLE_INPUT_OUTPUT_ALIAS),
    refresh_schema:
      typeof next.refresh_schema === 'boolean' ? next.refresh_schema : true,
    row_filter: typeof next.row_filter === 'string' ? next.row_filter : '',
    row_limit:
      typeof parsedRowLimit === 'number' && Number.isFinite(parsedRowLimit) && parsedRowLimit > 0
        ? Math.round(parsedRowLimit)
        : null,
    schema_name: normalizeNodeConfigTextField(
      next,
      'schema_name',
      DEFAULT_TABLE_INPUT_SCHEMA
    ),
    selected_columns: selectedColumns,
    table_name: normalizeNodeConfigTextField(
      next,
      'table_name',
      DEFAULT_TABLE_INPUT_TABLE_NAME
    )
  };
}

function applyTableSchemaConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeTableSchemaPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return normalizeTableSchemaPanelConfig({ config: next });
}

function applyTableOutputConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...normalizeTableOutputPanelConfig({ config: currentConfig }),
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    execution: normalizeNodeExecutionTimingConfig(next),
    include_run_id:
      typeof next.include_run_id === 'boolean' ? next.include_run_id : true,
    include_written_at:
      typeof next.include_written_at === 'boolean' ? next.include_written_at : true,
    input_shape:
      next.input_shape === 'single_text_row' ||
      next.input_shape === 'source_table' ||
      next.input_shape === 'table_schema'
        ? next.input_shape
        : DEFAULT_TABLE_OUTPUT_INPUT_SHAPE,
    open_in_catalog:
      typeof next.open_in_catalog === 'boolean' ? next.open_in_catalog : false,
    table_name: normalizeNodeConfigTextField(
      next,
      'table_name',
      DEFAULT_TABLE_OUTPUT_TABLE_NAME
    ),
    target_schema: normalizeNodeConfigTextField(
      next,
      'target_schema',
      DEFAULT_TABLE_OUTPUT_SCHEMA
    ),
    value_column: normalizeNodeConfigTextField(
      next,
      'value_column',
      DEFAULT_TABLE_OUTPUT_VALUE_COLUMN
    ),
    write_mode:
      next.write_mode === 'replace' ? 'replace' : DEFAULT_TABLE_OUTPUT_WRITE_MODE
  };
}

function applyGenericNodeConfigUpdate(currentConfig = {}, patch = {}) {
  const next = {
    ...currentConfig,
    ...patch
  };

  return {
    ...next,
    execution: normalizeNodeExecutionTimingConfig(next)
  };
}

function normalizeNodeExecutionTimingConfig(config = {}) {
  return normalizeNodeExecutionTimingValue(config.execution);
}

function normalizeNodeExecutionTimingValue(execution = {}) {
  return {
    wait_after_seconds: normalizeExecutionWaitSeconds(execution.wait_after_seconds),
    wait_before_seconds: normalizeExecutionWaitSeconds(execution.wait_before_seconds)
  };
}

function buildExecutionTimingConfigPatch(currentConfig = {}, patch = {}) {
  return {
    execution: normalizeNodeExecutionTimingValue({
      ...normalizeNodeExecutionTimingConfig(currentConfig),
      ...patch
    })
  };
}

function normalizeExecutionWaitSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function parseExecutionWaitSeconds(value) {
  const parsed = Number(value);
  return normalizeExecutionWaitSeconds(parsed);
}

function buildSendEmailConnectionOptions(activeConnectionId, workspaceConnections = []) {
  const options = [
    {
      label: 'Default workspace mailer',
      value: 'default_mailer'
    }
  ];

  workspaceConnections
    .filter(
      (connection) =>
        connection?.status === 'active' &&
        (connection?.capabilities?.send_email === true ||
          connection?.connection_kind === 'gmail')
    )
    .forEach((connection) => {
      if (!options.some((option) => option.value === connection.connection_id)) {
        options.push({
          label: connection.display_name,
          value: connection.connection_id
        });
      }
    });

  if (
    activeConnectionId &&
    !options.some((option) => option.value === activeConnectionId)
  ) {
    options.push({
      label: activeConnectionId,
      value: activeConnectionId
    });
  }

  return options;
}

function buildDoltRepoSourceConnectionOptions(activeConnectionRef) {
  const options = [...DOLT_REPO_SOURCE_CONNECTION_CHOICES];

  if (
    activeConnectionRef &&
    !options.some((option) => option.value === activeConnectionRef)
  ) {
    options.push({
      label: activeConnectionRef,
      value: activeConnectionRef
    });
  }

  return options;
}

function buildDoltRepoSourceBranchOptions(activeBranch) {
  const options = [...DOLT_REPO_SOURCE_BRANCH_CHOICES];

  if (activeBranch && !options.some((option) => option.value === activeBranch)) {
    options.push({
      label: activeBranch,
      value: activeBranch
    });
  }

  return options;
}

function buildDoltRepoSourceRuntimeSummary(config) {
  const repository =
    typeof config?.repository === 'string' ? config.repository.trim() : '';
  const checkoutRef =
    typeof config?.checkout_ref === 'string' && config.checkout_ref.trim()
      ? config.checkout_ref.trim()
      : null;
  const profile = resolveMockDoltRepoSourceProfile(repository);
  const cloneMode =
    config?.clone_mode === 'fresh_clone' || config?.clone_mode === 'depth_1'
      ? config.clone_mode
      : DEFAULT_DOLT_REPO_SOURCE_CLONE_MODE;
  const syncStrategy =
    config?.sync_strategy === 'clone_only' || config?.sync_strategy === 'manual'
      ? config.sync_strategy
      : DEFAULT_DOLT_REPO_SOURCE_SYNC_STRATEGY;

  return {
    currentCommit: checkoutRef
      ? checkoutRef.slice(0, 12)
      : profile?.currentCommit ?? 'pending_sync',
    repoFamily: profile?.repoFamily ?? deriveDoltRepoSourceRepoFamily(repository),
    syncStrategyLabel: describeDoltRepoSourceSyncStrategy(syncStrategy),
    workingCopy:
      cloneMode === 'fresh_clone'
        ? 'fresh clone per run'
        : cloneMode === 'depth_1'
          ? 'shallow clone reused'
          : 'reused across runs'
  };
}

function resolveMockDoltRepoSourceProfile(repository) {
  switch (repository) {
    case 'post-no-preference/earnings':
      return {
        repoFamily: 'earnings',
        previousCommit: '92fd7ac',
        currentCommit: 'a34ef9c'
      };
    case 'post-no-preference/options':
      return {
        repoFamily: 'options',
        previousCommit: 'ac31f0b',
        currentCommit: 'b91c2aa'
      };
    case 'post-no-preference/rates':
      return {
        repoFamily: 'rates',
        previousCommit: 'c83f10d',
        currentCommit: 'd0f61b4'
      };
    default:
      return null;
  }
}

function resolveMockCheckpointReadState(config = {}) {
  const sourceRepo =
    typeof config?.source_repo === 'string' && config.source_repo.trim()
      ? config.source_repo.trim()
      : DEFAULT_CHECKPOINT_READ_SOURCE_REPO;
  const branch =
    typeof config?.branch === 'string' && config.branch.trim()
      ? config.branch.trim()
      : DEFAULT_CHECKPOINT_READ_BRANCH;
  const checkpointTable =
    typeof config?.checkpoint_table === 'string' && config.checkpoint_table.trim()
      ? config.checkpoint_table.trim()
      : DEFAULT_CHECKPOINT_READ_TABLE;
  const emitBootstrapMarkerIfMissing =
    typeof config?.emit_bootstrap_marker_if_missing === 'boolean'
      ? config.emit_bootstrap_marker_if_missing
      : DEFAULT_CHECKPOINT_READ_EMIT_BOOTSTRAP_MARKER_IF_MISSING;
  const failOnStaleCheckpoint =
    typeof config?.fail_on_stale_checkpoint === 'boolean'
      ? config.fail_on_stale_checkpoint
      : DEFAULT_CHECKPOINT_READ_FAIL_ON_STALE_CHECKPOINT;
  const profile = resolveMockDoltRepoSourceProfile(sourceRepo);

  if (!profile) {
    return {
      branch,
      checkpointTable,
      emitBootstrapMarkerIfMissing,
      failOnStaleCheckpoint,
      hasCheckpoint: false,
      lastIngestMode: emitBootstrapMarkerIfMissing
        ? 'bootstrap_pending'
        : 'checkpoint_required',
      lastSuccessAt: null,
      lastSyncedCommit: null,
      scopeLabel: 'repo checkpoint',
      sourceRepo,
      staleCheckpoint: false
    };
  }

  return {
    branch,
    checkpointTable,
    emitBootstrapMarkerIfMissing,
    failOnStaleCheckpoint,
    hasCheckpoint: true,
    lastIngestMode:
      sourceRepo === 'post-no-preference/earnings' ? 'bootstrap_refresh' : 'recurring_delta',
    lastSuccessAt:
      sourceRepo === 'post-no-preference/options'
        ? '2026-06-08T14:22:11Z'
        : sourceRepo === 'post-no-preference/rates'
          ? '2026-06-08T09:15:42Z'
          : '2026-06-07T18:04:09Z',
    lastSyncedCommit: profile.previousCommit ?? null,
    scopeLabel: 'repo checkpoint',
    sourceRepo,
    staleCheckpoint: false
  };
}

function describeDoltRepoSourceSyncStrategy(syncStrategy) {
  switch (syncStrategy) {
    case 'clone_only':
      return 'clone only on bootstrap';
    case 'manual':
      return 'manual sync only';
    default:
      return 'pull before execution';
  }
}

function buildCheckpointReadRuntimeSummary(config) {
  const checkpointState = resolveMockCheckpointReadState(config);

  return {
    checkpointTable: checkpointState.checkpointTable,
    lastIngestMode: humanizeToken(checkpointState.lastIngestMode),
    lastSuccessAt: checkpointState.lastSuccessAt ?? 'bootstrap pending',
    lastSyncedCommit: checkpointState.lastSyncedCommit ?? 'bootstrap pending',
    scopeLabel: checkpointState.scopeLabel,
    sourceRepo: checkpointState.sourceRepo
  };
}

function buildCheckpointWriteRuntimeSummary(config, workflow, nodeId) {
  const checkpointContext = resolveConnectedCheckpointWritePanelContext(workflow, nodeId);

  return {
    checkpointTable:
      typeof config?.checkpoint_table === 'string' && config.checkpoint_table.trim()
        ? config.checkpoint_table.trim()
        : DEFAULT_CHECKPOINT_WRITE_TABLE,
    commitSource:
      config?.commit_source === 'metadata.current_commit'
        ? 'metadata.current_commit'
        : DEFAULT_CHECKPOINT_WRITE_COMMIT_SOURCE,
    currentCommit: checkpointContext?.currentCommit ?? 'pending_merge',
    lastIngestMode:
      checkpointContext?.previousCommit == null ? 'Bootstrap Refresh' : 'Recurring Delta',
    repository: checkpointContext?.repository ?? DEFAULT_DOLT_REPO_SOURCE_REPOSITORY,
    scopeLabel: checkpointContext?.scopeLabel ?? 'Repo + branch',
    sourceTablesLabel:
      checkpointContext?.sourceTables?.length > 0
        ? checkpointContext.sourceTables.length === 1
          ? checkpointContext.sourceTables[0]
          : `${checkpointContext.sourceTables[0]} +${checkpointContext.sourceTables.length - 1} more`
        : 'awaiting durable table',
    writeGateLabel:
      config?.only_persist_on_full_success === false
        ? config?.advance_on_partial_success
          ? 'Partial success allowed'
          : 'Durable success'
        : 'Full success only',
    writeTimingLabel:
      config?.write_timing === 'after_quality_gate'
        ? 'After quality gate'
        : 'After merge success'
  };
}

function buildQualityCheckRuntimeSummary(config, workflow, nodeId) {
  const qualityContext = resolveConnectedQualityCheckPanelContext(workflow, nodeId);
  const qualityState = resolveMockQualityCheckPanelState(config, qualityContext);
  const sourceTables = qualityContext?.sourceTables ?? [];

  return {
    approvedTablesLabel:
      sourceTables.length === 0
        ? 'awaiting durable table'
        : sourceTables.length === 1
          ? sourceTables[0]
          : `${sourceTables[0]} +${sourceTables.length - 1} more`,
    currentCommit: qualityContext?.currentCommit ?? 'pending_sync',
    gateLabel:
      config?.block_checkpoint_write_on_failure === false
        ? 'publish only'
        : 'checkpoint + publish',
    gateStatusLabel:
      qualityState.gate_status === 'fail'
        ? 'Fail'
        : qualityState.gate_status === 'warn'
          ? 'Warn'
          : 'Pass',
    lastResultLabel:
      qualityState.failing_rules.length > 0
        ? `${qualityState.failing_rules.length} failure${qualityState.failing_rules.length === 1 ? '' : 's'}`
        : qualityState.warning_rules.length > 0
          ? `${qualityState.warning_rules.length} warning${qualityState.warning_rules.length === 1 ? '' : 's'}`
          : 'All checks passed',
    repository: qualityContext?.repository ?? DEFAULT_DOLT_REPO_SOURCE_REPOSITORY,
    scopeLabel: qualityContext?.scopeLabel ?? 'repo + branch',
    sourceTablesLabel:
      sourceTables.length === 0
        ? 'awaiting durable table'
        : sourceTables.length === 1
          ? sourceTables[0]
          : `${sourceTables[0]} +${sourceTables.length - 1} more`,
    suitePresetLabel: describeQualityCheckSuitePreset(config?.suite_preset),
    warningBudgetLabel: `${qualityState.warning_budget} warning${qualityState.warning_budget === 1 ? '' : 's'}`
  };
}

function buildDoltRepoSyncRuntimeSummary(config, workflow, nodeId) {
  const sourceConfig = resolveConnectedDoltRepoSourcePanelConfig(workflow, nodeId);
  const checkpointContext = resolveConnectedCheckpointReadPanelContext(workflow, nodeId);
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const profile = resolveMockDoltRepoSourceProfile(repository);
  const checkoutRef =
    typeof sourceConfig?.checkout_ref === 'string' && sourceConfig.checkout_ref.trim()
      ? sourceConfig.checkout_ref.trim()
      : null;

  return {
    currentCommit: checkoutRef
      ? checkoutRef.slice(0, 12)
      : profile?.currentCommit ?? 'pending_sync',
    checkpointSourceLabel: checkpointContext?.lastSyncedCommit
      ? 'checkpoint_context.last_synced_commit'
      : checkpointContext
        ? 'bootstrap marker'
        : 'mock repo baseline',
    previousCommit: checkpointContext
      ? checkpointContext.lastSyncedCommit ?? 'pending_checkpoint'
      : profile?.previousCommit ?? 'pending_checkpoint',
    repoFamily: profile?.repoFamily ?? deriveDoltRepoSourceRepoFamily(repository),
    repository,
    syncActionLabel: describeDoltRepoSyncAction(config?.sync_action),
  };
}

function buildDoltChangeManifestRuntimeSummary(config, workflow, nodeId) {
  const syncContext = resolveConnectedDoltRepoSyncPanelContext(workflow, nodeId);
  const sourceConfig = syncContext?.sourceConfig ?? null;
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const profile = resolveMockDoltRepoSourceProfile(repository);
  const checkoutRef =
    typeof sourceConfig?.checkout_ref === 'string' && sourceConfig.checkout_ref.trim()
      ? sourceConfig.checkout_ref.trim()
      : null;
  const manifestProfile = resolveMockDoltChangeManifestProfile(repository);
  const changedTables = filterDoltChangeManifestTablesForScope(
    manifestProfile?.changedTables ?? [],
    config?.table_scope,
    config?.selected_tables ?? []
  );
  const schemaFlaggedTables = filterDoltChangeManifestTablesForScope(
    manifestProfile?.schemaChangedTables ?? [],
    config?.table_scope,
    config?.selected_tables ?? []
  );

  return {
    changedTables,
    currentCommit: checkoutRef
      ? checkoutRef.slice(0, 12)
      : profile?.currentCommit ?? 'pending_sync',
    previousCommit: profile?.previousCommit ?? 'pending_checkpoint',
    repoFamily: profile?.repoFamily ?? deriveDoltRepoSourceRepoFamily(repository),
    repository,
    schemaDriftLabel:
      schemaFlaggedTables.length > 0
        ? `${schemaFlaggedTables.length} table${schemaFlaggedTables.length === 1 ? '' : 's'} flagged`
        : changedTables.length > 0
          ? 'No drift'
          : 'Pending scope',
    scopeLabel:
      config?.table_scope === 'allowlist'
        ? config?.selected_tables?.length
          ? `${config.selected_tables.length} selected`
          : 'selected tables'
        : 'all tables'
  };
}

function buildDoltDumpRuntimeSummary(config, workflow, nodeId) {
  const sourceContext = resolveConnectedDoltDumpPanelContext(workflow, nodeId);
  const sourceConfig = sourceContext?.sourceConfig ?? null;
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const profile = resolveMockDoltRepoSourceProfile(repository);
  const manifestTables = sourceContext?.manifestTables ?? [];
  const selectedTables = config?.selected_tables ?? [];

  return {
    formatLabel: config?.output_format === 'csv' ? 'csv' : 'parquet',
    repoFamily: profile?.repoFamily ?? deriveDoltRepoSourceRepoFamily(repository),
    repository,
    scopeLabel:
      config?.table_selection_mode === 'manual_tables'
        ? selectedTables.length > 0
          ? `${selectedTables.length} selected`
          : 'selected tables'
        : config?.table_selection_mode === 'prefer_manifest_scope' &&
            sourceContext?.sourceTypeId === 'dolt_change_manifest'
          ? manifestTables.length > 0
            ? `${manifestTables.length} changed`
            : 'changed tables'
          : 'all tables',
    sourceHandleLabel:
      sourceContext?.sourceTypeId === 'dolt_change_manifest'
        ? 'dataset_ref.manifest_ref'
        : 'dataset_ref.repo_ref',
    sourceKind:
      sourceContext?.sourceTypeId === 'dolt_change_manifest'
        ? 'change manifest'
        : sourceContext?.sourceTypeId === 'dolt_repo_sync'
          ? 'synced repo'
          : 'repo handle'
  };
}

function buildDoltDiffExportRuntimeSummary(config, workflow, nodeId) {
  const sourceContext = resolveConnectedDoltDiffExportPanelContext(workflow, nodeId);
  const sourceConfig = sourceContext?.sourceConfig ?? null;
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const profile = resolveMockDoltRepoSourceProfile(repository);
  const checkoutRef =
    typeof sourceConfig?.checkout_ref === 'string' && sourceConfig.checkout_ref.trim()
      ? sourceConfig.checkout_ref.trim()
      : null;
  const manifestTables = sourceContext?.manifestTables ?? [];
  const currentCommit = checkoutRef
    ? checkoutRef.slice(0, 12)
    : profile?.currentCommit ?? 'pending_sync';
  const previousCommit = profile?.previousCommit ?? 'pending_checkpoint';
  const deleteRowsPresent = sourceContext?.rowSummaries?.some(
    (summary) => summary.removed > 0
  ) ?? false;

  return {
    currentCommit,
    deleteRowsLabel: deleteRowsPresent ? 'present in manifest' : 'none flagged',
    filterLabel: describeDoltDiffExportChangeFilter(config?.change_filter),
    rangeLabel: `${previousCommit} -> ${currentCommit}`,
    repoFamily: profile?.repoFamily ?? deriveDoltRepoSourceRepoFamily(repository),
    repository,
    scopeLabel:
      manifestTables.length > 0
        ? `${manifestTables.length} table${manifestTables.length === 1 ? '' : 's'}`
        : 'awaiting manifest',
    deletedRowHandlingLabel: describeDoltDiffExportDeletedRowHandling(
      config?.deleted_row_handling
    )
  };
}

function buildLoadToDuckDbRuntimeSummary(config, workflow, nodeId) {
  const sourceContext = resolveConnectedLoadToDuckDbPanelContext(workflow, nodeId);
  const repository =
    typeof sourceContext?.repository === 'string' && sourceContext.repository.trim()
      ? sourceContext.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const loadedTableCount = sourceContext?.loadedTableCount ?? 0;

  return {
    bundleModeLabel:
      sourceContext?.sourceTypeId === 'dolt_diff_export'
        ? 'delta bundle'
        : sourceContext?.sourceTypeId === 'dolt_dump'
          ? 'snapshot bundle'
          : 'dump + diff bundles',
    loadedTablesLabel:
      loadedTableCount > 0
        ? `${loadedTableCount} table${loadedTableCount === 1 ? '' : 's'}`
        : 'awaiting bundle',
    mergeContextLabel:
      sourceContext?.sourceTypeId === 'dolt_diff_export'
        ? `${sourceContext.previousCommit ?? 'pending_checkpoint'} -> ${sourceContext.currentCommit ?? 'pending_sync'}`
        : sourceContext?.currentCommit ?? 'load manifest',
    repository,
    sourceTypeLabel:
      sourceContext?.sourceTypeId === 'dolt_diff_export'
        ? 'dolt_diff_export bundle'
        : sourceContext?.sourceTypeId === 'dolt_dump'
          ? 'dolt_dump bundle'
          : 'auto-detect at runtime',
    targetSchema:
      typeof config?.target_schema === 'string' && config.target_schema.trim()
        ? config.target_schema.trim()
        : DEFAULT_LOAD_TO_DUCKDB_TARGET_SCHEMA
  };
}

function buildSqlTransformRuntimeSummary(config, workflow, nodeId) {
  const sourceContext = resolveConnectedSqlTransformPanelContext(workflow, nodeId);
  const targetSchema =
    typeof config?.target_schema === 'string' && config.target_schema.trim()
      ? config.target_schema.trim()
      : DEFAULT_SQL_TRANSFORM_TARGET_SCHEMA;
  const outputTableName =
    typeof config?.output_table_name === 'string' && config.output_table_name.trim()
      ? config.output_table_name.trim()
      : DEFAULT_SQL_TRANSFORM_OUTPUT_TABLE_NAME;

  return {
    materializationModeLabel:
      config?.materialization_mode === 'view' ? 'View' : 'View only',
    sourceTableLabel: sourceContext?.sourceTable ?? 'awaiting table',
    sourceTypeLabel:
      sourceContext?.sourceTypeId === 'load_to_duckdb'
        ? 'load_to_duckdb table_ref'
        : sourceContext?.sourceTypeId === 'table_input'
          ? 'table_input table_ref'
          : sourceContext?.sourceTypeId === 'sql_transform'
            ? 'sql_transform table_ref'
            : 'table_ref input',
    sqlModeLabel: 'Inline SQL',
    targetLocationLabel: `${targetSchema}.${outputTableName}`
  };
}

function buildTableMergeRuntimeSummary(config, workflow, nodeId) {
  const sourceContext = resolveConnectedTableMergePanelContext(workflow, nodeId);
  const sourceTables = sourceContext?.sourceTables ?? [];

  return {
    deleteHandlingLabel: describeTableMergeDeleteHandling(config?.delete_handling),
    mergeKeyLabel:
      sourceTables.length > 0 && config?.merge_key_columns?.length > 0
        ? config.merge_key_columns.join(', ')
        : config?.merge_key_columns?.length > 0
          ? config.merge_key_columns.join(', ')
          : 'No merge key',
    schemaDriftLabel: describeTableMergeSchemaDriftBehavior(
      config?.schema_drift_behavior
    ),
    sourceTablesLabel:
      sourceTables.length === 0
        ? 'awaiting staged tables'
        : sourceTables.length === 1
          ? sourceTables[0]
          : `${sourceTables[0]} +${sourceTables.length - 1} more`,
    targetSchema:
      typeof config?.target_schema === 'string' && config.target_schema.trim()
        ? config.target_schema.trim()
        : DEFAULT_TABLE_MERGE_TARGET_SCHEMA,
    writePolicyLabel: describeTableMergeWritePolicy(config?.write_policy)
  };
}

function resolveConnectedDoltRepoSourcePanelConfig(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_repo_source'
  );

  return sourceNode?.config ?? null;
}

function resolveConnectedDoltRepoSyncPanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  );
  if (!incomingEdge) {
    return null;
  }

  const syncNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_repo_sync'
  );
  if (!syncNode) {
    return null;
  }

  return {
    checkpointContext: resolveConnectedCheckpointReadPanelContext(workflow, syncNode.node_id),
    sourceConfig: resolveConnectedDoltRepoSourcePanelConfig(workflow, syncNode.node_id),
    syncConfig: syncNode.config ?? {}
  };
}

function resolveConnectedCheckpointReadPanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'checkpoint'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'checkpoint_read'
  );
  if (!sourceNode) {
    return null;
  }

  return resolveMockCheckpointReadState(sourceNode.config ?? {});
}

function resolveConnectedCheckpointWritePanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'table'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id);
  if (!sourceNode) {
    return null;
  }

  if (sourceNode.type_id === 'table_merge') {
    const mergeContext = resolveConnectedTableMergePanelContext(workflow, sourceNode.node_id);
    const loadContext = resolveConnectedLoadToDuckDbPanelContextFromTableNode(
      workflow,
      sourceNode.node_id
    );

    return {
      branch: loadContext?.branch ?? DEFAULT_DOLT_REPO_SOURCE_BRANCH,
      currentCommit: loadContext?.currentCommit ?? 'pending_sync',
      previousCommit: loadContext?.previousCommit ?? null,
      repository: loadContext?.repository ?? DEFAULT_DOLT_REPO_SOURCE_REPOSITORY,
      scopeLabel: 'Repo + branch',
      sourceTables: mergeContext?.sourceTables ?? []
    };
  }

  if (sourceNode.type_id === 'quality_check') {
    const qualityContext = resolveConnectedQualityCheckPanelContext(workflow, sourceNode.node_id);
    if (!qualityContext) {
      return null;
    }

    return {
      branch: qualityContext.branch ?? DEFAULT_DOLT_REPO_SOURCE_BRANCH,
      currentCommit: qualityContext.currentCommit ?? 'pending_sync',
      previousCommit: qualityContext.previousCommit ?? null,
      repository: qualityContext.repository ?? DEFAULT_DOLT_REPO_SOURCE_REPOSITORY,
      scopeLabel: qualityContext.scopeLabel ?? 'Repo + branch',
      sourceTables: qualityContext.sourceTables ?? []
    };
  }

  return null;
}

function resolveConnectedQualityCheckPanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'table'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id);
  if (!sourceNode || sourceNode.type_id !== 'table_merge') {
    return null;
  }

  const loadContext = resolveConnectedLoadToDuckDbPanelContextFromTableNode(
    workflow,
    sourceNode.node_id
  );
  const mergeContext = resolveConnectedTableMergePanelContext(workflow, sourceNode.node_id);

  return {
    branch: loadContext?.branch ?? DEFAULT_DOLT_REPO_SOURCE_BRANCH,
    currentCommit: loadContext?.currentCommit ?? 'pending_sync',
    previousCommit: loadContext?.previousCommit ?? null,
    repository: loadContext?.repository ?? DEFAULT_DOLT_REPO_SOURCE_REPOSITORY,
    scopeLabel: 'Repo + branch',
    sourceTables: mergeContext?.sourceTables ?? []
  };
}

function resolveMockQualityCheckPanelState(config = {}, context = null) {
  const repository =
    typeof context?.repository === 'string' && context.repository.trim()
      ? context.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const warningBudget = normalizeQualityCheckWarningBudget(config?.warning_budget);
  const allowWarningOnlyRunsToContinue =
    config?.allow_warning_only_runs_to_continue !== false;
  const blockCheckpointWriteOnFailure =
    config?.block_checkpoint_write_on_failure !== false;
  const suitePreset =
    config?.suite_preset === 'custom_rule_bundle'
      ? 'custom_rule_bundle'
      : DEFAULT_QUALITY_CHECK_SUITE_PRESET;

  if (repository === 'post-no-preference/earnings') {
    return {
      allow_warning_only_runs_to_continue: allowWarningOnlyRunsToContinue,
      block_checkpoint_write_on_failure: blockCheckpointWriteOnFailure,
      failing_rules: [],
      gate_status: 'warn',
      suite_preset: suitePreset,
      warning_budget: warningBudget,
      warning_rules: ['freshness lag', 'soft schema drift note']
    };
  }

  return {
    allow_warning_only_runs_to_continue: allowWarningOnlyRunsToContinue,
    block_checkpoint_write_on_failure: blockCheckpointWriteOnFailure,
    failing_rules: [],
    gate_status: 'pass',
    suite_preset: suitePreset,
    warning_budget: warningBudget,
    warning_rules: []
  };
}

function resolveConnectedDoltDumpPanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id);
  if (!sourceNode) {
    return null;
  }

  if (sourceNode.type_id === 'dolt_repo_source') {
    return {
      manifestTables: [],
      sourceConfig: sourceNode.config ?? null,
      sourceTypeId: sourceNode.type_id
    };
  }

  if (sourceNode.type_id === 'dolt_repo_sync') {
    return {
      manifestTables: [],
      sourceConfig: resolveConnectedDoltRepoSourcePanelConfig(workflow, sourceNode.node_id),
      sourceTypeId: sourceNode.type_id
    };
  }

  if (sourceNode.type_id === 'dolt_change_manifest') {
    const syncContext = resolveConnectedDoltRepoSyncPanelContext(workflow, sourceNode.node_id);
    const sourceConfig = syncContext?.sourceConfig ?? null;
    const repository =
      typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
        ? sourceConfig.repository.trim()
        : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
    const manifestProfile = resolveMockDoltChangeManifestProfile(repository);
    const manifestTables = filterDoltChangeManifestTablesForScope(
      manifestProfile?.changedTables ?? [],
      sourceNode.config?.table_scope,
      normalizeDoltChangeManifestSelectedTables(sourceNode.config?.selected_tables)
    );

    return {
      manifestTables,
      sourceConfig,
      sourceTypeId: sourceNode.type_id
    };
  }

  return null;
}

function resolveConnectedDoltDiffExportPanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'manifest'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_change_manifest'
  );
  if (!sourceNode) {
    return null;
  }

  const syncContext = resolveConnectedDoltRepoSyncPanelContext(workflow, sourceNode.node_id);
  const sourceConfig = syncContext?.sourceConfig ?? null;
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const manifestProfile = resolveMockDoltChangeManifestProfile(repository);
  const manifestTables = filterDoltChangeManifestTablesForScope(
    manifestProfile?.changedTables ?? [],
    sourceNode.config?.table_scope,
    normalizeDoltChangeManifestSelectedTables(sourceNode.config?.selected_tables)
  );
  const rowSummaryByTable = manifestProfile?.rowChangeSummary ?? {};
  const rowSummaries = manifestTables.map((tableName) => ({
    added: rowSummaryByTable[tableName]?.added ?? 0,
    modified: rowSummaryByTable[tableName]?.modified ?? 0,
    removed: rowSummaryByTable[tableName]?.removed ?? 0,
    tableName
  }));

  return {
    manifestTables,
    rowSummaries,
    sourceConfig
  };
}

function resolveConnectedLoadToDuckDbPanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'bundle'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id);
  if (!sourceNode) {
    return null;
  }

  if (sourceNode.type_id === 'dolt_dump') {
    const dumpContext = resolveConnectedDoltDumpPanelContext(workflow, sourceNode.node_id);
    return {
      branch:
        typeof dumpContext?.sourceConfig?.branch === 'string' &&
        dumpContext.sourceConfig.branch.trim()
          ? dumpContext.sourceConfig.branch.trim()
          : DEFAULT_DOLT_REPO_SOURCE_BRANCH,
      currentCommit: resolveLoadToDuckDbCurrentCommit(dumpContext?.sourceConfig),
      loadedTableCount: resolveLoadToDuckDbDumpTableCount(sourceNode.config, dumpContext),
      repository: dumpContext?.sourceConfig?.repository ?? DEFAULT_DOLT_REPO_SOURCE_REPOSITORY,
      sourceTypeId: sourceNode.type_id
    };
  }

  if (sourceNode.type_id === 'dolt_diff_export') {
    const diffContext = resolveConnectedDoltDiffExportPanelContext(workflow, sourceNode.node_id);
    return {
      branch:
        typeof diffContext?.sourceConfig?.branch === 'string' &&
        diffContext.sourceConfig.branch.trim()
          ? diffContext.sourceConfig.branch.trim()
          : DEFAULT_DOLT_REPO_SOURCE_BRANCH,
      currentCommit: resolveLoadToDuckDbCurrentCommit(diffContext?.sourceConfig),
      loadedTableCount: diffContext?.manifestTables?.length ?? 0,
      previousCommit: resolveLoadToDuckDbPreviousCommit(diffContext?.sourceConfig),
      repository: diffContext?.sourceConfig?.repository ?? DEFAULT_DOLT_REPO_SOURCE_REPOSITORY,
      sourceTypeId: sourceNode.type_id
    };
  }

  return null;
}

function resolveConnectedLoadToDuckDbPanelTableNames(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return [];
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'bundle'
  );
  if (!incomingEdge) {
    return [];
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id);
  if (!sourceNode) {
    return [];
  }

  if (sourceNode.type_id === 'dolt_dump') {
    const dumpContext = resolveConnectedDoltDumpPanelContext(workflow, sourceNode.node_id);
    const repository =
      typeof dumpContext?.sourceConfig?.repository === 'string' &&
      dumpContext.sourceConfig.repository.trim()
        ? dumpContext.sourceConfig.repository.trim()
        : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;

    if (sourceNode.config?.table_selection_mode === 'manual_tables') {
      return normalizeDoltDumpSelectedTables(sourceNode.config?.selected_tables);
    }

    if (
      sourceNode.config?.table_selection_mode === 'prefer_manifest_scope' &&
      dumpContext?.sourceTypeId === 'dolt_change_manifest'
    ) {
      return dumpContext?.manifestTables ?? [];
    }

    return mockDoltDumpTableCatalog(repository);
  }

  if (sourceNode.type_id === 'dolt_diff_export') {
    return resolveConnectedDoltDiffExportPanelContext(workflow, sourceNode.node_id)?.manifestTables ?? [];
  }

  return [];
}

function resolveConnectedSqlTransformPanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'table'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id);
  if (!sourceNode) {
    return null;
  }

  if (sourceNode.type_id === 'load_to_duckdb') {
    const sourceConfig = normalizeLoadToDuckDbPanelConfig(sourceNode);
    const sourceTables = resolveConnectedLoadToDuckDbPanelTableNames(workflow, sourceNode.node_id);

    return {
      sourceSchema: sourceConfig.target_schema,
      sourceTable: sourceTables[0] ?? null,
      sourceTypeId: sourceNode.type_id
    };
  }

  if (sourceNode.type_id === 'table_input') {
    const sourceConfig = normalizeTableInputPanelConfig(sourceNode);

    return {
      sourceSchema: sourceConfig.schema_name,
      sourceTable: sourceConfig.table_name,
      sourceTypeId: sourceNode.type_id
    };
  }

  if (sourceNode.type_id === 'sql_transform') {
    const sourceConfig = normalizeSqlTransformPanelConfig(sourceNode);

    return {
      sourceSchema: sourceConfig.target_schema,
      sourceTable: sourceConfig.output_table_name,
      sourceTypeId: sourceNode.type_id
    };
  }

  return null;
}

function resolveConnectedLoadToDuckDbPanelContextFromTableNode(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'table'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id);
  if (!sourceNode) {
    return null;
  }

  if (sourceNode.type_id === 'load_to_duckdb') {
    return resolveConnectedLoadToDuckDbPanelContext(workflow, sourceNode.node_id);
  }

  if (sourceNode.type_id === 'sql_transform') {
    return resolveConnectedLoadToDuckDbPanelContextFromTableNode(workflow, sourceNode.node_id);
  }

  return null;
}

function resolveConnectedTableMergePanelContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null;
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'table'
  );
  if (!incomingEdge) {
    return null;
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id);
  if (!sourceNode) {
    return null;
  }

  if (sourceNode.type_id === 'load_to_duckdb') {
    const sourceConfig = normalizeLoadToDuckDbPanelConfig(sourceNode);

    return {
      sourceSchema: sourceConfig.target_schema,
      sourceTables: resolveConnectedLoadToDuckDbPanelTableNames(workflow, sourceNode.node_id),
      sourceTypeId: sourceNode.type_id
    };
  }

  if (sourceNode.type_id === 'table_input') {
    const sourceConfig = normalizeTableInputPanelConfig(sourceNode);

    return {
      sourceSchema: sourceConfig.schema_name,
      sourceTables: [sourceConfig.table_name],
      sourceTypeId: sourceNode.type_id
    };
  }

  if (sourceNode.type_id === 'sql_transform') {
    const sourceConfig = normalizeSqlTransformPanelConfig(sourceNode);

    return {
      sourceSchema: sourceConfig.target_schema,
      sourceTables: [sourceConfig.output_table_name],
      sourceTypeId: sourceNode.type_id
    };
  }

  return null;
}

function resolveLoadToDuckDbCurrentCommit(sourceConfig) {
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const profile = resolveMockDoltRepoSourceProfile(repository);
  const checkoutRef =
    typeof sourceConfig?.checkout_ref === 'string' && sourceConfig.checkout_ref.trim()
      ? sourceConfig.checkout_ref.trim()
      : '';

  return checkoutRef ? checkoutRef.slice(0, 12) : profile?.currentCommit ?? 'pending_sync';
}

function resolveLoadToDuckDbPreviousCommit(sourceConfig) {
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const profile = resolveMockDoltRepoSourceProfile(repository);

  return profile?.previousCommit ?? 'pending_checkpoint';
}

function resolveLoadToDuckDbDumpTableCount(config, sourceContext) {
  if (!sourceContext) {
    return 0;
  }

  const repository =
    typeof sourceContext?.sourceConfig?.repository === 'string' &&
    sourceContext.sourceConfig.repository.trim()
      ? sourceContext.sourceConfig.repository.trim()
      : DEFAULT_DOLT_REPO_SOURCE_REPOSITORY;
  const selectedTables = normalizeDoltDumpSelectedTables(config?.selected_tables);

  if (config?.table_selection_mode === 'manual_tables') {
    return selectedTables.length;
  }

  if (
    config?.table_selection_mode === 'prefer_manifest_scope' &&
    sourceContext?.sourceTypeId === 'dolt_change_manifest'
  ) {
    return sourceContext.manifestTables?.length ?? 0;
  }

  return mockDoltDumpTableCatalog(repository).length;
}

function describeDoltRepoSyncAction(syncAction) {
  switch (syncAction) {
    case 'fetch_and_checkout':
      return 'fetch and checkout';
    case 'refresh_checkout':
      return 'refresh checkout';
    default:
      return 'pull remote head';
  }
}

function describeDoltDiffExportChangeFilter(changeFilter) {
  switch (changeFilter) {
    case 'non_delete_changes':
      return 'Non-delete changes';
    case 'added_only':
      return 'Added only';
    case 'modified_only':
      return 'Modified only';
    case 'removed_only':
      return 'Removed only';
    default:
      return 'All changes';
  }
}

function describeDoltDiffExportDeletedRowHandling(deletedRowHandling) {
  switch (deletedRowHandling) {
    case 'omit_delete_rows':
      return 'Omit delete rows';
    default:
      return 'Emit delete markers';
  }
}

function describeQualityCheckSuitePreset(suitePreset) {
  switch (suitePreset) {
    case 'custom_rule_bundle':
      return 'Custom rule bundle';
    default:
      return 'Post-merge ingest gate';
  }
}

function describeTableMergeWritePolicy(writePolicy) {
  switch (writePolicy) {
    case 'append_only':
      return 'Append only';
    case 'snapshot_replace':
      return 'Snapshot replace';
    default:
      return 'Upsert';
  }
}

function describeTableMergeDeleteHandling(deleteHandling) {
  switch (deleteHandling) {
    case 'ignore_delete_markers':
      return 'Ignore delete markers';
    default:
      return 'Apply delete markers';
  }
}

function describeTableMergeSchemaDriftBehavior(schemaDriftBehavior) {
  switch (schemaDriftBehavior) {
    case 'allow_additive_changes':
      return 'Allow additive changes';
    default:
      return 'Fail and require review';
  }
}

function normalizeDoltChangeManifestSelectedTables(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean))];
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
  }

  return [];
}

function normalizeDoltDumpSelectedTables(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean))];
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
  }

  return [];
}

function mockDoltDumpTableCatalog(repository) {
  switch (repository) {
    case 'post-no-preference/earnings':
      return [
        'balance_sheet_assets',
        'balance_sheet_equity',
        'balance_sheet_liabilities',
        'cash_flow_statement',
        'earnings_calendar',
        'eps_estimate',
        'eps_history',
        'income_statement',
        'rank_score',
        'sales_estimate'
      ];
    case 'post-no-preference/options':
      return ['option_chain', 'volatility_history'];
    case 'post-no-preference/rates':
      return ['us_treasury'];
    default:
      return [];
  }
}

function resolveMockDoltChangeManifestProfile(repository) {
  switch (repository) {
    case 'post-no-preference/earnings':
      return {
        changedTables: ['earnings_calendar', 'eps_history', 'income_statement'],
        rowChangeSummary: {
          earnings_calendar: { added: 24, modified: 3, removed: 0 },
          eps_history: { added: 18, modified: 5, removed: 0 },
          income_statement: { added: 4, modified: 2, removed: 0 }
        },
        schemaChangedTables: ['income_statement']
      };
    case 'post-no-preference/options':
      return {
        changedTables: ['option_chain', 'volatility_history'],
        rowChangeSummary: {
          option_chain: { added: 440, modified: 182, removed: 17 },
          volatility_history: { added: 32, modified: 4, removed: 0 }
        },
        schemaChangedTables: []
      };
    case 'post-no-preference/rates':
      return {
        changedTables: ['us_treasury'],
        rowChangeSummary: {
          us_treasury: { added: 6, modified: 1, removed: 0 }
        },
        schemaChangedTables: []
      };
    default:
      return null;
  }
}

function filterDoltChangeManifestTablesForScope(changedTables, tableScope, selectedTables) {
  if (tableScope !== 'allowlist') {
    return [...changedTables];
  }

  if (!Array.isArray(selectedTables) || selectedTables.length === 0) {
    return [];
  }

  const selectedSet = new Set(selectedTables);
  return changedTables.filter((tableName) => selectedSet.has(tableName));
}

function deriveDoltRepoSourceRepoFamily(repository) {
  if (!repository) {
    return 'repo';
  }

  const segments = repository
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments[segments.length - 1] ?? 'repo';
}

function normalizeTableInputSelectedColumns(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

function normalizeTableSchemaPrimaryKeyNames(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeTableSchemaNames(
    value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
  );
}

function normalizeTableSchemaChecks(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function normalizeStoredTableSchemaColumns(value, primaryKey = []) {
  const sourceColumns = Array.isArray(value) && value.length > 0 ? value : DEFAULT_TABLE_SCHEMA_COLUMNS;
  const primaryKeySet = new Set(primaryKey.map((entry) => entry.toLowerCase()));

  return sourceColumns.map((column, index) => {
    const name =
      typeof column?.name === 'string' && column.name.trim()
        ? column.name.trim()
        : `column_${index + 1}`;
    const primary_key = column?.primary_key === true || primaryKeySet.has(name.toLowerCase());
    const nullable =
      typeof column?.nullable === 'boolean' ? column.nullable : !primary_key;
    const normalizedColumn = {
      name,
      nullable,
      primary_key,
      type:
        typeof column?.type === 'string' && column.type.trim()
          ? column.type.trim()
          : 'text'
    };

    if (typeof column?.default === 'string') {
      normalizedColumn.default = column.default;
    }

    return normalizedColumn;
  });
}

function normalizeTableSchemaTextValue(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function hasNodeConfigField(config, key) {
  return Boolean(config) && Object.prototype.hasOwnProperty.call(config, key);
}

function normalizeNodeConfigTextField(config, key, fallback) {
  const value = config?.[key];
  if (typeof value === 'string') {
    return value;
  }

  if (hasNodeConfigField(config, key)) {
    return '';
  }

  return fallback;
}

function buildTableInputSchemaOptions(activeSchema) {
  const options = [{ label: 'Select schema', value: '' }, ...TABLE_INPUT_SCHEMA_CHOICES];

  if (activeSchema && !options.some((option) => option.value === activeSchema)) {
    options.push({
      label: activeSchema,
      value: activeSchema
    });
  }

  return options;
}

function parseTableSchemaAuthoringConfigText(draftText, currentConfig = {}) {
  const parsed = JSON.parse(draftText);
  return parseTableSchemaAuthoringConfig(parsed, currentConfig);
}

function parseTableSchemaAuthoringConfig(value, currentConfig = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Schema JSON must be an object.');
  }

  if (
    hasNodeConfigField(value, 'tables') &&
    (hasNodeConfigField(value, 'table') ||
      hasNodeConfigField(value, 'schema_name') ||
      hasNodeConfigField(value, 'table_name'))
  ) {
    throw new Error(
      'Schema JSON should use either `tables`, `table`, or canonical `schema_name` / `table_name`, not a mix.'
    );
  }

  if (
    hasNodeConfigField(value, 'table') &&
    (hasNodeConfigField(value, 'schema_name') || hasNodeConfigField(value, 'table_name'))
  ) {
    throw new Error(
      'Schema JSON should use either `table` or `schema_name` / `table_name`, not both.'
    );
  }

  if (hasNodeConfigField(value, 'tables')) {
    return buildCanonicalTableSchemaConfigFromAuthoringTables(value, currentConfig);
  }

  if (hasNodeConfigField(value, 'table')) {
    return buildCanonicalTableSchemaConfigFromAuthoring(value, currentConfig);
  }

  if (hasNodeConfigField(value, 'schema_name') || hasNodeConfigField(value, 'table_name')) {
    return applyTableSchemaConfigUpdate(currentConfig, value);
  }

  throw new Error(
    'Schema JSON expects `tables`, `table`, or canonical `schema_name` and `table_name` fields.'
  );
}

function buildCanonicalTableSchemaConfigFromAuthoring(value, currentConfig = {}) {
  const table = parseTableSchemaAuthoringTableDefinition(value, 0);

  return buildCanonicalTableSchemaConfigFromDefinitions(
    [table],
    {
      catalog:
        readOptionalTableSchemaStringField(value, 'catalog') ??
        DEFAULT_TABLE_SCHEMA_CATALOG,
      currentConfig,
      open_in_catalog: parseOptionalTableSchemaBooleanField(
        value,
        'open_in_catalog',
        false
      )
    }
  );
}

function buildCanonicalTableSchemaConfigFromAuthoringTables(value, currentConfig = {}) {
  if (!Array.isArray(value.tables) || value.tables.length === 0) {
    throw new Error('Schema JSON expects `tables` to be a non-empty array.');
  }

  const tables = value.tables.map((tableConfig, index) =>
    parseTableSchemaAuthoringTableDefinition(tableConfig, index, {
      defaultCreateMode:
        readOptionalTableSchemaStringField(value, 'create_mode') ??
        DEFAULT_TABLE_SCHEMA_CREATE_MODE,
      defaultIfTargetExists:
        readOptionalTableSchemaStringField(value, 'if_target_exists') ??
        DEFAULT_TABLE_SCHEMA_IF_TARGET_EXISTS
    })
  );

  return buildCanonicalTableSchemaConfigFromDefinitions(
    tables,
    {
      catalog:
        readOptionalTableSchemaStringField(value, 'catalog') ??
        DEFAULT_TABLE_SCHEMA_CATALOG,
      currentConfig,
      open_in_catalog: parseOptionalTableSchemaBooleanField(
        value,
        'open_in_catalog',
        false
      )
    }
  );
}

function buildCanonicalTableSchemaConfigFromDefinitions(
  tables,
  { catalog, currentConfig = {}, open_in_catalog = false }
) {
  const primaryTable = tables[0];

  return {
    catalog:
      typeof catalog === 'string' && catalog.trim()
        ? catalog.trim()
        : DEFAULT_TABLE_SCHEMA_CATALOG,
    checks: primaryTable.checks,
    columns: primaryTable.columns,
    create_mode: primaryTable.create_mode,
    execution: normalizeNodeExecutionTimingConfig(currentConfig),
    if_target_exists: primaryTable.if_target_exists,
    open_in_catalog,
    output_alias: primaryTable.output_alias,
    primary_key: primaryTable.primary_key,
    schema_name: primaryTable.schema_name,
    table_name: primaryTable.table_name,
    tables
  };
}

function parseTableSchemaAuthoringTableDefinition(
  value,
  index,
  {
    defaultCreateMode = DEFAULT_TABLE_SCHEMA_CREATE_MODE,
    defaultIfTargetExists = DEFAULT_TABLE_SCHEMA_IF_TARGET_EXISTS
  } = {}
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Schema JSON table ${index + 1} must be an object.`);
  }

  if (
    hasNodeConfigField(value, 'table') &&
    (hasNodeConfigField(value, 'schema_name') || hasNodeConfigField(value, 'table_name'))
  ) {
    throw new Error(
      `Schema JSON table ${index + 1} should use either \`table\` or \`schema_name\` / \`table_name\`, not both.`
    );
  }

  const tableReference = hasNodeConfigField(value, 'table')
    ? parseTableSchemaReference(value.table)
    : parseCanonicalTableSchemaReference(
        value,
        `Schema JSON table ${index + 1}`
      );
  const columns = parseTableSchemaAuthoringColumns(value.columns, value.primary_key);

  return {
    checks: parseTableSchemaChecksForAuthoring(value.checks),
    columns,
    create_mode:
      readOptionalTableSchemaStringField(value, 'create_mode') ?? defaultCreateMode,
    if_target_exists:
      readOptionalTableSchemaStringField(value, 'if_target_exists') ??
      defaultIfTargetExists,
    output_alias:
      readOptionalTableSchemaStringField(value, 'alias') ??
      readOptionalTableSchemaStringField(value, 'output_alias') ??
      deriveTableSchemaOutputAlias(tableReference.table_name),
    primary_key: columns.filter((column) => column.primary_key).map((column) => column.name),
    schema_name: tableReference.schema_name,
    table_name: tableReference.table_name
  };
}

function parseCanonicalTableSchemaReference(value, label) {
  const schema_name = readRequiredTableSchemaStringField(value, 'schema_name', label);
  const table_name = readRequiredTableSchemaStringField(value, 'table_name', label);

  return {
    schema_name,
    table_name
  };
}

function parseTableSchemaReference(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Schema JSON expects `table` to be a non-empty table name string.');
  }

  const parts = value
    .split('.')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parts.length === 1) {
    return {
      schema_name: DEFAULT_TABLE_SCHEMA_SCHEMA,
      table_name: parts[0]
    };
  }

  if (parts.length === 2) {
    return {
      schema_name: parts[0],
      table_name: parts[1]
    };
  }

  throw new Error(
    'Schema JSON expects `table` as a table name, with optional legacy `schema.table` form.'
  );
}

function parseTableSchemaAuthoringColumns(value, primaryKeyValue) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Schema JSON expects `columns` to be a non-empty array.');
  }

  const declaredPrimaryKey = parseTableSchemaPrimaryKeyDeclaration(primaryKeyValue);
  const columns = value.map((column, index) =>
    parseTableSchemaAuthoringColumn(column, index, declaredPrimaryKey)
  );
  const seenNames = new Set();

  columns.forEach((column) => {
    const dedupeKey = column.name.toLowerCase();
    if (seenNames.has(dedupeKey)) {
      throw new Error(`Schema JSON has duplicate column name \`${column.name}\`.`);
    }
    seenNames.add(dedupeKey);
  });

  declaredPrimaryKey.forEach((columnName) => {
    if (!seenNames.has(columnName.toLowerCase())) {
      throw new Error(
        `Schema JSON primary key column \`${columnName}\` does not exist in \`columns\`.`
      );
    }
  });

  return columns;
}

function parseTableSchemaAuthoringColumn(column, index, declaredPrimaryKey) {
  if (!column || typeof column !== 'object' || Array.isArray(column)) {
    throw new Error(`Schema JSON column ${index + 1} must be an object.`);
  }

  const name = readRequiredTableSchemaStringField(column, 'name', `column ${index + 1}`);
  const type = readRequiredTableSchemaStringField(column, 'type', `column ${name}`);
  const hasRequired = hasNodeConfigField(column, 'required');
  const hasNullable = hasNodeConfigField(column, 'nullable');
  const hasPrimaryKey = hasNodeConfigField(column, 'primary_key');
  const hasPk = hasNodeConfigField(column, 'pk');

  if (hasRequired && typeof column.required !== 'boolean') {
    throw new Error(`Schema JSON column \`${name}\` expects boolean \`required\`.`);
  }

  if (hasNullable && typeof column.nullable !== 'boolean') {
    throw new Error(`Schema JSON column \`${name}\` expects boolean \`nullable\`.`);
  }

  if (
    hasRequired &&
    hasNullable &&
    column.nullable !== !column.required
  ) {
    throw new Error(
      `Schema JSON column \`${name}\` cannot mix conflicting \`required\` and \`nullable\` values.`
    );
  }

  if (hasPrimaryKey && typeof column.primary_key !== 'boolean') {
    throw new Error(`Schema JSON column \`${name}\` expects boolean \`primary_key\`.`);
  }

  if (hasPk && typeof column.pk !== 'boolean') {
    throw new Error(`Schema JSON column \`${name}\` expects boolean \`pk\`.`);
  }

  if (hasPrimaryKey && hasPk && column.primary_key !== column.pk) {
    throw new Error(
      `Schema JSON column \`${name}\` cannot mix conflicting \`primary_key\` and \`pk\` values.`
    );
  }

  const primary_key =
    (hasPk ? column.pk : hasPrimaryKey ? column.primary_key : false) ||
    declaredPrimaryKey.has(name.toLowerCase());
  const nullable = hasRequired ? !column.required : hasNullable ? column.nullable : !primary_key;

  if (primary_key && nullable) {
    throw new Error(`Schema JSON column \`${name}\` cannot be nullable and primary key.`);
  }

  const normalizedColumn = {
    name,
    nullable,
    primary_key,
    type
  };

  if (hasNodeConfigField(column, 'default')) {
    if (typeof column.default !== 'string' || !column.default.trim()) {
      throw new Error(`Schema JSON column \`${name}\` expects string \`default\` when provided.`);
    }

    normalizedColumn.default = column.default;
  }

  return normalizedColumn;
}

function parseTableSchemaPrimaryKeyDeclaration(value) {
  if (value == null) {
    return new Set();
  }

  if (!Array.isArray(value)) {
    throw new Error(
      'Schema JSON expects `primary_key` to be an array of column names when provided.'
    );
  }

  const primaryKeyColumns = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(
        `Schema JSON primary key entry ${index + 1} must be a non-empty string.`
      );
    }

    return entry.trim();
  });

  return new Set(primaryKeyColumns.map((entry) => entry.toLowerCase()));
}

function parseTableSchemaChecksForAuthoring(value) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('Schema JSON expects `checks` to be an array of strings when provided.');
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`Schema JSON check ${index + 1} must be a non-empty string.`);
    }

    return entry.trim();
  });
}

function parseOptionalTableSchemaBooleanField(source, key, fallback) {
  if (!hasNodeConfigField(source, key)) {
    return fallback;
  }

  if (typeof source[key] !== 'boolean') {
    throw new Error(`Schema JSON expects boolean \`${key}\` when provided.`);
  }

  return source[key];
}

function readOptionalTableSchemaStringField(source, key) {
  if (!hasNodeConfigField(source, key) || source[key] == null) {
    return null;
  }

  if (typeof source[key] !== 'string' || !source[key].trim()) {
    throw new Error(`Schema JSON expects non-empty string \`${key}\` when provided.`);
  }

  return source[key].trim();
}

function readRequiredTableSchemaStringField(source, key, label) {
  if (typeof source[key] !== 'string' || !source[key].trim()) {
    throw new Error(`Schema JSON ${label} expects non-empty string \`${key}\`.`);
  }

  return source[key].trim();
}

function formatTableSchemaAuthoringConfig(config) {
  const normalizedConfig = normalizeTableSchemaPanelConfig({ config });
  const formatted =
    normalizedConfig.tables.length > 1
      ? {
          ...(normalizedConfig.catalog !== DEFAULT_TABLE_SCHEMA_CATALOG
            ? { catalog: normalizedConfig.catalog }
            : {}),
          tables: normalizedConfig.tables.map((table) =>
            formatTableSchemaAuthoringTableDefinition(table)
          ),
          ...(normalizedConfig.open_in_catalog ? { open_in_catalog: true } : {})
        }
      : {
          ...formatTableSchemaAuthoringTableDefinition(normalizedConfig.tables[0]),
          ...(normalizedConfig.catalog !== DEFAULT_TABLE_SCHEMA_CATALOG
            ? { catalog: normalizedConfig.catalog }
            : {}),
          ...(normalizedConfig.open_in_catalog ? { open_in_catalog: true } : {})
        };

  return JSON.stringify(formatted, null, 2);
}

function formatTableSchemaAuthoringTableDefinition(table) {
  return {
    table: table.table_name,
    ...(table.output_alias !== table.table_name
      ? { alias: table.output_alias }
      : {}),
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      ...(!column.nullable ? { required: true } : {}),
      ...(column.primary_key ? { pk: true } : {}),
      ...(typeof column.default === 'string' ? { default: column.default } : {})
    })),
    ...(table.checks.length > 0 ? { checks: table.checks } : {}),
    ...(table.create_mode !== DEFAULT_TABLE_SCHEMA_CREATE_MODE
      ? { create_mode: table.create_mode }
      : {}),
    ...(table.if_target_exists !== DEFAULT_TABLE_SCHEMA_IF_TARGET_EXISTS
      ? { if_target_exists: table.if_target_exists }
      : {})
  };
}

function buildTableSchemaDraftFeedback(draftText, currentConfig = {}) {
  try {
    const parsedConfig = parseTableSchemaAuthoringConfigText(draftText, currentConfig);
    return {
      tone: 'success',
      message: buildTableSchemaLintSummary(parsedConfig)
    };
  } catch (error) {
    return {
      tone: 'error',
      message:
        error instanceof Error ? error.message : 'Schema JSON could not be parsed.'
    };
  }
}

function buildTableSchemaLintSummary(config) {
  const normalizedConfig = normalizeTableSchemaPanelConfig({ config });
  if (normalizedConfig.tables.length > 1) {
    const totalColumns = normalizedConfig.tables.reduce(
      (count, table) => count + table.columns.length,
      0
    );

    return `Schema JSON looks valid for ${normalizedConfig.tables.length} tables with ${totalColumns} total columns.`;
  }

  const primaryKeySummary =
    normalizedConfig.primary_key.length > 0
      ? normalizedConfig.primary_key.join(', ')
      : 'none';

  return `Schema JSON looks valid for ${normalizedConfig.table_name} with ${normalizedConfig.columns.length} column${normalizedConfig.columns.length === 1 ? '' : 's'}; primary key: ${primaryKeySummary}.`;
}

function buildTableSchemaFeedbackTarget(config) {
  const normalizedConfig = normalizeTableSchemaPanelConfig({ config });

  if (normalizedConfig.tables.length === 1) {
    return normalizedConfig.table_name;
  }

  return `${normalizedConfig.tables.length} tables`;
}

function buildTableSchemaColumnDefinition(column) {
  const parts = [column.type];

  if (!column.nullable) {
    parts.push('NOT NULL');
  }

  if (column.primary_key) {
    parts.push('PK');
  }

  if (typeof column.default === 'string') {
    parts.push(`DEFAULT ${column.default}`);
  }

  return parts.join(' · ');
}

function buildTableSchemaResultShapeGroups(config) {
  return config.tables.map((table) => ({
    columns: table.columns.map((column) => ({
      definition: buildTableSchemaColumnDefinition(column),
      name: column.name
    })),
    name: table.table_name
  }));
}

function deriveTableSchemaOutputAlias(tableName) {
  const normalized =
    typeof tableName === 'string' && tableName.trim()
      ? tableName.trim()
      : DEFAULT_TABLE_SCHEMA_OUTPUT_ALIAS;

  return normalized || DEFAULT_TABLE_SCHEMA_OUTPUT_ALIAS;
}

function dedupeTableSchemaNames(entries) {
  const seen = new Set();
  const deduped = [];

  entries.forEach((entry) => {
    const normalizedKey = entry.toLowerCase();
    if (seen.has(normalizedKey)) {
      return;
    }

    seen.add(normalizedKey);
    deduped.push(entry);
  });

  return deduped;
}

function buildTableInputTableOptions(activeSchema, activeTableName) {
  const baseOptionsBySchema = {
    outputs: ['node_outputs'],
    runs: ['workflow_runs', 'node_runs', 'table_output_materializations'],
    staging: ['raw_imports'],
    tables: ['daily_digest']
  };
  const baseOptions = baseOptionsBySchema[activeSchema] ?? [];
  const options = [{ label: 'Select table', value: '' }, ...baseOptions.map((value) => ({
    label: value,
    value
  }))];

  if (activeTableName && !options.some((option) => option.value === activeTableName)) {
    options.push({
      label: activeTableName,
      value: activeTableName
    });
  }

  return options;
}

function buildTableInputQueryPreview(config) {
  const selectedColumns = config.selected_columns.length
    ? config.selected_columns.join(', ')
    : '*';
  const lines = [
    {
      label: 'projection',
      text: `SELECT ${selectedColumns}`
    },
    {
      label: 'source',
      text: `FROM ${resolveTableInputDisplayValue(config.schema_name, DEFAULT_TABLE_INPUT_SCHEMA, '[select schema]')}.${resolveTableInputDisplayValue(config.table_name, DEFAULT_TABLE_INPUT_TABLE_NAME, '[select table]')}`
    }
  ];

  if (config.row_filter.trim()) {
    lines.push({
      label: 'filter',
      text: `WHERE ${config.row_filter.trim()}`
    });
  }

  if (config.row_limit !== null) {
    lines.push({
      label: 'limit',
      text: `LIMIT ${config.row_limit}`
    });
  }

  return lines;
}

function resolveTableInputDisplayValue(value, fallback, emptyLabel = fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || emptyLabel;
}

function buildTableOutputSchemaOptions(activeSchema) {
  const options = [{ label: 'Select schema', value: '' }, ...TABLE_OUTPUT_SCHEMA_CHOICES];

  if (
    activeSchema &&
    !options.some((option) => option.value === activeSchema)
  ) {
    options.push({
      label: activeSchema,
      value: activeSchema
    });
  }

  return options;
}

function buildLoadToDuckDbSchemaOptions(activeSchema) {
  const options = [{ label: 'Select schema', value: '' }, ...LOAD_TO_DUCKDB_SCHEMA_CHOICES];

  if (activeSchema && !options.some((option) => option.value === activeSchema)) {
    options.push({
      label: activeSchema,
      value: activeSchema
    });
  }

  return options;
}

function buildSqlTransformSchemaOptions(activeSchema) {
  const options = [{ label: 'Select schema', value: '' }, ...SQL_TRANSFORM_SCHEMA_CHOICES];

  if (activeSchema && !options.some((option) => option.value === activeSchema)) {
    options.push({
      label: activeSchema,
      value: activeSchema
    });
  }

  return options;
}

function buildTableMergeSchemaOptions(activeSchema) {
  const options = [{ label: 'Select schema', value: '' }, ...TABLE_MERGE_SCHEMA_CHOICES];

  if (activeSchema && !options.some((option) => option.value === activeSchema)) {
    options.push({
      label: activeSchema,
      value: activeSchema
    });
  }

  return options;
}

function buildTableOutputResultShape(config, workflow = null, nodeId = null) {
  if (config?.input_shape === 'table_schema') {
    const groups = buildTableOutputResultShapeGroups(config, workflow, nodeId);

    return groups.length > 0
      ? groups[0].columns.map((column) => ({
          name: column.name,
          type: column.definition
        }))
      : [
          {
            name: 'declared tables',
            type: 'schema bootstrap'
          }
        ];
  }

  if (config?.input_shape === 'source_table') {
    return [
      {
        name: 'source columns',
        type: 'table copy'
      },
      ...(config?.include_run_id
        ? [
            {
              name: 'run_id',
              type: 'varchar'
            }
          ]
        : []),
      ...(config?.include_written_at
        ? [
            {
              name: 'written_at',
              type: 'timestamp'
            }
          ]
        : [])
    ];
  }

  const columns = [
    {
      name: resolveTableOutputDisplayValue(
        config?.value_column,
        DEFAULT_TABLE_OUTPUT_VALUE_COLUMN
      ),
      type: 'text'
    }
  ];

  if (config?.include_run_id) {
    columns.push({
      name: 'run_id',
      type: 'varchar'
    });
  }

  if (config?.include_written_at) {
    columns.push({
      name: 'written_at',
      type: 'timestamp'
    });
  }

  return columns;
}

function buildTableOutputResultShapeGroups(config, workflow = null, nodeId = null) {
  if (config?.input_shape !== 'table_schema') {
    return [];
  }

  const schemaTables = resolveConnectedTableSchemaDefinitions(workflow, nodeId);
  const fallbackTables = schemaTables.length > 0
    ? schemaTables
    : [
        {
          checks: [],
          columns: [],
          create_mode: DEFAULT_TABLE_SCHEMA_CREATE_MODE,
          if_target_exists: DEFAULT_TABLE_SCHEMA_IF_TARGET_EXISTS,
          output_alias: 'declared tables',
          primary_key: [],
          schema_name: resolveTableOutputDisplayValue(
            config?.target_schema,
            DEFAULT_TABLE_OUTPUT_SCHEMA
          ),
          table_name: 'declared tables'
        }
      ];

  return fallbackTables.map((table) => {
    const schemaColumns = table.columns.map((column) => ({
      definition: buildTableSchemaColumnDefinition(column),
      name: column.name
    }));
    const nextColumns = [...schemaColumns];

    if (!nextColumns.some((column) => column.name === 'run_id') && config?.include_run_id) {
      nextColumns.push({
        definition: 'varchar',
        name: 'run_id'
      });
    }

    if (
      !nextColumns.some((column) => column.name === 'written_at') &&
      config?.include_written_at
    ) {
      nextColumns.push({
        definition: 'varchar',
        name: 'written_at'
      });
    }

    return {
      columns: nextColumns,
      name: `${resolveTableOutputDisplayValue(
        config?.target_schema,
        DEFAULT_TABLE_OUTPUT_SCHEMA
      )}.${table.table_name}`
    };
  });
}

function buildTableOutputSchemaBootstrapDestinationLabel(
  config,
  workflow = null,
  nodeId = null
) {
  const groups = buildTableOutputResultShapeGroups(config, workflow, nodeId);
  if (!groups.length) {
    return `${resolveTableOutputDisplayValue(
      config?.target_schema,
      DEFAULT_TABLE_OUTPUT_SCHEMA
    )} (awaiting tables)`;
  }

  if (groups.length === 1) {
    return groups[0].name;
  }

  return `${resolveTableOutputDisplayValue(
    config?.target_schema,
    DEFAULT_TABLE_OUTPUT_SCHEMA
  )} (${groups.length} tables)`;
}

function resolveConnectedTableSchemaDefinitions(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return [];
  }

  const inputEdge = workflow.edges.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'text'
  );
  if (!inputEdge) {
    return [];
  }

  const sourceNode = workflow.nodes.find((node) => node.node_id === inputEdge.source_node_id);
  if (sourceNode?.type_id !== 'table_schema') {
    return [];
  }

  return normalizeTableSchemaPanelConfig({ config: sourceNode.config ?? {} }).tables;
}

function resolveTableOutputDisplayValue(value, fallback, emptyLabel = fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || emptyLabel;
}

function hasInputConnection(workflow, nodeId, portId) {
  if (!workflow || !nodeId || !portId) {
    return false;
  }

  return workflow.edges.some(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === portId
  );
}

function workflowSyncStateLabel(syncState) {
  switch (syncState) {
    case 'saving':
      return 'Saving…';
    case 'synced':
      return 'Saved to workflow';
    case 'offline':
      return 'Save unavailable';
    case 'loading':
      return 'Loading workflow…';
    default:
      return 'Local draft';
  }
}

function appendCanvasNode(workflow, typeId, options = {}) {
  const { position = null, selectedNodeId = null } = options;

  if (!['text_input', 'dolt_repo_source', 'checkpoint_read', 'checkpoint_write', 'quality_check', 'dolt_repo_sync', 'dolt_change_manifest', 'dolt_dump', 'dolt_diff_export', 'load_to_duckdb', 'sql_transform', 'table_merge', 'table_input', 'table_schema', 'table_output', 'send_email'].includes(typeId)) {
    return null;
  }

  const nextWorkflow = cloneWorkflow(workflow);
  const selectedNode =
    nextWorkflow.nodes.find((node) => node.node_id === selectedNodeId) ??
    nextWorkflow.nodes[nextWorkflow.nodes.length - 1] ??
    null;
  const nextNodeId = nextWorkflow.nodes.some((node) => node.node_id === typeId)
    ? `${typeId}_${nextWorkflow.nodes.filter((node) => node.type_id === typeId).length + 1}`
    : typeId;

  const nextNode = {
    node_id: nextNodeId,
    type_id: typeId,
    definition_version: 1,
    label:
      typeId === 'text_input'
        ? 'Text Input'
        : typeId === 'dolt_repo_source'
          ? 'Dolt Repo Source'
        : typeId === 'checkpoint_read'
          ? 'Checkpoint Read'
        : typeId === 'checkpoint_write'
          ? 'Checkpoint Write'
        : typeId === 'quality_check'
          ? 'Quality Check'
        : typeId === 'dolt_repo_sync'
          ? 'Dolt Repo Sync'
        : typeId === 'dolt_change_manifest'
          ? 'Dolt Change Manifest'
        : typeId === 'dolt_dump'
          ? 'Dolt Dump'
        : typeId === 'dolt_diff_export'
          ? 'Dolt Diff Export'
        : typeId === 'load_to_duckdb'
          ? 'Load to DuckDB'
        : typeId === 'sql_transform'
          ? 'SQL Transform'
        : typeId === 'table_merge'
          ? 'Table Merge'
        : typeId === 'table_input'
          ? 'Table Input'
        : typeId === 'table_schema'
          ? 'Table Schema'
        : typeId === 'table_output'
          ? 'Table Output'
          : 'Send Email',
    config:
      typeId === 'text_input'
        ? {
            execution: {
              wait_after_seconds: 0,
              wait_before_seconds: 0
            },
            include_line_breaks: true,
            preserve_whitespace: true,
            text: 'Draft the next message body here.',
            trim_mode: 'automatic'
          }
        : typeId === 'dolt_repo_source'
          ? {
              branch: DEFAULT_DOLT_REPO_SOURCE_BRANCH,
              checkout_ref: '',
              clone_mode: DEFAULT_DOLT_REPO_SOURCE_CLONE_MODE,
              connection_ref: DEFAULT_DOLT_REPO_SOURCE_CONNECTION_REF,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              repository: DEFAULT_DOLT_REPO_SOURCE_REPOSITORY,
              sync_strategy: DEFAULT_DOLT_REPO_SOURCE_SYNC_STRATEGY
            }
        : typeId === 'checkpoint_read'
          ? {
              branch: DEFAULT_CHECKPOINT_READ_BRANCH,
              checkpoint_table: DEFAULT_CHECKPOINT_READ_TABLE,
              emit_bootstrap_marker_if_missing:
                DEFAULT_CHECKPOINT_READ_EMIT_BOOTSTRAP_MARKER_IF_MISSING,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              fail_on_stale_checkpoint: DEFAULT_CHECKPOINT_READ_FAIL_ON_STALE_CHECKPOINT,
              source_repo: DEFAULT_CHECKPOINT_READ_SOURCE_REPO
            }
        : typeId === 'checkpoint_write'
          ? {
              advance_on_partial_success:
                DEFAULT_CHECKPOINT_WRITE_ADVANCE_ON_PARTIAL_SUCCESS,
              checkpoint_table: DEFAULT_CHECKPOINT_WRITE_TABLE,
              commit_source: DEFAULT_CHECKPOINT_WRITE_COMMIT_SOURCE,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              only_persist_on_full_success:
                DEFAULT_CHECKPOINT_WRITE_ONLY_PERSIST_ON_FULL_SUCCESS,
              write_timing: DEFAULT_CHECKPOINT_WRITE_TIMING
            }
        : typeId === 'quality_check'
          ? {
              allow_warning_only_runs_to_continue:
                DEFAULT_QUALITY_CHECK_ALLOW_WARNING_ONLY_RUNS_TO_CONTINUE,
              block_checkpoint_write_on_failure:
                DEFAULT_QUALITY_CHECK_BLOCK_CHECKPOINT_WRITE_ON_FAILURE,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              null_key_policy: DEFAULT_QUALITY_CHECK_NULL_KEY_POLICY,
              schema_drift_rule: DEFAULT_QUALITY_CHECK_SCHEMA_DRIFT_RULE,
              suite_preset: DEFAULT_QUALITY_CHECK_SUITE_PRESET,
              warning_budget: DEFAULT_QUALITY_CHECK_WARNING_BUDGET
            }
        : typeId === 'dolt_repo_sync'
          ? {
              branch_guard: DEFAULT_DOLT_REPO_SYNC_BRANCH_GUARD,
              dirty_working_copy_policy: DEFAULT_DOLT_REPO_SYNC_DIRTY_WORKING_COPY_POLICY,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              no_change_behavior: DEFAULT_DOLT_REPO_SYNC_NO_CHANGE_BEHAVIOR,
              sync_action: DEFAULT_DOLT_REPO_SYNC_ACTION
            }
        : typeId === 'dolt_change_manifest'
          ? {
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              schema_change_policy: DEFAULT_DOLT_CHANGE_MANIFEST_SCHEMA_CHANGE_POLICY,
              selected_tables: [],
              table_scope: DEFAULT_DOLT_CHANGE_MANIFEST_TABLE_SCOPE
            }
        : typeId === 'dolt_dump'
          ? {
              artifact_retention: DEFAULT_DOLT_DUMP_ARTIFACT_RETENTION,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              output_directory_policy: DEFAULT_DOLT_DUMP_OUTPUT_DIRECTORY_POLICY,
              output_format: DEFAULT_DOLT_DUMP_OUTPUT_FORMAT,
              selected_tables: [],
              table_selection_mode: DEFAULT_DOLT_DUMP_TABLE_SELECTION_MODE
            }
        : typeId === 'dolt_diff_export'
          ? {
              change_filter: DEFAULT_DOLT_DIFF_EXPORT_CHANGE_FILTER,
              deleted_row_handling: DEFAULT_DOLT_DIFF_EXPORT_DELETED_ROW_HANDLING,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              output_format: DEFAULT_DOLT_DIFF_EXPORT_OUTPUT_FORMAT
            }
        : typeId === 'load_to_duckdb'
          ? {
              delta_context_preservation:
                DEFAULT_LOAD_TO_DUCKDB_DELTA_CONTEXT_PRESERVATION,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              schema_handling: DEFAULT_LOAD_TO_DUCKDB_SCHEMA_HANDLING,
              table_mapping: DEFAULT_LOAD_TO_DUCKDB_TABLE_MAPPING,
              target_schema: DEFAULT_LOAD_TO_DUCKDB_TARGET_SCHEMA
            }
        : typeId === 'sql_transform'
          ? {
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              materialization_mode: DEFAULT_SQL_TRANSFORM_MATERIALIZATION_MODE,
              output_table_name: DEFAULT_SQL_TRANSFORM_OUTPUT_TABLE_NAME,
              source_table_name: '',
              sql_text: DEFAULT_SQL_TRANSFORM_SQL_TEXT,
              target_schema: DEFAULT_SQL_TRANSFORM_TARGET_SCHEMA
            }
        : typeId === 'table_merge'
          ? {
              delete_handling: DEFAULT_TABLE_MERGE_DELETE_HANDLING,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              merge_key_columns: [...DEFAULT_TABLE_MERGE_KEY_COLUMNS],
              schema_drift_behavior: DEFAULT_TABLE_MERGE_SCHEMA_DRIFT_BEHAVIOR,
              target_schema: DEFAULT_TABLE_MERGE_TARGET_SCHEMA,
              write_policy: DEFAULT_TABLE_MERGE_WRITE_POLICY
            }
        : typeId === 'table_input'
          ? {
              catalog: DEFAULT_TABLE_INPUT_CATALOG,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              open_in_catalog: false,
              output_alias: DEFAULT_TABLE_INPUT_OUTPUT_ALIAS,
              refresh_schema: true,
              row_filter: '',
              row_limit: null,
              schema_name: DEFAULT_TABLE_INPUT_SCHEMA,
              selected_columns: [],
              table_name: DEFAULT_TABLE_INPUT_TABLE_NAME
            }
        : typeId === 'table_schema'
          ? {
              catalog: DEFAULT_TABLE_SCHEMA_CATALOG,
              checks: [],
              columns: DEFAULT_TABLE_SCHEMA_COLUMNS.map((column) => ({ ...column })),
              create_mode: DEFAULT_TABLE_SCHEMA_CREATE_MODE,
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              if_target_exists: DEFAULT_TABLE_SCHEMA_IF_TARGET_EXISTS,
              open_in_catalog: false,
              output_alias: DEFAULT_TABLE_SCHEMA_OUTPUT_ALIAS,
              primary_key: ['order_id'],
              schema_name: DEFAULT_TABLE_SCHEMA_SCHEMA,
              table_name: DEFAULT_TABLE_SCHEMA_TABLE_NAME,
              tables: [
                {
                  checks: [],
                  columns: DEFAULT_TABLE_SCHEMA_COLUMNS.map((column) => ({ ...column })),
                  create_mode: DEFAULT_TABLE_SCHEMA_CREATE_MODE,
                  if_target_exists: DEFAULT_TABLE_SCHEMA_IF_TARGET_EXISTS,
                  output_alias: DEFAULT_TABLE_SCHEMA_OUTPUT_ALIAS,
                  primary_key: ['order_id'],
                  schema_name: DEFAULT_TABLE_SCHEMA_SCHEMA,
                  table_name: DEFAULT_TABLE_SCHEMA_TABLE_NAME
                }
              ]
            }
        : typeId === 'table_output'
          ? {
              execution: {
                wait_after_seconds: 0,
                wait_before_seconds: 0
              },
              include_run_id: true,
              include_written_at: true,
              input_shape: DEFAULT_TABLE_OUTPUT_INPUT_SHAPE,
              open_in_catalog: false,
              table_name: DEFAULT_TABLE_OUTPUT_TABLE_NAME,
              target_schema: DEFAULT_TABLE_OUTPUT_SCHEMA,
              value_column: DEFAULT_TABLE_OUTPUT_VALUE_COLUMN,
              write_mode: DEFAULT_TABLE_OUTPUT_WRITE_MODE
            }
        : {
            body: '',
            body_mode: 'input',
            body_text: '',
            connection_id: 'default_mailer',
            content_type: 'text/plain',
            execution: {
              wait_after_seconds: 0,
              wait_before_seconds: 0
            },
            to: 'ops@stitchly.dev',
            subject: 'New workflow alert'
          },
    position:
      position != null
        ? {
            x: Math.max(80, Math.round(position.x)),
            y: Math.max(80, Math.round(position.y))
          }
        : {
            x: Math.max(
              80,
              selectedNode?.position?.x != null
                  ? selectedNode.position.x + (typeId === 'text_input' ? -380 : 380)
                : typeId === 'send_email' || typeId === 'table_output'
                  ? 520
                : typeId === 'dolt_repo_source' || typeId === 'checkpoint_read' || typeId === 'checkpoint_write' || typeId === 'quality_check' || typeId === 'dolt_repo_sync' || typeId === 'dolt_change_manifest' || typeId === 'dolt_dump' || typeId === 'dolt_diff_export' || typeId === 'load_to_duckdb' || typeId === 'sql_transform' || typeId === 'table_merge' || typeId === 'table_input' || typeId === 'table_schema'
                    ? 160
                  : 120
            ),
            y: selectedNode?.position?.y ?? 180
          }
  };

  nextWorkflow.nodes.push(nextNode);

  return {
    selectedNodeId: nextNode.node_id,
    workflow: nextWorkflow
  };
}

function buildCanvasStarterWorkflow() {
  return prepareCanvasWorkflow(cloneWorkflow(starterWorkflowFixture));
}

function normalizeCanvasWorkflow(workflow) {
  if (
    !workflow ||
    typeof workflow !== 'object' ||
    !Array.isArray(workflow.nodes) ||
    !Array.isArray(workflow.edges)
  ) {
    return buildCanvasStarterWorkflow();
  }

  return normalizeKnownCanvasWorkflowConfigs(
    prepareCanvasWorkflow(cloneWorkflow(workflow))
  );
}

function normalizeKnownCanvasWorkflowConfigs(workflow) {
  if (!workflow || !Array.isArray(workflow.nodes)) {
    return workflow;
  }

  let changed = false;
  const nextNodes = workflow.nodes.map((node) => {
    if (node?.type_id !== 'table_merge') {
      return node;
    }

    const sourceContext = resolveConnectedLoadToDuckDbPanelContextFromTableNode(
      workflow,
      node.node_id
    );
    if (sourceContext?.repository !== 'post-no-preference/rates') {
      return node;
    }

    const mergeKeyColumns = normalizeTableMergeKeyColumns(
      node?.config?.merge_key_columns_text ?? node?.config?.merge_key_columns
    );
    if (
      mergeKeyColumns.length === 1 &&
      mergeKeyColumns[0].toLowerCase() === 'date'
    ) {
      changed = true;
      return {
        ...node,
        config: {
          ...(node.config ?? {}),
          merge_key_columns: [...DEFAULT_RATES_TABLE_MERGE_KEY_COLUMNS],
          merge_key_columns_text: DEFAULT_RATES_TABLE_MERGE_KEY_COLUMNS.join(', ')
        }
      };
    }

    return node;
  });

  return changed ? { ...workflow, nodes: nextNodes } : workflow;
}

function extractCanvasWorkflowDefinition(response) {
  if (response?.definition) {
    return normalizeCanvasWorkflow(response.definition);
  }

  if (response?.workflow) {
    const fallbackWorkflow = buildCanvasStarterWorkflow();
    return normalizeCanvasWorkflow({
      ...fallbackWorkflow,
      workflow_id: response.workflow.workflow_id ?? fallbackWorkflow.workflow_id,
      name: response.workflow.name ?? fallbackWorkflow.name,
      description: response.workflow.description ?? fallbackWorkflow.description,
      version: response.workflow.version ?? fallbackWorkflow.version
    });
  }

  return buildCanvasStarterWorkflow();
}

function resolveCanvasWorkflowId(response, workflow) {
  return response?.workflow?.workflow_id ?? workflow?.workflow_id ?? starterWorkflowFixture.workflow_id;
}

function prepareCanvasWorkflow(workflow) {
  if (workflow?.workflow_id !== starterWorkflowFixture.workflow_id) {
    return workflow;
  }

  const hasSendEmailNode = workflow.nodes.some((node) => node.type_id === 'send_email');

  if (!hasSendEmailNode) {
    return cloneWorkflow(starterWorkflowFixture);
  }

  return ensureStarterEmailDraftFlow(workflow);
}

function ensureStarterEmailDraftFlow(workflow) {
  const nextWorkflow = cloneWorkflow(workflow);
  const sendEmailNode = nextWorkflow.nodes.find((node) => node.type_id === 'send_email') ?? null;
  const starterTextNode =
    starterWorkflowFixture.nodes.find((node) => node.type_id === 'text_input') ?? null;

  if (!starterTextNode || !sendEmailNode) {
    return nextWorkflow;
  }

  let textInputNode = nextWorkflow.nodes.find((node) => node.type_id === 'text_input') ?? null;

  if (!textInputNode) {
    textInputNode = {
      ...starterTextNode,
      position: {
        x: Math.max(80, (sendEmailNode.position?.x ?? starterTextNode.position.x) - 400),
        y: sendEmailNode.position?.y ?? starterTextNode.position.y
      }
    };

    nextWorkflow.nodes = [textInputNode, ...nextWorkflow.nodes];
  }

  const hasBodyEdge = nextWorkflow.edges.some(
    (edge) =>
      edge.source_node_id === textInputNode.node_id &&
      edge.source_port_id === 'text' &&
      edge.target_node_id === sendEmailNode.node_id &&
      edge.target_port_id === 'body'
  );

  if (!hasBodyEdge) {
    nextWorkflow.edges = [
      ...nextWorkflow.edges,
      {
        edge_id: `edge_${textInputNode.node_id}_text_to_${sendEmailNode.node_id}_body`,
        source_node_id: textInputNode.node_id,
        source_port_id: 'text',
        target_node_id: sendEmailNode.node_id,
        target_port_id: 'body'
      }
    ];
  }

  return nextWorkflow;
}

function readStoredCanvasDebugCollapsed() {
  if (typeof window === 'undefined') {
    return false;
  }

  const stored = window.localStorage.getItem(CANVAS_DEBUG_COLLAPSE_STORAGE_KEY);
  return stored ? JSON.parse(stored) === true : false;
}
