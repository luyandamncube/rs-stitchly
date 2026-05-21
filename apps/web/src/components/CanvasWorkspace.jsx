import { startTransition, useEffect, useRef, useState, useDeferredValue } from 'react';
import starterWorkflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import connectionFixture from '../../../../tests/fixtures/api/connections.json';
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import WorkflowCanvas from './WorkflowCanvas';
import { createRun, getConnections, getNodeDefinitions, getRunSnapshot, subscribeToRun, validateWorkflow } from '../lib/api';
import {
  buildProblemItems,
  buildSearchResults,
  groupNodeDefinitions,
  humanizeToken,
  SHELL_SECTIONS
} from '../lib/shell';
import { cloneWorkflow, updateNodeConfig, updateNodeLabel } from '../lib/workflow';

const DEFAULT_SANDBOX_STATE = {
  connection: 'none',
  interaction: {
    dragging: false,
    forceFocused: false,
    forceHovered: false,
    forcePressed: false,
    selected: false
  },
  runtime: 'idle',
  validation: 'valid'
};

const SANDBOX_CONNECTION_STATES = ['none', 'source-active', 'target-valid', 'target-invalid', 'preview'];
const SANDBOX_RUNTIME_STATES = ['idle', 'queued', 'running', 'succeeded', 'failed', 'skipped'];
const SANDBOX_VALIDATION_STATES = ['valid', 'warning', 'error'];
const CANVAS_DEBUG_COLLAPSE_STORAGE_KEY = 'stitchly.canvas.debug-panel-collapsed.v1';

const EMPTY_CANVAS_DEBUG_STATE = {
  blockerElement: null,
  pointer: null,
  sandboxId: null,
  sandboxConnectionState: 'none',
  sandboxDraggingState: false,
  pointerInsideSandbox: false,
  sandboxFocusMatch: false,
  sandboxHoverMatch: false,
  sandboxPressedState: false,
  sandboxSelectedState: false,
  sandboxRect: null,
  sandboxResolvedState: null,
  stack: [],
  topElement: null,
  viewport: null
};

