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
import { cloneWorkflow, updateNodeConfig, updateNodeLabel } from '../lib/workflow';

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
  const [workflow, setWorkflow] = useState(() => cloneWorkflow(starterWorkflowFixture));
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
  const [configDraft, setConfigDraft] = useState('{}');
  const [configError, setConfigError] = useState('');
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

  const selectedNode = workflow.nodes.find((node) => node.node_id === selectedNodeId) ?? null;
  const selectedDefinition = nodeDefinitions.find((definition) => definition.type_id === selectedNode?.type_id) ?? null;
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
    if (!selectedNode) {
      setConfigDraft('{}');
      setConfigError('');
      return;
    }

    setConfigDraft(JSON.stringify(selectedNode.config, null, 2));
    setConfigError('');
  }, [selectedNode]);

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
                buildCanvasStarterWorkflow()
              );
            }
          }
        }

        if (cancelled) {
          return;
        }

        const persistedWorkflow = cloneWorkflow(workflowResponse.definition);
        const nextWorkflow = prepareCanvasWorkflow(persistedWorkflow);
        const resolvedWorkflowId = workflowResponse.workflow.workflow_id;
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

        const persistedWorkflow = cloneWorkflow(workflowResponse.definition);
        const nextWorkflow = prepareCanvasWorkflow(persistedWorkflow);
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
          workflow
        );

        if (cancelled) {
          return;
        }

        const nextWorkflow = cloneWorkflow(workflowResponse.definition);
        persistedWorkflowSignatureRef.current = workflowSignature(nextWorkflow);
        setActiveWorkflowId(workflowResponse.workflow.workflow_id);
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
      const response = await validateWorkflow(workflow);
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
      const response = workspaceId
        ? await createWorkspaceRun(workspaceId, workflow)
        : await createRun(workflow);
      const seededRun = {
        run_id: response.run_id,
        workflow_id: workflow.workflow_id,
        workflow_version: workflow.version,
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

  function handleApplyConfig() {
    if (!selectedNode) {
      return;
    }

    try {
      const parsed = JSON.parse(configDraft);
      applyWorkflowChange(updateNodeConfig(workflow, selectedNode.node_id, parsed));
      setConfigError('');
    } catch (error) {
      setConfigError(error.message);
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
      setFloatingCard(selectedNodeId ? { type: 'node-inspector', nodeId: selectedNodeId } : null);
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

  function openNodeInspector(nodeId) {
    setSelectedNodeId(nodeId);
    setActiveSection('nodes');
    setDrawerOpen(true);
    setFloatingCard({ type: 'node-inspector', nodeId });
  }

  function handleCanvasSelection(nodeId) {
    if (!nodeId) {
      setSelectedNodeId(null);
      if (floatingCard?.type === 'node-inspector') {
        setFloatingCard(null);
      }
      return;
    }

    setSelectedNodeId(nodeId);

    if (floatingCard?.type === 'node-inspector') {
      setFloatingCard({ type: 'node-inspector', nodeId });
    }
  }

  function handleCanvasNodeOpen(nodeId) {
    if (!nodeId) {
      return;
    }

    openNodeInspector(nodeId);
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
      openNodeInspector(result.nodeId);
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
    if (floatingCard?.type === 'node-inspector') {
      setSelectedNodeId(null);
    }

    setFloatingCard(null);
  }

  function focusProblemTarget(problem) {
    if (problem?.target?.nodeId) {
      openNodeInspector(problem.target.nodeId);
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
        onNodeOpen={handleCanvasNodeOpen}
        onSelectionChange={handleCanvasSelection}
        onViewportActionsReady={setCanvasViewportActions}
        onViewportChange={setCanvasViewport}
        onWorkflowChange={applyWorkflowChange}
        selectedNodeId={selectedNodeId}
        workflow={workflow}
      />

      {selectedNode && !floatingCard ? (
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
              {floatingCard.type === 'node-inspector' ? (
                <div className="card-stack">
                  <CardMetricGrid
                    metrics={[
                      { label: 'Node', value: selectedNode?.node_id ?? 'None' },
                      { label: 'Type', value: selectedDefinition?.display_name ?? 'Unknown' },
                      { label: 'Category', value: humanizeToken(selectedDefinition?.category) },
                      { label: 'Ports', value: `${selectedDefinition?.inputs?.length ?? 0}/${selectedDefinition?.outputs?.length ?? 0}` }
                    ]}
                  />

                  <label className="shell-field">
                    <span>Label</span>
                    <input
                      value={selectedNode?.label ?? ''}
                      onChange={(event) => {
                        if (!selectedNode) {
                          return;
                        }

                        applyWorkflowChange(
                          updateNodeLabel(workflow, selectedNode.node_id, event.target.value)
                        );
                      }}
                    />
                  </label>

                  <label className="shell-field">
                    <span>Config JSON</span>
                    <textarea
                      rows={9}
                      value={configDraft}
                      onChange={(event) => setConfigDraft(event.target.value)}
                    />
                  </label>

                  {configError ? <p className="shell-error-text">{configError}</p> : null}

                  <div className="drawer-action-grid">
                    <button className="accent-button" onClick={handleApplyConfig} type="button">
                      Apply Config
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setConfigDraft(JSON.stringify(selectedNode?.config ?? {}, null, 2))}
                      type="button"
                    >
                      Reset Draft
                    </button>
                  </div>
                </div>
              ) : null}

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
                            onClick={() => openNodeInspector(nodeRun.node_id)}
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
                      Open Node Inspector
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

  if (node?.type_id === 'table_output') {
    return (
      <CanvasTableOutputManagementPanel
        definition={definition}
        node={node}
        onNodeConfigChange={onNodeConfigChange}
        onNodeLabelChange={onNodeLabelChange}
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
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-send-email-body-mode"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applySendEmailConfigUpdate(currentConfig, {
                    body_mode: event.target.value
                  })
                )
              }
              value={config.body_mode}
            >
              <option value="input">From input</option>
              <option value="custom">Custom text</option>
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
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
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-send-email-connection"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applySendEmailConfigUpdate(currentConfig, {
                    connection_id: event.target.value
                  })
                )
              }
              value={config.connection_id}
            >
              {connectionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
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
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-text-input-trim-mode"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTextInputConfigUpdate(currentConfig, {
                    trim_mode: event.target.value
                  })
                )
              }
              value={config.trim_mode}
            >
              <option value="automatic">Automatic</option>
              <option value="trim">Trim edges</option>
              <option value="exact">Keep exact</option>
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
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
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-table-input-schema"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableInputConfigUpdate(currentConfig, {
                    schema_name: event.target.value
                  })
                )
              }
              value={config.schema_name}
            >
              {schemaOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-input-table">Source table</label>
          </div>
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-table-input-table"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableInputConfigUpdate(currentConfig, {
                    table_name: event.target.value
                  })
                )
              }
              value={config.table_name}
            >
              {tableOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
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
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-table-input-row-limit"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableInputConfigUpdate(currentConfig, {
                    row_limit: event.target.value
                  })
                )
              }
              value={rowLimitValue}
            >
              <option value="none">No limit</option>
              <option value="100">100 rows</option>
              <option value="1000">1000 rows</option>
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
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