export default function CanvasWorkspace() {
  const showCanvasDebug = import.meta.env.DEV;
  const [workflow, setWorkflow] = useState(() => cloneWorkflow(starterWorkflowFixture));
  const [nodeDefinitions, setNodeDefinitions] = useState(nodeDefinitionFixture.node_definitions);
  const [connections, setConnections] = useState(connectionFixture.connections);
  const [validation, setValidation] = useState(null);
  const [runSnapshot, setRunSnapshot] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [configDraft, setConfigDraft] = useState('{}');
  const [configError, setConfigError] = useState('');
  const [backendStatus, setBackendStatus] = useState('connecting');
  const [busyState, setBusyState] = useState({ validate: false, run: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('canvas');
  const [drawerQuery, setDrawerQuery] = useState('');
  const [floatingCard, setFloatingCard] = useState(null);
  const [canvasDebugState, setCanvasDebugState] = useState(EMPTY_CANVAS_DEBUG_STATE);
  const [isCanvasDebugCollapsed, setIsCanvasDebugCollapsed] = useState(() =>
    readStoredCanvasDebugCollapsed()
  );
  const [sandboxState, setSandboxState] = useState(() => cloneSandboxState());
  const [sandboxResetKey, setSandboxResetKey] = useState(0);
  const closeStreamRef = useRef(null);
  const deferredEvents = useDeferredValue(events);

  const selectedNode = workflow.nodes.find((node) => node.node_id === selectedNodeId) ?? null;
  const selectedDefinition = nodeDefinitions.find((definition) => definition.type_id === selectedNode?.type_id) ?? null;
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
    if (!selectedNode) {
      setConfigDraft('{}');
      setConfigError('');
      return;
    }

    setConfigDraft(JSON.stringify(selectedNode.config, null, 2));
    setConfigError('');
  }, [selectedNode]);

  useEffect(() => {
    return () => {
      closeStreamRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      CANVAS_DEBUG_COLLAPSE_STORAGE_KEY,
      JSON.stringify(isCanvasDebugCollapsed)
    );
  }, [isCanvasDebugCollapsed]);

  function applyWorkflowChange(nextWorkflow) {
    setWorkflow(nextWorkflow);
    setValidation(null);

    if (floatingCard?.type === 'problem-detail') {
      setFloatingCard(null);
    }
  }

  async function refreshRun(runId) {
    try {
      const snapshot = await getRunSnapshot(runId);
      setRunSnapshot(snapshot);
      upsertRunHistory(snapshot);
    } catch (error) {
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
        const nextProblems = buildProblemItems(response);
        setActiveSection('problems');
        setDrawerOpen(true);
        if (nextProblems[0]) {
          setFloatingCard({ type: 'problem-detail', problemId: nextProblems[0].id });
        }
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
      const response = await createRun(workflow);
      const seededRun = {
        run_id: response.run_id,
        workflow_id: workflow.workflow_id,
        workflow_version: workflow.version,
        status: response.status,
        node_runs: [],
        logs: []
      };

      upsertRunHistory(seededRun);
      setActiveSection('runs');
      setDrawerOpen(true);
      setFloatingCard({ type: 'run-detail', runId: response.run_id });
      setBackendStatus('connected');
      await refreshRun(response.run_id);

      closeStreamRef.current = subscribeToRun(response.run_id, {
        onEvent(event) {
          startTransition(() => {
            setEvents((current) => [...current, event]);
          });
          refreshRun(response.run_id);
        },
        onError() {
          setBackendStatus('stream-error');
        }
      });
    } catch (error) {
      setValidation(error.payload?.validation ?? null);
      setBackendStatus('offline');
    } finally {
      setBusyState((current) => ({ ...current, run: false }));
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
    setWorkflow(cloneWorkflow(starterWorkflowFixture));
    setValidation(null);
    setRunSnapshot(null);
    setRunHistory([]);
    setEvents([]);
    setSelectedNodeId(null);
    setConfigDraft('{}');
    setConfigError('');
    setDrawerOpen(false);
    setActiveSection('canvas');
    setDrawerQuery('');
    setFloatingCard(null);
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
      openRunDetail(result.runId);
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

  function toggleSandboxInteractionState(key) {
    setSandboxState((current) => ({
      ...current,
      interaction: {
        ...current.interaction,
        [key]: !current.interaction[key]
      }
    }));
  }

  function setSandboxConnectionState(value) {
    setSandboxState((current) => ({
      ...current,
      connection: value
    }));
  }

  function setSandboxValidationState(value) {
    setSandboxState((current) => ({
      ...current,
      validation: value
    }));
  }

  function setSandboxRuntimeState(value) {
    setSandboxState((current) => ({
      ...current,
      runtime: value
    }));
  }

  function resetSandboxState() {
    setSandboxState(cloneSandboxState());
    setSandboxResetKey((current) => current + 1);
  }

  return (
    <div className="app-shell">
      <WorkflowCanvas
        onDebugStateChange={showCanvasDebug ? setCanvasDebugState : undefined}
        sandboxResetKey={sandboxResetKey}
        sandboxState={sandboxState}
      />

      <div className="shell-overlay">
        {floatingCard ? (
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

              {floatingCard.type === 'run-control' ? (
                <div className="card-stack">
                  <CardMetricGrid
                    metrics={[
                      { label: 'Backend', value: humanizeToken(backendStatus) },
                      { label: 'Validation', value: validation ? (validation.valid ? 'Valid' : 'Issues') : 'Idle' },
                      { label: 'Runs', value: String(runHistory.length) },
                      { label: 'Events', value: String(deferredEvents.length) }
                    ]}
                  />

                  <div className="drawer-action-grid">
                    <button className="accent-button" onClick={handleValidate} type="button" disabled={busyState.validate}>
                      {busyState.validate ? 'Validating…' : 'Validate Workflow'}
                    </button>
                    <button className="secondary-button" onClick={handleRun} type="button" disabled={busyState.run}>
                      {busyState.run ? 'Starting…' : 'Run Workflow'}
                    </button>
                  </div>

                  <SectionBlock title="Latest Activity">
                    {deferredEvents.length ? (
                      <div className="drawer-list">
                        {deferredEvents.slice(-4).reverse().map((event) => (
                          <DrawerItemButton
                            key={event.event_id}
                            icon=">"
                            subtitle={event.target.node_id ?? 'run'}
                            title={humanizeToken(event.event_type)}
                            onClick={() => {
                              if (runSnapshot?.run_id) {
                                openRunDetail(runSnapshot.run_id);
                              }
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState message="No live events yet. Start a run to stream lifecycle activity here." />
                    )}
                  </SectionBlock>
                </div>
              ) : null}

              {floatingCard.type === 'run-detail' ? (
                <div className="card-stack">
                  <CardMetricGrid
                    metrics={[
                      { label: 'Run', value: activeRun?.run_id ?? 'Unknown' },
                      { label: 'Status', value: humanizeToken(activeRun?.status) },
                      { label: 'Nodes', value: String(activeRun?.node_runs?.length ?? 0) },
                      { label: 'Logs', value: String(activeRun?.logs?.length ?? 0) }
                    ]}
                  />

                  <SectionBlock title="Node States">
                    {activeRun?.node_runs?.length ? (
                      <div className="drawer-list">
                        {activeRun.node_runs.map((nodeRun) => (
                          <DrawerItemButton
                            key={nodeRun.node_id}
                            icon="N"
                            subtitle={nodeRun.type_id}
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
                    {deferredEvents.length ? (
                      <div className="drawer-list">
                        {deferredEvents.slice(-5).reverse().map((event) => (
                          <DrawerItemButton
                            key={event.event_id}
                            icon=">"
                            subtitle={event.target.node_id ?? 'run'}
                            title={humanizeToken(event.event_type)}
                            badge={event.sequence}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState message="Event replay appears here once the backend emits lifecycle updates." />
                    )}
                  </SectionBlock>

                  <SectionBlock title="Recent Logs">
                    {activeRun?.logs?.length ? (
                      <div className="drawer-list">
                        {activeRun.logs.slice(-4).reverse().map((entry, index) => (
                          <DrawerItemButton
                            key={`${entry.timestamp}-${index}`}
                            icon="L"
                            subtitle={entry.node_id ?? 'run'}
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

      {showCanvasDebug ? (
        <CanvasDebugPanel
          collapsed={isCanvasDebugCollapsed}
          debugState={canvasDebugState}
          onResetSandboxState={resetSandboxState}
          onSetConnectionState={setSandboxConnectionState}
          onSetRuntimeState={setSandboxRuntimeState}
          onSetValidationState={setSandboxValidationState}
          onToggleCollapsed={() => setIsCanvasDebugCollapsed((current) => !current)}
          onToggleInteractionState={toggleSandboxInteractionState}
          sandboxState={sandboxState}
        />
      ) : null}
    </div>
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
  onResetSandboxState,
  onSetConnectionState,
  onSetRuntimeState,
  onSetValidationState,
  onToggleCollapsed,
  onToggleInteractionState,
  sandboxState
}) {
  return (
    <aside
      aria-live="polite"
      className={`canvas-debug-panel${collapsed ? ' is-collapsed' : ''}`}
    >
      <div className="canvas-debug-panel__header">
        <div className="canvas-debug-panel__header-copy">
          <strong>Canvas Debug</strong>
          <span>dev only</span>
        </div>
        <button
          aria-expanded={!collapsed}
          className="canvas-debug-panel__collapse"
          onClick={onToggleCollapsed}
          type="button"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {collapsed ? (
        <div className="canvas-debug-panel__stack">
          <DebugValue
            label="Sandbox"
            value={humanizeToken(debugState.sandboxId ?? 'none')}
          />
          <DebugValue
            label="Pointer"
            value={debugState.pointer ? `${debugState.pointer.x}, ${debugState.pointer.y}` : 'Idle'}
          />
        </div>
      ) : (
        <>
          <div className="canvas-debug-panel__grid">
            <DebugValue label="Pointer" value={debugState.pointer ? `${debugState.pointer.x}, ${debugState.pointer.y}` : 'Idle'} />
            <DebugValue label="Active Sandbox" value={humanizeToken(debugState.sandboxId ?? 'none')} />
            <DebugValue
              label="Viewport"
              value={
                debugState.viewport
                  ? `${debugState.viewport.width}×${debugState.viewport.height} ${debugState.viewport.breakpoint}`
                  : 'Unknown'
              }
            />
            <DebugValue label="Sandbox :hover" value={debugState.sandboxHoverMatch ? 'yes' : 'no'} />
            <DebugValue label="Sandbox :focus" value={debugState.sandboxFocusMatch ? 'yes' : 'no'} />
            <DebugValue label="Sandbox Connection" value={humanizeToken(debugState.sandboxConnectionState ?? 'none')} />
            <DebugValue label="Sandbox Dragging" value={debugState.sandboxDraggingState ? 'yes' : 'no'} />
            <DebugValue label="Sandbox Pressed" value={debugState.sandboxPressedState ? 'yes' : 'no'} />
            <DebugValue label="Sandbox Selected" value={debugState.sandboxSelectedState ? 'yes' : 'no'} />
            <DebugValue label="Inside Sandbox" value={debugState.pointerInsideSandbox ? 'yes' : 'no'} />
          </div>

          <section className="canvas-debug-panel__section">
            <p className="canvas-debug-panel__label">Resolved Sandbox State</p>
            <div className="canvas-debug-panel__stack">
              <DebugStateDescriptor
                label="Interaction"
                value={formatInteractionState(debugState.sandboxResolvedState?.interaction)}
              />
              <DebugStateDescriptor label="Connection" value={humanizeToken(debugState.sandboxResolvedState?.connection ?? 'none')} />
              <DebugStateDescriptor label="Validation" value={humanizeToken(debugState.sandboxResolvedState?.validation ?? 'valid')} />
              <DebugStateDescriptor label="Runtime" value={humanizeToken(debugState.sandboxResolvedState?.runtime ?? 'idle')} />
            </div>
          </section>

          <section className="canvas-debug-panel__section">
            <p className="canvas-debug-panel__label">Sandbox Rect</p>
            <div className="canvas-debug-panel__stack">
              <DebugRectDescriptor label="Sandbox Rect" rect={debugState.sandboxRect} />
            </div>
          </section>

          <section className="canvas-debug-panel__section">
            <div className="canvas-debug-panel__section-head">
              <p className="canvas-debug-panel__label">State Controls</p>
              <button className="canvas-debug-panel__reset" onClick={onResetSandboxState} type="button">
                Reset
              </button>
            </div>

            <div className="canvas-debug-panel__stack">
              <DebugControlGroup label="Interaction">
                <DebugToggleButton
                  active={sandboxState.interaction.forceHovered}
                  label="Force Hover"
                  onClick={() => onToggleInteractionState('forceHovered')}
                />
                <DebugToggleButton
                  active={sandboxState.interaction.selected}
                  label="Force Selected"
                  onClick={() => onToggleInteractionState('selected')}
                />
                <DebugToggleButton
                  active={sandboxState.interaction.dragging}
                  label="Dragging"
                  onClick={() => onToggleInteractionState('dragging')}
                />
                <DebugToggleButton
                  active={sandboxState.interaction.forceFocused}
                  label="Force Focus"
                  onClick={() => onToggleInteractionState('forceFocused')}
                />
                <DebugToggleButton
                  active={sandboxState.interaction.forcePressed}
                  label="Force Press"
                  onClick={() => onToggleInteractionState('forcePressed')}
                />
              </DebugControlGroup>

              <DebugControlGroup label="Connection">
                {SANDBOX_CONNECTION_STATES.map((value) => (
                  <DebugToggleButton
                    key={value}
                    active={sandboxState.connection === value}
                    label={humanizeToken(value)}
                    onClick={() => onSetConnectionState(value)}
                  />
                ))}
              </DebugControlGroup>

              <DebugControlGroup label="Validation">
                {SANDBOX_VALIDATION_STATES.map((value) => (
                  <DebugToggleButton
                    key={value}
                    active={sandboxState.validation === value}
                    label={humanizeToken(value)}
                    onClick={() => onSetValidationState(value)}
                  />
                ))}
              </DebugControlGroup>

              <p className="canvas-debug-panel__empty">
                Validation and runtime overrides follow the selected sandbox node.
              </p>

              <DebugControlGroup label="Runtime">
                {SANDBOX_RUNTIME_STATES.map((value) => (
                  <DebugToggleButton
                    key={value}
                    active={sandboxState.runtime === value}
                    label={humanizeToken(value)}
                    onClick={() => onSetRuntimeState(value)}
                  />
                ))}
              </DebugControlGroup>
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
              <p className="canvas-debug-panel__empty">No top-level blocker detected outside the sandbox element.</p>
            )}
          </section>
        </>
      )}
    </aside>
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

function DebugStateDescriptor({ label, value }) {
  return (
    <div className="canvas-debug-panel__item">
      <div className="canvas-debug-panel__item-head">
        <strong>{label}</strong>
      </div>
      <code>{value}</code>
    </div>
  );
}

function DebugControlGroup({ children, label }) {
  return (
    <div className="canvas-debug-panel__item">
      <div className="canvas-debug-panel__item-head">
        <strong>{label}</strong>
      </div>
      <div className="canvas-debug-panel__controls">{children}</div>
    </div>
  );
}

function DebugToggleButton({ active, label, onClick }) {
  return (
    <button
      className={`canvas-debug-panel__toggle${active ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
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

function cloneSandboxState() {
  return structuredClone(DEFAULT_SANDBOX_STATE);
}

function formatInteractionState(interaction) {
  if (!interaction) {
    return 'Idle';
  }

  const activeStates = Object.entries(interaction)
    .filter(([, enabled]) => enabled)
    .map(([key]) => humanizeToken(key));

  return activeStates.length ? activeStates.join(', ') : 'Idle';
}

function readStoredCanvasDebugCollapsed() {
  if (typeof window === 'undefined') {
    return false;
  }

  const stored = window.localStorage.getItem(CANVAS_DEBUG_COLLAPSE_STORAGE_KEY);
  return stored ? JSON.parse(stored) === true : false;
}