function CanvasTableOutputManagementPanel({
  definition,
  node,
  onNodeConfigChange,
  onNodeLabelChange,
  workflowSyncState = 'local'
}) {
  const config = normalizeTableOutputPanelConfig(node);
  const schemaOptions = buildTableOutputSchemaOptions(config.target_schema);
  const resultShape = buildTableOutputResultShape(config);
  const destination = `${resolveTableOutputDisplayValue(config.target_schema, 'outputs', '[select schema]')}.${resolveTableOutputDisplayValue(config.table_name, 'news_brief', '[select table]')}`;

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
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-table-output-schema"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableOutputConfigUpdate(currentConfig, {
                    target_schema: event.target.value
                  })
                )
              }
              value={config.target_schema}
            >
              {schemaOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
        </div>

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

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-output-mode">Write mode</label>
            <span className="canvas-node-panel__hint" aria-hidden="true">
              i
            </span>
          </div>
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-table-output-mode"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableOutputConfigUpdate(currentConfig, {
                    write_mode: event.target.value
                  })
                )
              }
              value={config.write_mode}
            >
              <option value="append">Append rows</option>
              <option value="replace">Replace table</option>
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
        </div>

        <div className="canvas-node-panel__field">
          <div className="canvas-node-panel__field-head">
            <label htmlFor="canvas-table-output-shape">Input shape</label>
          </div>
          <div className="canvas-node-panel__select-wrap">
            <select
              id="canvas-table-output-shape"
              className="canvas-node-panel__select"
              onChange={(event) =>
                onNodeConfigChange?.((currentConfig) =>
                  applyTableOutputConfigUpdate(currentConfig, {
                    input_shape: event.target.value
                  })
                )
              }
              value={config.input_shape}
            >
              <option value="single_text_row">Single text row</option>
              <option value="source_table">Source table</option>
            </select>
            <span className="canvas-node-panel__caret" aria-hidden="true">
              ⌄
            </span>
          </div>
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
          <strong>{config.input_shape === 'source_table' ? 'Table copy' : '1 row'}</strong>
        </div>

        <div className="canvas-node-panel__footer-row">
          <span>Destination</span>
          <strong>{destination}</strong>
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
  if (type === 'node-inspector') {
    return 'Node Inspector';
  }

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

function cardTitleFor({ floatingCard, activeProblem, activeRun, selectedNode }) {
  if (floatingCard.type === 'node-inspector') {
    return selectedNode?.label ?? selectedNode?.node_id ?? 'Node';
  }

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
    icon: nodeTypeId === 'send_email' ? '@' : 'T',
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
const DEFAULT_TABLE_INPUT_CATALOG = 'workflow.duckdb';
const DEFAULT_TABLE_INPUT_SCHEMA = 'runs';
const DEFAULT_TABLE_INPUT_TABLE_NAME = 'workflow_runs';
const DEFAULT_TABLE_INPUT_OUTPUT_ALIAS = 'workflow_runs';
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

function normalizeTableOutputPanelConfig(node) {
  const config = node?.config ?? {};

  return {
    execution: normalizeNodeExecutionTimingConfig(config),
    include_run_id:
      typeof config.include_run_id === 'boolean' ? config.include_run_id : true,
    include_written_at:
      typeof config.include_written_at === 'boolean' ? config.include_written_at : true,
    input_shape:
      config.input_shape === 'single_text_row' || config.input_shape === 'source_table'
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
      next.input_shape === 'single_text_row' || next.input_shape === 'source_table'
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

function buildTableOutputResultShape(config) {
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

  if (!['text_input', 'table_input', 'table_output', 'send_email'].includes(typeId)) {
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
        : typeId === 'table_input'
          ? 'Table Input'
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
                  : typeId === 'table_input'
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
