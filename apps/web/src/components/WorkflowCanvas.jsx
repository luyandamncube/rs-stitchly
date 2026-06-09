import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  useConnection
} from '@xyflow/react'
import { getDraggedNodeType } from '../lib/canvasDnD'
import { humanizeToken } from '../lib/shell'
import {
  canConnect,
  connectWorkflowNodes,
  createCanvasElements,
  inspectConnection,
  removeWorkflowEdge,
  removeWorkflowNode,
  reconnectWorkflowEdge,
  syncWorkflowEdges,
  syncWorkflowNodes
} from '../lib/workflow'

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
}

const NODE_TYPES = {
  checkpoint_read: memo(CheckpointReadNode),
  checkpoint_write: memo(CheckpointWriteNode),
  quality_check: memo(QualityCheckNode),
  dolt_change_manifest: memo(DoltChangeManifestNode),
  dolt_diff_export: memo(DoltDiffExportNode),
  dolt_dump: memo(DoltDumpNode),
  dolt_repo_source: memo(DoltRepoSourceNode),
  dolt_repo_sync: memo(DoltRepoSyncNode),
  load_to_duckdb: memo(LoadToDuckDbNode),
  send_email: memo(SendEmailNode),
  table_merge: memo(TableMergeNode),
  table_input: memo(TableInputNode),
  table_output: memo(TableOutputNode),
  table_schema: memo(TableSchemaNode),
  stitchly: memo(StitchlyNode),
  text_input: memo(TextInputNode)
}

function WorkflowCanvas({
  activeRunSnapshot = null,
  draggedNodeType = null,
  nodeDefinitions = [],
  onDebugStateChange,
  onNodeTypeDrop,
  onSelectionChange,
  onViewportActionsReady,
  onViewportChange,
  onWorkflowChange,
  selectedNodeId = null,
  workflow
}) {
  const debugSignatureRef = useRef('')
  const currentDebugStateRef = useRef(EMPTY_CANVAS_DEBUG_STATE)
  const connectStartRef = useRef({
    handleId: null,
    handleType: null,
    nodeId: null
  })
  const resolvedConnectionRef = useRef(null)
  const liveConnectionDebugRef = useRef({
    connectionFromHandleId: null,
    connectionFromNodeId: null,
    connectionInProgress: false,
    connectionIsValid: null,
    connectionReason: null,
    connectionToHandleId: null,
    connectionToNodeId: null,
    connectionTypes: null
  })
  const reactFlowInstanceRef = useRef(null)
  const latestViewportRef = useRef({ x: 0, y: 0, zoom: 1 })
  const [selectedEdgeId, setSelectedEdgeId] = useState(null)
  const [liveConnectionDebug, setLiveConnectionDebug] = useState({
    connectionFromHandleId: null,
    connectionFromNodeId: null,
    connectionInProgress: false,
    connectionIsValid: null,
    connectionReason: null,
    connectionToHandleId: null,
    connectionToNodeId: null,
    connectionTypes: null
  })

  const { edges, nodes } = useMemo(
    () =>
      createCanvasElements(
        workflow,
        nodeDefinitions,
        selectedNodeId,
        null,
        selectedEdgeId,
        activeRunSnapshot
      ),
    [activeRunSnapshot, nodeDefinitions, selectedEdgeId, selectedNodeId, workflow]
  )

  const publishDebugState = useCallback(
    (nextState) => {
      if (!onDebugStateChange) {
        return
      }

      const nextSignature = JSON.stringify(nextState)
      if (nextSignature === debugSignatureRef.current) {
        return
      }

      debugSignatureRef.current = nextSignature
      currentDebugStateRef.current = nextState
      onDebugStateChange(nextState)
    },
    [onDebugStateChange]
  )

  const inspectCanvas = useCallback(
    (event, preferredNodeId = selectedNodeId, preferredEdgeId = selectedEdgeId) => {
      if (!onDebugStateChange || typeof document === 'undefined') {
        return
      }

      const pointer = pointForEvent(event)
      const stack = pointer ? document.elementsFromPoint(pointer.x, pointer.y).slice(0, 8) : []
      const topElement = stack[0] ?? null
      const activeNodeId = findActiveNodeId(stack, preferredNodeId, selectedNodeId)
      const activeEdgeId = findActiveEdgeId(stack, preferredEdgeId, selectedEdgeId)
      const resolvedSelectedNodeId = preferredNodeId ?? selectedNodeId
      const resolvedSelectedEdgeId = preferredEdgeId ?? selectedEdgeId
      const nodeElement =
        activeNodeId != null
          ? document.querySelector(`.react-flow__node[data-id="${activeNodeId}"]`)
          : null
      const nodeRect = describeRect(nodeElement?.getBoundingClientRect?.() ?? null)
      const topElementInsideNode =
        topElement instanceof Element && nodeElement instanceof Element
          ? nodeElement.contains(topElement) || topElement === nodeElement
          : false

      publishDebugState({
        activeEdgeId,
        activeNodeId,
        blockerElement:
          nodeElement instanceof Element && topElement instanceof Element && !topElementInsideNode
            ? describeCanvasElement(topElement)
            : null,
        ...liveConnectionDebug,
        edgeSelectedState: activeEdgeId != null && activeEdgeId === resolvedSelectedEdgeId,
        nodeFocusMatch: Boolean(nodeElement?.matches(':focus')),
        nodeHoverMatch: Boolean(nodeElement?.matches(':hover')),
        nodeRect,
        nodeSelectedState: activeNodeId != null && activeNodeId === resolvedSelectedNodeId,
        pointer: pointer ? { x: Math.round(pointer.x), y: Math.round(pointer.y) } : null,
        pointerInsideNode: pointer ? isPointInsideRect(pointer.x, pointer.y, nodeRect) : false,
        stack: stack.map(describeCanvasElement),
        topElement: describeCanvasElement(topElement),
        viewport:
          typeof window === 'undefined'
            ? null
            : {
                breakpoint: breakpointForWidth(window.innerWidth),
                height: Math.round(window.innerHeight),
                width: Math.round(window.innerWidth)
              }
      })
    },
    [liveConnectionDebug, onDebugStateChange, publishDebugState, selectedEdgeId, selectedNodeId]
  )

  const handleCanvasPointerMove = useCallback(
    (event) => {
      inspectCanvas(event)
    },
    [inspectCanvas]
  )

  const handleCanvasPointerLeave = useCallback(() => {
    publishDebugState({
      ...EMPTY_CANVAS_DEBUG_STATE,
      ...liveConnectionDebug
    })
  }, [liveConnectionDebug, publishDebugState])

  const handleConnectionDebugChange = useCallback(
    (nextConnectionDebug) => {
      const directConnection = buildConnectionFromDebugState(nextConnectionDebug)
      const diagnostics = directConnection
        ? inspectConnection(directConnection, workflow, nodeDefinitions)
        : null
      const nextConnection = diagnostics?.valid ? directConnection : null

      resolvedConnectionRef.current = nextConnection

      const computedConnectionDebug = {
        ...nextConnectionDebug,
        connectionIsValid:
          typeof nextConnectionDebug.connectionIsValid === 'boolean'
            ? nextConnectionDebug.connectionIsValid || Boolean(nextConnection)
            : nextConnection
              ? true
              : nextConnectionDebug.connectionIsValid
        ,
        connectionReason: diagnostics?.reason ?? (nextConnectionDebug.connectionInProgress ? 'pending' : null),
        connectionTypes:
          diagnostics?.sourceDataType || diagnostics?.targetDataType
            ? `${diagnostics?.sourceDataType ?? '?' }→${diagnostics?.targetDataType ?? '?' }`
            : null
      }

      liveConnectionDebugRef.current = computedConnectionDebug
      setLiveConnectionDebug(computedConnectionDebug)
      publishDebugState({
        ...currentDebugStateRef.current,
        ...computedConnectionDebug
      })
    },
    [nodeDefinitions, publishDebugState, workflow]
  )

  const handleNodeClick = useCallback(
    (event, node) => {
      setSelectedEdgeId(null)
      onSelectionChange?.(node.id)
      inspectCanvas(event, node.id, null)
    },
    [inspectCanvas, onSelectionChange]
  )

  const handleNodeMouseEnter = useCallback(
    (event, node) => {
      inspectCanvas(event, node.id, null)
    },
    [inspectCanvas]
  )

  const handleNodeMouseLeave = useCallback(
    (event, node) => {
      inspectCanvas(event, selectedNodeId, selectedEdgeId)
    },
    [inspectCanvas, selectedEdgeId, selectedNodeId]
  )

  const handlePaneClick = useCallback(
    (event) => {
      setSelectedEdgeId(null)
      onSelectionChange?.(null)
      inspectCanvas(event, null, null)
    },
    [inspectCanvas, onSelectionChange]
  )

  const handleCanvasDragOver = useCallback((event) => {
    if (!onNodeTypeDrop) {
      return
    }

    const nodeType = getDraggedNodeType(event.dataTransfer) || draggedNodeType
    if (!nodeType) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [draggedNodeType, onNodeTypeDrop])

  const handleCanvasDrop = useCallback((event) => {
    if (!onNodeTypeDrop) {
      return
    }

    const nodeType = getDraggedNodeType(event.dataTransfer) || draggedNodeType
    if (!nodeType) {
      return
    }

    event.preventDefault()

    const pointer = pointForEvent(event) ?? { x: 0, y: 0 }
    const position = reactFlowInstanceRef.current
      ? reactFlowInstanceRef.current.screenToFlowPosition({
          x: pointer.x,
          y: pointer.y
        })
      : pointer

    onNodeTypeDrop(nodeType, position)
  }, [draggedNodeType, onNodeTypeDrop])

  const handleEdgeClick = useCallback(
    (event, edge) => {
      setSelectedEdgeId(edge.id)
      onSelectionChange?.(null)
      inspectCanvas(event, null, edge.id)
    },
    [inspectCanvas, onSelectionChange]
  )

  const handleNodesChange = useCallback(
    (changes) => {
      if (!workflow || !onWorkflowChange) {
        return
      }

      const positionChanges = changes.filter((change) => change.type === 'position')
      if (!positionChanges.length) {
        return
      }

      const nextNodes = applyNodeChanges(positionChanges, nodes)
      onWorkflowChange(syncWorkflowNodes(workflow, nextNodes))
    },
    [nodes, onWorkflowChange, workflow]
  )

  const handleConnect = useCallback(
    (connection) => {
      if (!workflow || !onWorkflowChange || !canConnect(connection, workflow, nodeDefinitions)) {
        return
      }

      setSelectedEdgeId(null)
      onWorkflowChange(connectWorkflowNodes(workflow, connection, nodeDefinitions))
    },
    [nodeDefinitions, onWorkflowChange, workflow]
  )

  const handleConnectStart = useCallback((_event, params) => {
    connectStartRef.current = {
      handleId: params?.handleId ?? null,
      handleType: params?.handleType ?? null,
      nodeId: params?.nodeId ?? null
    }
  }, [])

  const handleConnectEnd = useCallback(
    (event, connectionState) => {
      if (!workflow || !onWorkflowChange || connectionState?.isValid) {
        connectStartRef.current = {
          handleId: null,
          handleType: null,
          nodeId: null
        }
        return
      }

      const fallbackConnection = buildNodeBodyConnection(
        connectionState,
        workflow,
        nodeDefinitions
      )
      const liveFallbackConnection = buildConnectionFromDebugState(liveConnectionDebugRef.current)
      const pointerFallbackConnection = buildPointerDropConnection(
        event,
        connectStartRef.current,
        workflow,
        nodeDefinitions
      )
      const resolvedConnection = resolvedConnectionRef.current

      const nextConnection =
        resolvedConnection
          ? resolvedConnection
          : fallbackConnection && canConnect(fallbackConnection, workflow, nodeDefinitions)
            ? fallbackConnection
            : liveFallbackConnection &&
                canConnect(liveFallbackConnection, workflow, nodeDefinitions)
              ? liveFallbackConnection
              : pointerFallbackConnection &&
                  canConnect(pointerFallbackConnection, workflow, nodeDefinitions)
                ? pointerFallbackConnection
                : null

      connectStartRef.current = {
        handleId: null,
        handleType: null,
        nodeId: null
      }
      resolvedConnectionRef.current = null

      if (!nextConnection) {
        return
      }

      setSelectedEdgeId(null)
      onWorkflowChange(connectWorkflowNodes(workflow, nextConnection, nodeDefinitions))
      inspectCanvas(event, null, null)
    },
    [inspectCanvas, nodeDefinitions, onWorkflowChange, workflow]
  )

  const handleEdgesChange = useCallback(
    (changes) => {
      if (!workflow || !onWorkflowChange || !changes.length) {
        return
      }

      const nextEdges = applyEdgeChanges(changes, edges)
      const removed = changes.some((change) => change.type === 'remove')
      const selectedChange = changes.find((change) => change.type === 'select')

      if (selectedChange && 'selected' in selectedChange) {
        setSelectedEdgeId(selectedChange.selected ? selectedChange.id : null)
        if (selectedChange.selected) {
          onSelectionChange?.(null)
        }
      }

      if (removed) {
        if (!nextEdges.some((edge) => edge.id === selectedEdgeId)) {
          setSelectedEdgeId(null)
        }

        onWorkflowChange(syncWorkflowEdges(workflow, nextEdges))
      }
    },
    [edges, onSelectionChange, onWorkflowChange, selectedEdgeId, workflow]
  )

  const handleReconnect = useCallback(
    (oldEdge, connection) => {
      if (
        !workflow ||
        !onWorkflowChange ||
        !canConnect({ ...connection, edgeId: oldEdge.id }, workflow, nodeDefinitions)
      ) {
        return
      }

      setSelectedEdgeId(oldEdge.id)
      onWorkflowChange(reconnectWorkflowEdge(workflow, oldEdge.id, connection, nodeDefinitions))
    },
    [nodeDefinitions, onWorkflowChange, workflow]
  )

  useEffect(() => {
    return () => {
      onViewportActionsReady?.(null)
    }
  }, [onViewportActionsReady])

  useEffect(() => {
    if (!selectedEdgeId || !workflow || !onWorkflowChange) {
      return
    }

    const handleKeyDown = (event) => {
      if (
        (event.key !== 'Delete' && event.key !== 'Backspace') ||
        shouldIgnoreDeleteShortcut(event)
      ) {
        return
      }

      event.preventDefault()
      setSelectedEdgeId(null)
      onSelectionChange?.(null)
      onWorkflowChange(removeWorkflowEdge(workflow, selectedEdgeId))
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [edges, onSelectionChange, onWorkflowChange, selectedEdgeId, workflow])

  useEffect(() => {
    if (!selectedNodeId || selectedEdgeId || !workflow || !onWorkflowChange) {
      return
    }

    const handleKeyDown = (event) => {
      if (
        (event.key !== 'Delete' && event.key !== 'Backspace') ||
        shouldIgnoreDeleteShortcut(event)
      ) {
        return
      }

      event.preventDefault()
      onSelectionChange?.(null)
      onWorkflowChange(removeWorkflowNode(workflow, selectedNodeId))
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSelectionChange, onWorkflowChange, selectedEdgeId, selectedNodeId, workflow])

  return (
    <div
      className="canvas-surface"
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
      onPointerLeave={handleCanvasPointerLeave}
      onPointerMove={handleCanvasPointerMove}
    >
      <ReactFlow
        className="workflow-flow"
        colorMode="dark"
        defaultEdgeOptions={{
          animated: false,
          pathOptions: {
            curvature: 0.42
          },
          style: {
            stroke: 'rgba(255, 122, 26, 0.62)',
            strokeWidth: 1.45
          },
          type: 'default'
        }}
        defaultViewport={{
          x: 0,
          y: 0,
          zoom: 1
        }}
        connectionMode={ConnectionMode.Strict}
        connectionRadius={42}
        edges={edges}
        edgesReconnectable
        isValidConnection={(connection) => canConnect(connection, workflow, nodeDefinitions)}
        maxZoom={2}
        minZoom={0.25}
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        onEdgeClick={handleEdgeClick}
        onEdgesChange={handleEdgesChange}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance
          const nextViewport =
            typeof instance.getViewport === 'function'
              ? instance.getViewport()
              : { x: 0, y: 0, zoom: 1 }
          latestViewportRef.current = nextViewport
          onViewportChange?.(nextViewport)
          onViewportActionsReady?.({
            fitView() {
              return reactFlowInstanceRef.current?.fitView?.({
                duration: 180,
                padding: 0.16
              })
            },
            zoomIn() {
              return reactFlowInstanceRef.current?.zoomIn?.({ duration: 180 })
            },
            zoomOut() {
              return reactFlowInstanceRef.current?.zoomOut?.({ duration: 180 })
            },
            zoomTo(zoom) {
              const currentViewport =
                typeof reactFlowInstanceRef.current?.getViewport === 'function'
                  ? reactFlowInstanceRef.current.getViewport()
                  : latestViewportRef.current

              return reactFlowInstanceRef.current?.setViewport?.(
                { ...currentViewport, zoom },
                { duration: 180 }
              )
            }
          })
        }}
        onMove={(_event, viewport) => {
          latestViewportRef.current = viewport
          onViewportChange?.(viewport)
        }}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodesChange={handleNodesChange}
        onPaneClick={handlePaneClick}
        onReconnect={handleReconnect}
        panOnDrag
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        zoomOnPinch
        zoomOnScroll
      >
        <Background
          color="rgba(255,255,255,0.12)"
          gap={24}
          size={1.35}
          variant="dots"
        />
        <ConnectionDebugBridge
          nodeDefinitions={nodeDefinitions}
          onChange={handleConnectionDebugChange}
          workflow={workflow}
        />
      </ReactFlow>
    </div>
  )
}

function TextInputNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Text input'
  const emittedText = extractRuntimeTextValue(runtime?.lastOutput)
  const textValue = emittedText ?? data.node?.config?.text ?? '--'
  const charCount = typeof textValue === 'string' ? textValue.length : 0
  const runtimeState = runtime?.status ?? null
  const footerLabel = runtimeState ? 'Last run' : 'Text'
  const footerValue = runtimeState ? humanizeRuntimeStatus(runtimeState) : `${charCount} chars`
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildTextInputClassName({
        dragging,
        hovered: Boolean(data.uiState?.interaction?.hovered),
        selected
      })}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            T
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--primary">
          <span className="workflow-node-card__value workflow-node-card__value--multiline">
            {textValue}
          </span>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">{footerLabel}</span>
        <strong>{footerValue}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="text"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function SendEmailNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Send Email'
  const recipient = data.node?.config?.to ?? '--'
  const subject = data.node?.config?.subject ?? '--'
  const runtimeState = runtime?.status ?? null
  const footerValue = runtimeState ? humanizeRuntimeStatus(runtimeState) : 'Idle'
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--output-result workflow-node-card--send-email',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="body"
        position={Position.Left}
        type="target"
      />

      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            @
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__label">To</span>
            <span className="workflow-node-card__summary-target">{recipient}</span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Subject</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {subject}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Last send</span>
        <strong>{footerValue}</strong>
      </footer>
    </div>
  )
}

function TableOutputNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Table Output'
  const config = normalizeTableOutputNodeConfig(data.node?.config)
  const runtimeState = runtime?.status ?? null
  const footerValue = runtimeState ? humanizeRuntimeStatus(runtimeState) : 'Idle'
  const executionWait = getNodeExecutionWaitState(data.node?.config)
  const destination =
    config.input_shape === 'table_schema'
      ? `${config.target_schema}.*`
      : `${config.target_schema}.${config.table_name}`
  const shapeLabel =
    config.input_shape === 'table_schema'
      ? 'Schema bootstrap'
      : config.input_shape === 'source_table'
        ? 'Source table'
        : 'Single text row'

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--output-result workflow-node-card--table-output',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="text"
        position={Position.Left}
        type="target"
      />

      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            []
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__label">Target</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {destination}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Shape</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {shapeLabel}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Last write</span>
        <strong>{footerValue}</strong>
      </footer>
    </div>
  )
}

function TableInputNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Table Input'
  const config = normalizeTableInputNodeConfig(data.node?.config)
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)
  const source = `${config.schema_name}.${config.table_name}`
  const selectedColumnsLabel =
    config.selected_columns.length === 0
      ? 'All columns'
      : config.selected_columns.length === 1
        ? config.selected_columns[0]
        : `${config.selected_columns.length} columns`

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--table-input',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            []
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__label">Source</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {source}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Columns</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {selectedColumnsLabel}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Catalog</span>
        <strong>{config.catalog}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function TableSchemaNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Table Schema'
  const config = normalizeTableSchemaNodeConfig(data.node?.config)
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--table-schema',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            []
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">
              {config.table_count === 1 ? 'Table' : 'Tables'}
            </span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.table_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Columns</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.total_columns} col{config.total_columns === 1 ? '' : 's'}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Mode</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.mode_summary}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">
          {config.table_count === 1 ? 'Alias' : 'Preview'}
        </span>
        <strong>{config.table_count === 1 ? config.output_alias : config.preview_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function DoltRepoSourceNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Dolt Repo Source'
  const config = normalizeDoltRepoSourceNodeConfig(data.node?.config)
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--dolt-repo-source',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span
            className="workflow-node-card__icon workflow-node-card__icon--dolt"
            aria-hidden="true"
          >
            <DoltRepoSourceMark />
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Repo</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.repository}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Branch</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.branch}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Sync</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.sync_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Current commit</span>
        <strong>{config.current_commit}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="repo_out"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function DoltRepoSyncNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Dolt Repo Sync'
  const config = normalizeDoltRepoSyncNodeConfig(
    data.node?.config,
    data.workflow,
    data.node?.node_id
  )
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--dolt-repo-sync',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span
            className="workflow-node-card__icon workflow-node-card__icon--dolt"
            aria-hidden="true"
          >
            <DoltRepoSourceMark />
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">From</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.previous_commit}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">To</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.current_commit}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Sync action</span>
        <strong>{config.sync_action_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="repo"
        position={Position.Left}
        style={{ top: '38%' }}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="checkpoint"
        position={Position.Left}
        style={{ top: '72%' }}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="repo_out"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function CheckpointReadNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Checkpoint Read'
  const config = normalizeCheckpointReadNodeConfig(data.node?.config)
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--checkpoint-read',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            R
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Scope</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.scope_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Fallback</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.fallback_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Last commit</span>
        <strong>{config.last_commit_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="checkpoint"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function CheckpointWriteNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Checkpoint Write'
  const config = normalizeCheckpointWriteNodeConfig(
    data.node?.config,
    data.workflow,
    data.node?.node_id
  )
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--checkpoint-write',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            W
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Write gate</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.write_gate_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Scope</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.scope_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Commit source</span>
        <strong>{config.commit_source_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Left}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function QualityCheckNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Quality Check'
  const config = normalizeQualityCheckNodeConfig(
    data.node?.config,
    data.workflow,
    data.node?.node_id
  )
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--quality-check',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            Q
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Suite</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.suite_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Gate</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.gate_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Last result</span>
        <strong>{config.last_result_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Left}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function DoltChangeManifestNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Dolt Change Manifest'
  const config = normalizeDoltChangeManifestNodeConfig(
    data.node?.config,
    data.workflow,
    data.node?.node_id
  )
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--dolt-change-manifest',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span
            className="workflow-node-card__icon workflow-node-card__icon--dolt"
            aria-hidden="true"
          >
            <DoltRepoSourceMark />
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Range</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.range_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Scope</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.scope_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Schema drift</span>
        <strong>{config.schema_drift_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="repo"
        position={Position.Left}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="manifest"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function DoltDumpNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Dolt Dump'
  const config = normalizeDoltDumpNodeConfig(
    data.node?.config,
    data.workflow,
    data.node?.node_id
  )
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--dolt-dump',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span
            className="workflow-node-card__icon workflow-node-card__icon--dolt"
            aria-hidden="true"
          >
            <DoltRepoSourceMark />
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Format</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.format_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Tables</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.table_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Bundle</span>
        <strong>{config.bundle_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="repo"
        position={Position.Left}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="bundle"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function DoltDiffExportNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Dolt Diff Export'
  const config = normalizeDoltDiffExportNodeConfig(
    data.node?.config,
    data.workflow,
    data.node?.node_id
  )
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--dolt-diff-export',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span
            className="workflow-node-card__icon workflow-node-card__icon--dolt"
            aria-hidden="true"
          >
            <DoltRepoSourceMark />
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Range</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.range_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Filter</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.filter_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Bundle</span>
        <strong>{config.bundle_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="manifest"
        position={Position.Left}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="bundle"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function LoadToDuckDbNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Load to DuckDB'
  const config = normalizeLoadToDuckDbNodeConfig(
    data.node?.config,
    data.workflow,
    data.node?.node_id
  )
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--load-to-duckdb',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span
            className="workflow-node-card__icon workflow-node-card__icon--duckdb"
            aria-hidden="true"
          >
            <DuckDbMark />
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Target</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.target_label}
            </span>
          </div>
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Bundle mode</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.bundle_mode_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Merge context</span>
        <strong>{config.merge_context_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="bundle"
        position={Position.Left}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function TableMergeNode({ data, dragging, selected }) {
  const runtime = data.uiState?.runtime ?? null
  const nodeLabel = data.node?.label ?? data.label ?? 'Table Merge'
  const config = normalizeTableMergeNodeConfig(data.node?.config)
  const runtimeState = runtime?.status ?? null
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildWorkflowNodeCardClassName(
        'workflow-node-card--input-reference workflow-node-card--table-merge',
        {
          dragging,
          hovered: Boolean(data.uiState?.interaction?.hovered),
          selected
        }
      )}
      data-runtime-state={runtimeState ?? undefined}
      title={buildNodeRuntimeTitle(runtime, 'Click to select. Drag to move. Double-click to inspect.')}
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            G
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <div className="workflow-node-card__tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="workflow-node-card__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          <span className="workflow-node-card__menu" aria-hidden="true">
            ...
          </span>
        </div>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--summary">
          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Policy</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.write_policy_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Key</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.key_label}
            </span>
          </div>

          <div className="workflow-node-card__summary-head">
            <span className="workflow-node-card__summary-label">Deletes</span>
            <span className="workflow-node-card__summary-target workflow-node-card__summary-target--subject">
              {config.delete_handling_label}
            </span>
          </div>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">Target</span>
        <strong>{config.target_label}</strong>
      </footer>

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Left}
        type="target"
      />

      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="table"
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function DoltRepoSourceMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path
        d="M4 16C1.791 16 0 14.209 0 12V8C0 5.791 1.791 4 4 4H6V1.75C6 0.784 6.784 0 7.75 0C8.716 0 9.5 0.784 9.5 1.75V12C9.5 14.209 7.709 16 5.5 16H4ZM4 7.5C3.724 7.5 3.5 7.724 3.5 8V12C3.5 12.276 3.724 12.5 4 12.5H5.5C5.776 12.5 6 12.276 6 12V7.5H4Z"
        fill="currentColor"
      />
    </svg>
  )
}

function DuckDbMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <circle cx="5.2" cy="8" r="3.1" fill="#f8d106" />
      <path
        d="M10.2 6.5H11.65C12.6777 6.5 13.5 7.32235 13.5 8.35C13.5 9.37765 12.6777 10.2 11.65 10.2H10.2V6.5Z"
        fill="#f8d106"
      />
    </svg>
  )
}

function StitchlyNode({ data, dragging, selected }) {
  const card = data.card
  const hovered = Boolean(data.uiState?.interaction?.hovered)
  const executionWait = getNodeExecutionWaitState(data.node?.config)

  return (
    <div
      className={buildSchemaNodeClassName(card?.variant, {
        dragging,
        hovered,
        selected
      })}
      title="Click to select. Drag to move. Double-click to inspect."
    >
      {card?.handles?.inputs?.map((handle) => (
        <Handle
          key={`input-${handle.id}`}
          className="schema-node__handle"
          id={handle.id}
          position={Position.Left}
          style={{ top: handle.top }}
          type="target"
        />
      ))}

      {card?.topChip ? <span className="schema-node__top-chip">{card.topChip}</span> : null}

      <div className="schema-node__header">
        <div className="schema-node__heading">
          <span className="schema-node__icon" aria-hidden="true">
            {card?.iconLabel ?? 'N'}
          </span>
          <strong>{card?.title ?? data.label}</strong>
        </div>

        <div className="schema-node__header-tools">
          {executionWait.enabled ? (
            <NodeExecutionWaitIcon
              className="schema-node__delay-icon"
              hasAfterWait={executionWait.hasAfterWait}
              hasBeforeWait={executionWait.hasBeforeWait}
            />
          ) : null}
          {card?.showOverflowMenu ? (
            <span className="schema-node__menu" aria-hidden="true">
              ...
            </span>
          ) : null}
        </div>
      </div>

      <div className="schema-node__body">
        {(card?.rows ?? []).map((row) =>
          row.kind === 'text_block' ? (
            <div key={row.id} className="schema-node__row schema-node__row--stacked">
              <div className="schema-node__row-meta">
                <span>{row.label}</span>
              </div>
              <strong className={row.truncate ? 'is-truncated' : ''}>{row.value}</strong>
            </div>
          ) : (
            <div key={row.id} className="schema-node__row schema-node__row--kv">
              <div className="schema-node__row-meta">
                {row.iconLabel ? (
                  <span className="schema-node__row-icon" aria-hidden="true">
                    {row.iconLabel}
                  </span>
                ) : null}
                <span>{row.label}</span>
              </div>
              <strong className={row.truncate ? 'is-truncated' : ''}>{row.value}</strong>
            </div>
          )
        )}
      </div>

      {card?.footer ? (
        <div className="schema-node__footer">
          <div className="schema-node__footer-meta">
            {card.footer.iconLabel ? (
              <span className="schema-node__footer-icon" aria-hidden="true">
                {card.footer.iconLabel}
              </span>
            ) : null}
            <span>{card.footer.label}</span>
          </div>
          <strong>{card.footer.value}</strong>
        </div>
      ) : null}

      {card?.handles?.outputs?.map((handle) => (
        <Handle
          key={`output-${handle.id}`}
          className="schema-node__handle"
          id={handle.id}
          position={Position.Right}
          style={{ top: handle.top }}
          type="source"
        />
      ))}
    </div>
  )
}

function buildSchemaNodeClassName(variant = 'node', { dragging, hovered, selected }) {
  const classes = ['schema-node', `schema-node--${variant}`]

  if (hovered) {
    classes.push('is-hovered')
  }

  if (selected) {
    classes.push('selected')
  }

  if (dragging) {
    classes.push('is-dragging')
  }

  return classes.join(' ')
}

function buildTextInputClassName({ dragging, hovered, selected }) {
  return buildWorkflowNodeCardClassName(
    'workflow-node-card--input-literal workflow-node-card--text-input',
    {
      dragging,
      hovered,
      selected
    }
  )
}

function getNodeExecutionWaitState(config = null) {
  const execution = config?.execution ?? {}
  const hasBeforeWait = normalizeExecutionWaitSeconds(execution.wait_before_seconds) > 0
  const hasAfterWait = normalizeExecutionWaitSeconds(execution.wait_after_seconds) > 0

  return {
    enabled: hasBeforeWait || hasAfterWait,
    hasAfterWait,
    hasBeforeWait
  }
}

function normalizeExecutionWaitSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0
  }

  return value
}

function normalizeTableOutputNodeConfig(config = {}) {
  return {
    input_shape:
      config?.input_shape === 'source_table' || config?.input_shape === 'table_schema'
        ? config.input_shape
        : 'single_text_row',
    table_name:
      typeof config?.table_name === 'string' && config.table_name.trim()
        ? config.table_name.trim()
        : 'news_brief',
    target_schema:
      typeof config?.target_schema === 'string' && config.target_schema.trim()
        ? config.target_schema.trim()
        : 'outputs'
  }
}

function normalizeTableInputNodeConfig(config = {}) {
  const selectedColumns = Array.isArray(config?.selected_columns)
    ? config.selected_columns
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
    : []

  return {
    catalog:
      typeof config?.catalog === 'string' && config.catalog.trim()
        ? config.catalog.trim()
        : 'workflow.duckdb',
    schema_name:
      typeof config?.schema_name === 'string' && config.schema_name.trim()
        ? config.schema_name.trim()
        : 'runs',
    selected_columns: selectedColumns,
    table_name:
      typeof config?.table_name === 'string' && config.table_name.trim()
        ? config.table_name.trim()
        : 'workflow_runs'
  }
}

function normalizeTableSchemaNodeConfig(config = {}) {
  const rawTables =
    Array.isArray(config?.tables) && config.tables.length > 0 ? config.tables : [config]
  const tables = rawTables.map((tableConfig, index) => {
    const tableName =
      typeof tableConfig?.table_name === 'string' && tableConfig.table_name.trim()
        ? tableConfig.table_name.trim()
        : index === 0
          ? 'orders_fact'
          : `table_${index + 1}`
    const createMode =
      typeof tableConfig?.create_mode === 'string' && tableConfig.create_mode.trim()
        ? tableConfig.create_mode.trim()
        : typeof config?.create_mode === 'string' && config.create_mode.trim()
          ? config.create_mode.trim()
          : 'create_if_missing'
    const outputAlias =
      typeof tableConfig?.output_alias === 'string' && tableConfig.output_alias.trim()
        ? tableConfig.output_alias.trim()
        : tableName
    const columns = Array.isArray(tableConfig?.columns)
      ? tableConfig.columns.filter((column) => column && typeof column === 'object')
      : []

    return {
      column_count: columns.length,
      create_mode: createMode,
      output_alias: outputAlias,
      table_name: tableName
    }
  })
  const primaryTable = tables[0]
  const uniqueModes = [...new Set(tables.map((table) => table.create_mode))]
  const totalColumns = tables.reduce((count, table) => count + table.column_count, 0)
  const previewLabel =
    tables.length <= 1
      ? primaryTable.table_name
      : `${primaryTable.table_name} +${tables.length - 1} more`

  return {
    create_mode: primaryTable.create_mode,
    mode_summary: uniqueModes.length === 1 ? uniqueModes[0] : `${uniqueModes.length} modes`,
    output_alias: primaryTable.output_alias,
    preview_label: previewLabel,
    table_count: tables.length,
    table_label: tables.length === 1 ? primaryTable.table_name : `${tables.length} tables`,
    total_columns: totalColumns
  }
}

function normalizeDoltRepoSourceNodeConfig(config = {}) {
  const repository =
    typeof config?.repository === 'string' && config.repository.trim()
      ? config.repository.trim()
      : 'post-no-preference/earnings'
  const profile = resolveMockDoltRepoSourceNodeProfile(repository)
  const checkoutRef =
    typeof config?.checkout_ref === 'string' && config.checkout_ref.trim()
      ? config.checkout_ref.trim()
      : ''
  const syncStrategy =
    config?.sync_strategy === 'clone_only' || config?.sync_strategy === 'manual'
      ? config.sync_strategy
      : 'pull_before_execution'

  return {
    branch:
      typeof config?.branch === 'string' && config.branch.trim()
        ? config.branch.trim()
        : 'main',
    current_commit: checkoutRef
      ? checkoutRef.slice(0, 12)
      : profile?.current_commit ?? 'pending_sync',
    repository,
    sync_label: describeDoltRepoSourceNodeSyncStrategy(syncStrategy)
  }
}

function resolveMockCheckpointReadNodeState(config = {}) {
  const sourceRepo =
    typeof config?.source_repo === 'string' && config.source_repo.trim()
      ? config.source_repo.trim()
      : 'post-no-preference/earnings'
  const branch =
    typeof config?.branch === 'string' && config.branch.trim() ? config.branch.trim() : 'main'
  const checkpointTable =
    typeof config?.checkpoint_table === 'string' && config.checkpoint_table.trim()
      ? config.checkpoint_table.trim()
      : 'tables.ingest_checkpoints'
  const emitBootstrapMarkerIfMissing = config?.emit_bootstrap_marker_if_missing !== false
  const failOnStaleCheckpoint = config?.fail_on_stale_checkpoint === true
  const profile = resolveMockDoltRepoSourceNodeProfile(sourceRepo)

  if (!profile) {
    return {
      branch,
      checkpoint_table: checkpointTable,
      emit_bootstrap_marker_if_missing: emitBootstrapMarkerIfMissing,
      fail_on_stale_checkpoint: failOnStaleCheckpoint,
      has_checkpoint: false,
      last_ingest_mode: emitBootstrapMarkerIfMissing ? 'bootstrap_pending' : 'checkpoint_required',
      last_success_at: null,
      last_synced_commit: null,
      scope_label: 'repo checkpoint',
      source_repo: sourceRepo,
      stale_checkpoint: false
    }
  }

  const lastSuccessAt =
    sourceRepo === 'post-no-preference/options'
      ? '2026-06-08T14:22:11Z'
      : sourceRepo === 'post-no-preference/rates'
        ? '2026-06-08T09:15:42Z'
        : '2026-06-07T18:04:09Z'

  return {
    branch,
    checkpoint_table: checkpointTable,
    emit_bootstrap_marker_if_missing: emitBootstrapMarkerIfMissing,
    fail_on_stale_checkpoint: failOnStaleCheckpoint,
    has_checkpoint: true,
    last_ingest_mode: sourceRepo === 'post-no-preference/earnings' ? 'bootstrap_refresh' : 'recurring_delta',
    last_success_at: lastSuccessAt,
    last_synced_commit: profile.previous_commit ?? null,
    scope_label: 'repo checkpoint',
    source_repo: sourceRepo,
    stale_checkpoint: false
  }
}

function resolveMockDoltRepoSourceNodeProfile(repository) {
  switch (repository) {
    case 'post-no-preference/earnings':
      return {
        previous_commit: '92fd7ac',
        current_commit: 'a34ef9c'
      }
    case 'post-no-preference/options':
      return {
        previous_commit: 'ac31f0b',
        current_commit: 'b91c2aa'
      }
    case 'post-no-preference/rates':
      return {
        previous_commit: 'c83f10d',
        current_commit: 'd0f61b4'
      }
    default:
      return null
  }
}

function describeDoltRepoSourceNodeSyncStrategy(syncStrategy) {
  switch (syncStrategy) {
    case 'clone_only':
      return 'Clone only'
    case 'manual':
      return 'Manual'
    default:
      return humanizeToken('pull_before_execution')
  }
}

function normalizeCheckpointReadNodeConfig(config = {}) {
  const checkpointState = resolveMockCheckpointReadNodeState(config)

  return {
    fallback_label: checkpointState.emit_bootstrap_marker_if_missing
      ? 'bootstrap marker'
      : 'fail if missing',
    last_commit_label: checkpointState.last_synced_commit ?? 'bootstrap pending',
    scope_label: checkpointState.scope_label
  }
}

function normalizeCheckpointWriteNodeConfig(config = {}, workflow = null, nodeId = null) {
  const checkpointContext = resolveConnectedCheckpointWriteNodeContext(workflow, nodeId)
  const onlyPersistOnFullSuccess = config?.only_persist_on_full_success !== false
  const advanceOnPartialSuccess = config?.advance_on_partial_success === true
  const commitSource =
    config?.commit_source === 'metadata.current_commit'
      ? 'metadata.current_commit'
      : 'metadata.current_commit'

  return {
    commit_source_label: commitSource,
    scope_label: checkpointContext?.scopeLabel ?? 'repo + branch',
    write_gate_label: onlyPersistOnFullSuccess && !advanceOnPartialSuccess
      ? 'success only'
      : advanceOnPartialSuccess
        ? 'partial allowed'
        : 'durable success',
  }
}

function normalizeQualityCheckNodeConfig(config = {}, workflow = null, nodeId = null) {
  const qualityState = resolveMockQualityCheckNodeState(
    config,
    resolveConnectedQualityCheckNodeContext(workflow, nodeId)
  )

  return {
    gate_label: qualityState.block_checkpoint_write_on_failure
      ? 'checkpoint + publish'
      : 'advisory only',
    last_result_label:
      qualityState.gate_status === 'pass'
        ? 'passed'
        : qualityState.gate_status === 'fail'
          ? `${qualityState.failing_rules.length || 1} failure`
          : `${qualityState.warning_rules.length || 1} warnings`,
    suite_label: describeQualityCheckSuitePreset(qualityState.suite_preset)
  }
}

function normalizeDoltRepoSyncNodeConfig(config = {}, workflow = null, nodeId = null) {
  const sourceConfig = resolveConnectedDoltRepoSourceNodeConfig(workflow, nodeId)
  const checkpointContext = resolveConnectedCheckpointReadNodeContext(workflow, nodeId)
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : 'post-no-preference/earnings'
  const profile = resolveMockDoltRepoSourceNodeProfile(repository)
  const checkoutRef =
    typeof sourceConfig?.checkout_ref === 'string' && sourceConfig.checkout_ref.trim()
      ? sourceConfig.checkout_ref.trim()
      : ''
  const syncAction =
    config?.sync_action === 'fetch_and_checkout' || config?.sync_action === 'refresh_checkout'
      ? config.sync_action
      : 'pull_remote_head'

  return {
    current_commit: checkoutRef
      ? checkoutRef.slice(0, 12)
      : profile?.current_commit ?? 'pending_sync',
    previous_commit: checkpointContext
      ? checkpointContext.last_synced_commit ?? 'pending_checkpoint'
      : profile?.previous_commit ?? 'pending_checkpoint',
    sync_action_label: describeDoltRepoSyncNodeAction(syncAction)
  }
}

function normalizeDoltChangeManifestNodeConfig(config = {}, workflow = null, nodeId = null) {
  const syncContext = resolveConnectedDoltRepoSyncNodeContext(workflow, nodeId)
  const sourceConfig = syncContext?.sourceConfig ?? null
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : 'post-no-preference/earnings'
  const profile = resolveMockDoltRepoSourceNodeProfile(repository)
  const checkoutRef =
    typeof sourceConfig?.checkout_ref === 'string' && sourceConfig.checkout_ref.trim()
      ? sourceConfig.checkout_ref.trim()
      : ''
  const selectedTables = normalizeDoltChangeManifestSelectedTables(config?.selected_tables)
  const tableScope = config?.table_scope === 'allowlist' ? 'allowlist' : 'all_tables'
  const manifestProfile = resolveMockDoltChangeManifestNodeProfile(repository)
  const changedTables = filterDoltChangeManifestTables(
    manifestProfile?.changed_tables ?? [],
    tableScope,
    selectedTables
  )
  const schemaChangedTables = filterDoltChangeManifestTables(
    manifestProfile?.schema_changed_tables ?? [],
    tableScope,
    selectedTables
  )

  return {
    range_label: `${profile?.previous_commit ?? 'pending_checkpoint'} -> ${
      checkoutRef ? checkoutRef.slice(0, 12) : profile?.current_commit ?? 'pending_sync'
    }`,
    scope_label:
      tableScope === 'allowlist'
        ? selectedTables.length > 0
          ? `${selectedTables.length} selected`
          : 'selected tables'
        : 'all tables',
    schema_drift_label:
      schemaChangedTables.length > 0
        ? `${schemaChangedTables.length} table${schemaChangedTables.length === 1 ? '' : 's'} flagged`
        : changedTables.length > 0
          ? 'No drift'
          : 'Pending scope'
  }
}

function normalizeDoltDumpNodeConfig(config = {}, workflow = null, nodeId = null) {
  const sourceContext = resolveConnectedDoltDumpNodeContext(workflow, nodeId)
  const tableSelectionMode =
    config?.table_selection_mode === 'all_tables' || config?.table_selection_mode === 'manual_tables'
      ? config.table_selection_mode
      : 'prefer_manifest_scope'
  const selectedTables = normalizeDoltDumpSelectedTables(config?.selected_tables)
  const formatLabel = config?.output_format === 'csv' ? 'csv' : 'parquet'
  const tableLabel =
    tableSelectionMode === 'manual_tables'
      ? selectedTables.length > 0
        ? `${selectedTables.length} selected`
        : 'selected tables'
      : tableSelectionMode === 'prefer_manifest_scope' && sourceContext?.sourceTypeId === 'dolt_change_manifest'
        ? sourceContext.changedTables.length > 0
          ? `${sourceContext.changedTables.length} changed`
          : 'changed tables'
        : 'all tables'

  return {
    bundle_label: 'directory_ref',
    format_label: formatLabel,
    repository: sourceContext?.repository ?? 'post-no-preference/earnings',
    table_label: tableLabel
  }
}

function normalizeDoltDiffExportNodeConfig(config = {}, workflow = null, nodeId = null) {
  const sourceContext = resolveConnectedDoltDiffExportNodeContext(workflow, nodeId)

  return {
    bundle_label: 'directory_ref',
    filter_label: describeDoltDiffExportFilter(config?.change_filter),
    range_label: `${sourceContext?.previousCommit ?? 'pending_checkpoint'} -> ${
      sourceContext?.currentCommit ?? 'pending_sync'
    }`
  }
}

function normalizeTableMergeNodeConfig(config = {}) {
  const writePolicy =
    config?.write_policy === 'append_only' || config?.write_policy === 'snapshot_replace'
      ? config.write_policy
      : 'upsert'
  const mergeKeyColumns = Array.isArray(config?.merge_key_columns)
    ? config.merge_key_columns
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    : []
  const deleteHandling =
    config?.delete_handling === 'ignore_delete_markers'
      ? 'ignore_delete_markers'
      : 'apply_delete_markers'

  return {
    delete_handling_label:
      deleteHandling === 'ignore_delete_markers' ? 'markers off' : 'markers on',
    key_label: mergeKeyColumns.length > 0 ? mergeKeyColumns.join(', ') : 'No key',
    target_label:
      typeof config?.target_schema === 'string' && config.target_schema.trim()
        ? `${config.target_schema.trim()} durable`
        : 'tables durable',
    write_policy_label:
      writePolicy === 'append_only'
        ? 'append only'
        : writePolicy === 'snapshot_replace'
          ? 'snapshot replace'
          : 'upsert'
  }
}

function normalizeLoadToDuckDbNodeConfig(config = {}, workflow = null, nodeId = null) {
  const sourceContext = resolveConnectedLoadToDuckDbNodeContext(workflow, nodeId)

  return {
    bundle_mode_label:
      sourceContext?.sourceTypeId === 'dolt_diff_export'
        ? 'delta bundle'
        : sourceContext?.sourceTypeId === 'dolt_dump'
          ? 'snapshot bundle'
          : 'dump + diff aware',
    merge_context_label:
      sourceContext?.sourceTypeId === 'dolt_diff_export'
        ? 'load manifest'
        : sourceContext?.currentCommit
          ? sourceContext.currentCommit
          : 'load manifest',
    target_label:
      typeof config?.target_schema === 'string' && config.target_schema.trim()
        ? config.target_schema.trim()
        : 'staging'
  }
}

function resolveConnectedDoltRepoSourceNodeConfig(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_repo_source'
  )

  return sourceNode?.config ?? null
}

function resolveConnectedDoltRepoSyncNodeContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  )
  if (!incomingEdge) {
    return null
  }

  const syncNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_repo_sync'
  )
  if (!syncNode) {
    return null
  }

  return {
    checkpointContext: resolveConnectedCheckpointReadNodeContext(workflow, syncNode.node_id),
    sourceConfig: resolveConnectedDoltRepoSourceNodeConfig(workflow, syncNode.node_id),
    syncConfig: syncNode.config ?? {}
  }
}

function resolveConnectedCheckpointReadNodeContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'checkpoint'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'checkpoint_read'
  )
  if (!sourceNode) {
    return null
  }

  return resolveMockCheckpointReadNodeState(sourceNode.config)
}

function resolveConnectedDoltDumpNodeContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id)
  if (!sourceNode) {
    return null
  }

  if (sourceNode.type_id === 'dolt_repo_source') {
    const repository =
      typeof sourceNode.config?.repository === 'string' && sourceNode.config.repository.trim()
        ? sourceNode.config.repository.trim()
        : 'post-no-preference/earnings'

    return {
      changedTables: [],
      repository,
      sourceConfig: sourceNode.config ?? null,
      sourceTypeId: sourceNode.type_id
    }
  }

  if (sourceNode.type_id === 'dolt_repo_sync') {
    const sourceConfig = resolveConnectedDoltRepoSourceNodeConfig(workflow, sourceNode.node_id)
    const repository =
      typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
        ? sourceConfig.repository.trim()
        : 'post-no-preference/earnings'

    return {
      changedTables: [],
      repository,
      sourceConfig,
      sourceTypeId: sourceNode.type_id
    }
  }

  if (sourceNode.type_id === 'dolt_change_manifest') {
    const syncContext = resolveConnectedDoltRepoSyncNodeContext(workflow, sourceNode.node_id)
    const repository =
      typeof syncContext?.sourceConfig?.repository === 'string' &&
      syncContext.sourceConfig.repository.trim()
        ? syncContext.sourceConfig.repository.trim()
        : 'post-no-preference/earnings'

    return {
      changedTables: resolveMockDoltDumpManifestTables(repository, sourceNode.config),
      repository,
      sourceConfig: syncContext?.sourceConfig ?? null,
      sourceTypeId: sourceNode.type_id
    }
  }

  return null
}

function resolveConnectedDoltDiffExportNodeContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'manifest'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_change_manifest'
  )
  if (!sourceNode) {
    return null
  }

  const syncContext = resolveConnectedDoltRepoSyncNodeContext(workflow, sourceNode.node_id)
  const repository =
    typeof syncContext?.sourceConfig?.repository === 'string' &&
    syncContext.sourceConfig.repository.trim()
      ? syncContext.sourceConfig.repository.trim()
      : 'post-no-preference/earnings'
  const profile = resolveMockDoltRepoSourceNodeProfile(repository)
  const checkoutRef =
    typeof syncContext?.sourceConfig?.checkout_ref === 'string' &&
    syncContext.sourceConfig.checkout_ref.trim()
      ? syncContext.sourceConfig.checkout_ref.trim()
      : ''

  return {
    sourceConfig: syncContext?.sourceConfig ?? null,
    currentCommit: checkoutRef
      ? checkoutRef.slice(0, 12)
      : profile?.current_commit ?? 'pending_sync',
    previousCommit: profile?.previous_commit ?? 'pending_checkpoint'
  }
}

function resolveConnectedLoadToDuckDbNodeContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'bundle'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id)
  if (!sourceNode) {
    return null
  }

  if (sourceNode.type_id === 'dolt_dump') {
    const dumpContext = resolveConnectedDoltDumpNodeContext(workflow, sourceNode.node_id)
    const repository =
      typeof dumpContext?.repository === 'string' && dumpContext.repository.trim()
        ? dumpContext.repository.trim()
        : 'post-no-preference/earnings'
    const profile = resolveMockDoltRepoSourceNodeProfile(repository)
    return {
      branch:
        typeof dumpContext?.sourceConfig?.branch === 'string' &&
        dumpContext.sourceConfig.branch.trim()
          ? dumpContext.sourceConfig.branch.trim()
          : 'main',
      currentCommit: profile?.current_commit ?? 'pending_sync',
      previousCommit: null,
      repository,
      sourceTypeId: sourceNode.type_id
    }
  }

  if (sourceNode.type_id === 'dolt_diff_export') {
    const diffContext = resolveConnectedDoltDiffExportNodeContext(workflow, sourceNode.node_id)
    return {
      branch:
        typeof diffContext?.sourceConfig?.branch === 'string' &&
        diffContext.sourceConfig.branch.trim()
          ? diffContext.sourceConfig.branch.trim()
          : 'main',
      currentCommit: diffContext?.currentCommit ?? 'pending_sync',
      previousCommit: diffContext?.previousCommit ?? 'pending_checkpoint',
      repository:
        typeof diffContext?.sourceConfig?.repository === 'string' &&
        diffContext.sourceConfig.repository.trim()
          ? diffContext.sourceConfig.repository.trim()
          : 'post-no-preference/earnings',
      sourceTypeId: sourceNode.type_id
    }
  }

  return null
}

function resolveConnectedCheckpointWriteNodeContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'table'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id)
  if (!sourceNode) {
    return null
  }

  if (sourceNode.type_id === 'table_merge') {
    const loadContext = resolveConnectedLoadToDuckDbNodeContext(workflow, sourceNode.node_id)
    if (!loadContext) {
      return {
        scopeLabel: 'repo + branch'
      }
    }

    return {
      branch: loadContext.branch ?? 'main',
      currentCommit: loadContext.currentCommit ?? 'pending_sync',
      previousCommit: loadContext.previousCommit ?? null,
      repository: loadContext.repository ?? 'post-no-preference/earnings',
      scopeLabel: 'repo + branch'
    }
  }

  if (sourceNode.type_id === 'quality_check') {
    const qualityContext = resolveConnectedQualityCheckNodeContext(workflow, sourceNode.node_id)
    if (!qualityContext) {
      return {
        scopeLabel: 'repo + branch'
      }
    }

    return {
      branch: qualityContext.branch ?? 'main',
      currentCommit: qualityContext.currentCommit ?? 'pending_sync',
      previousCommit: qualityContext.previousCommit ?? null,
      repository: qualityContext.repository ?? 'post-no-preference/earnings',
      scopeLabel: qualityContext.scopeLabel ?? 'repo + branch'
    }
  }

  return {
    scopeLabel: 'repo + branch'
  }
}

function resolveConnectedQualityCheckNodeContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'table'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id)
  if (!sourceNode || sourceNode.type_id !== 'table_merge') {
    return null
  }

  const loadContext = resolveConnectedLoadToDuckDbNodeContext(workflow, sourceNode.node_id)
  if (!loadContext) {
    return {
      scopeLabel: 'repo + branch'
    }
  }

  return {
    branch: loadContext.branch ?? 'main',
    currentCommit: loadContext.currentCommit ?? 'pending_sync',
    previousCommit: loadContext.previousCommit ?? null,
    repository: loadContext.repository ?? 'post-no-preference/earnings',
    scopeLabel: 'repo + branch'
  }
}

function resolveMockQualityCheckNodeState(config = {}, context = null) {
  const repository =
    typeof context?.repository === 'string' && context.repository.trim()
      ? context.repository.trim()
      : 'post-no-preference/earnings'
  const suitePreset =
    config?.suite_preset === 'custom_rule_bundle'
      ? 'custom_rule_bundle'
      : 'post_merge_ingest_gate'
  const warningBudget =
    typeof config?.warning_budget === 'number' && Number.isFinite(config.warning_budget)
      ? Math.max(0, Math.round(config.warning_budget))
      : 2
  const allowWarningOnlyRunsToContinue =
    config?.allow_warning_only_runs_to_continue !== false
  const blockCheckpointWriteOnFailure =
    config?.block_checkpoint_write_on_failure !== false

  if (repository === 'post-no-preference/earnings') {
    return {
      allow_warning_only_runs_to_continue: allowWarningOnlyRunsToContinue,
      block_checkpoint_write_on_failure: blockCheckpointWriteOnFailure,
      failing_rules: [],
      gate_status: 'warn',
      suite_preset: suitePreset,
      warning_budget: warningBudget,
      warning_rules: ['freshness lag', 'soft schema drift note']
    }
  }

  return {
    allow_warning_only_runs_to_continue: allowWarningOnlyRunsToContinue,
    block_checkpoint_write_on_failure: blockCheckpointWriteOnFailure,
    failing_rules: [],
    gate_status: 'pass',
    suite_preset: suitePreset,
    warning_budget: warningBudget,
    warning_rules: []
  }
}

function describeQualityCheckSuitePreset(suitePreset) {
  switch (suitePreset) {
    case 'custom_rule_bundle':
      return 'custom audit'
    default:
      return 'post-merge audit'
  }
}

function describeDoltRepoSyncNodeAction(syncAction) {
  switch (syncAction) {
    case 'fetch_and_checkout':
      return 'Fetch And Checkout'
    case 'refresh_checkout':
      return 'Refresh Checkout'
    default:
      return 'Pull Remote Head'
  }
}

function describeDoltDiffExportFilter(changeFilter) {
  switch (changeFilter) {
    case 'non_delete_changes':
      return 'Non-delete changes'
    case 'added_only':
      return 'Added only'
    case 'modified_only':
      return 'Modified only'
    case 'removed_only':
      return 'Removed only'
    default:
      return 'All changes'
  }
}

function normalizeDoltChangeManifestSelectedTables(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean))]
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]
  }

  return []
}

function normalizeDoltDumpSelectedTables(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean))]
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]
  }

  return []
}

function resolveMockDoltChangeManifestNodeProfile(repository) {
  switch (repository) {
    case 'post-no-preference/earnings':
      return {
        changed_tables: ['earnings_calendar', 'eps_history', 'income_statement'],
        schema_changed_tables: ['income_statement']
      }
    case 'post-no-preference/options':
      return {
        changed_tables: ['option_chain', 'volatility_history'],
        schema_changed_tables: []
      }
    case 'post-no-preference/rates':
      return {
        changed_tables: ['us_treasury'],
        schema_changed_tables: []
      }
    default:
      return null
  }
}

function resolveMockDoltDumpManifestTables(repository, manifestConfig = {}) {
  const manifestProfile = resolveMockDoltChangeManifestNodeProfile(repository)
  const tableScope = manifestConfig?.table_scope === 'allowlist' ? 'allowlist' : 'all_tables'
  const selectedTables = normalizeDoltChangeManifestSelectedTables(manifestConfig?.selected_tables)

  return filterDoltChangeManifestTables(
    manifestProfile?.changed_tables ?? [],
    tableScope,
    selectedTables
  )
}

function filterDoltChangeManifestTables(changedTables, tableScope, selectedTables) {
  if (tableScope !== 'allowlist') {
    return [...changedTables]
  }

  if (selectedTables.length === 0) {
    return []
  }

  const selectedSet = new Set(selectedTables)
  return changedTables.filter((tableName) => selectedSet.has(tableName))
}

function NodeExecutionWaitIcon({
  className = '',
  hasAfterWait = false,
  hasBeforeWait = false
}) {
  return (
    <span aria-hidden="true" className={className} title="Execution wait configured">
      {hasBeforeWait ? (
        <span className="node-execution-wait-icon__arrow node-execution-wait-icon__arrow--before">
          ←
        </span>
      ) : null}
      <svg viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="5.9" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M10 6.95V10L12.35 11.45"
          stroke="currentColor"
          strokeLinecap="square"
          strokeLinejoin="miter"
          strokeWidth="1.3"
        />
      </svg>
      {hasAfterWait ? (
        <span className="node-execution-wait-icon__arrow node-execution-wait-icon__arrow--after">
          →
        </span>
      ) : null}
    </span>
  )
}

function buildWorkflowNodeCardClassName(variantClassName, { dragging, hovered, selected }) {
  const classes = ['workflow-node-card', variantClassName]

  if (hovered) {
    classes.push('is-hovered')
  }

  if (selected) {
    classes.push('is-selected')
  }

  if (dragging) {
    classes.push('is-dragging')
  }

  return classes.join(' ')
}

function extractRuntimeTextValue(lastOutput) {
  if (lastOutput?.data_type === 'text' && typeof lastOutput.value === 'string') {
    return lastOutput.value
  }

  return null
}

function buildNodeRuntimeTitle(runtime, baseTitle) {
  const message = runtime?.error?.message
  if (!message) {
    return baseTitle
  }

  return `${baseTitle} Last error: ${message}`
}

function humanizeRuntimeStatus(status) {
  if (!status) {
    return 'Idle'
  }

  return String(status)
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function describeCanvasElement(element) {
  if (!(element instanceof Element)) {
    return null
  }

  return {
    className:
      typeof element.className === 'string'
        ? element.className.trim().replace(/\s+/g, ' ')
        : '',
    pointerEvents: getComputedStyle(element).pointerEvents,
    tag: element.tagName.toLowerCase(),
    zIndex: getComputedStyle(element).zIndex
  }
}

function describeRect(rect) {
  if (!rect) {
    return null
  }

  return {
    bottom: Math.round(rect.bottom),
    height: Math.round(rect.height),
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    top: Math.round(rect.top),
    width: Math.round(rect.width)
  }
}

function findActiveNodeId(stack, preferredNodeId, selectedNodeId) {
  for (const element of stack) {
    if (!(element instanceof Element)) {
      continue
    }

    const nodeElement = element.closest('.react-flow__node[data-id]')

    if (nodeElement instanceof HTMLElement) {
      return nodeElement.dataset.id ?? null
    }
  }

  return preferredNodeId ?? selectedNodeId ?? null
}

function findActiveEdgeId(stack, preferredEdgeId, selectedEdgeId) {
  for (const element of stack) {
    if (!(element instanceof Element)) {
      continue
    }

    const edgeElement = element.closest('.react-flow__edge[data-id]')

    if (edgeElement instanceof HTMLElement) {
      return edgeElement.dataset.id ?? null
    }
  }

  return preferredEdgeId ?? selectedEdgeId ?? null
}

function ConnectionDebugBridge({ nodeDefinitions, onChange, workflow }) {
  const connection = useConnection()

  useEffect(() => {
    onChange?.(describeConnectionDebugState(connection, workflow, nodeDefinitions))
  }, [connection, nodeDefinitions, onChange, workflow])

  return null
}

function describeConnectionDebugState(connection, workflow, nodeDefinitions) {
  const baseState = {
    connectionFromHandleId: connection?.fromHandle?.id ?? null,
    connectionFromNodeId: connection?.fromNode?.id ?? null,
    connectionInProgress: Boolean(connection?.inProgress),
    connectionToHandleId: connection?.toHandle?.id ?? null,
    connectionToNodeId: connection?.toNode?.id ?? null
  }
  const derivedConnection =
    workflow && nodeDefinitions
      ? buildNodeBodyConnection(connection, workflow, nodeDefinitions)
      : null

  return {
    ...baseState,
    connectionIsValid:
      typeof connection?.isValid === 'boolean'
        ? connection.isValid || Boolean(derivedConnection)
        : derivedConnection
          ? true
          : null,
    connectionReason: null,
    connectionTypes: null
  }
}

function buildNodeBodyConnection(connectionState, workflow, nodeDefinitions) {
  const sourceNodeId = connectionState?.fromNode?.id ?? null
  const targetNodeId = connectionState?.toNode?.id ?? null

  if (!sourceNodeId || !targetNodeId) {
    return null
  }

  const sourceNode = workflow.nodes.find((node) => node.node_id === sourceNodeId)
  const targetNode = workflow.nodes.find((node) => node.node_id === targetNodeId)

  if (!sourceNode || !targetNode) {
    return null
  }

  const sourceDefinition = nodeDefinitions.find(
    (definition) => definition.type_id === sourceNode.type_id
  )
  const targetDefinition = nodeDefinitions.find(
    (definition) => definition.type_id === targetNode.type_id
  )

  if (!sourceDefinition || !targetDefinition) {
    return null
  }

  const sourceHandleId =
    connectionState?.fromHandle?.id ??
    (sourceDefinition.outputs.length === 1 ? sourceDefinition.outputs[0].port_id : null)
  const targetHandleId =
    connectionState?.toHandle?.id ??
    (targetDefinition.inputs.length === 1 ? targetDefinition.inputs[0].port_id : null)

  if (!sourceHandleId || !targetHandleId) {
    return null
  }

  return {
    source: sourceNodeId,
    sourceHandle: sourceHandleId,
    target: targetNodeId,
    targetHandle: targetHandleId
  }
}

function buildConnectionFromDebugState(debugState) {
  const sourceNodeId = debugState?.connectionFromNodeId ?? null
  const sourceHandleId = debugState?.connectionFromHandleId ?? null
  const targetNodeId = debugState?.connectionToNodeId ?? null
  const targetHandleId = debugState?.connectionToHandleId ?? null

  if (!sourceNodeId || !sourceHandleId || !targetNodeId || !targetHandleId) {
    return null
  }

  return {
    source: sourceNodeId,
    sourceHandle: sourceHandleId,
    target: targetNodeId,
    targetHandle: targetHandleId
  }
}

function buildPointerDropConnection(event, connectStart, workflow, nodeDefinitions) {
  if (typeof document === 'undefined' || connectStart?.handleType !== 'source') {
    return null
  }

  const pointer = pointForEvent(event)
  if (!pointer) {
    return null
  }

  const stack = document.elementsFromPoint(pointer.x, pointer.y).slice(0, 8)
  const handleTarget = findHandleTargetFromStack(stack, connectStart.nodeId)
  if (handleTarget) {
    return {
      source: connectStart.nodeId,
      sourceHandle: connectStart.handleId,
      target: handleTarget.nodeId,
      targetHandle: handleTarget.handleId
    }
  }

  const targetNodeId = findTargetNodeIdFromStack(stack, connectStart.nodeId)
  if (!targetNodeId) {
    return null
  }

  const targetNode = workflow.nodes.find((node) => node.node_id === targetNodeId)
  const targetDefinition = nodeDefinitions.find(
    (definition) => definition.type_id === targetNode?.type_id
  )
  const targetHandleId =
    targetDefinition?.inputs.length === 1 ? targetDefinition.inputs[0].port_id : null

  if (!connectStart.nodeId || !connectStart.handleId || !targetHandleId) {
    return null
  }

  return {
    source: connectStart.nodeId,
    sourceHandle: connectStart.handleId,
    target: targetNodeId,
    targetHandle: targetHandleId
  }
}

function findHandleTargetFromStack(stack, sourceNodeId) {
  for (const element of stack) {
    if (!(element instanceof HTMLElement)) {
      continue
    }

    const handleElement = element.closest('.react-flow__handle[data-nodeid][data-handleid]')
    if (!(handleElement instanceof HTMLElement)) {
      continue
    }

    const nodeId = handleElement.dataset.nodeid ?? null
    const handleId = handleElement.dataset.handleid ?? null

    if (!nodeId || !handleId || nodeId === sourceNodeId) {
      continue
    }

    return { handleId, nodeId }
  }

  return null
}

function findTargetNodeIdFromStack(stack, sourceNodeId) {
  for (const element of stack) {
    if (!(element instanceof Element)) {
      continue
    }

    const nodeElement = element.closest('.react-flow__node[data-id]')

    if (!(nodeElement instanceof HTMLElement)) {
      continue
    }

    const nodeId = nodeElement.dataset.id ?? null
    if (nodeId && nodeId !== sourceNodeId) {
      return nodeId
    }
  }

  return null
}

function isPointInsideRect(x, y, rect) {
  if (!rect) {
    return false
  }

  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function pointForEvent(event) {
  if (!event) {
    return null
  }

  const x = Number(event.clientX)
  const y = Number(event.clientY)

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return { x, y }
}

function breakpointForWidth(width) {
  if (width <= 720) {
    return '<=720'
  }

  if (width <= 920) {
    return '<=920'
  }

  if (width <= 1180) {
    return '<=1180'
  }

  return '>1180'
}

function shouldIgnoreDeleteShortcut(event) {
  const target = event.target

  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

export default memo(WorkflowCanvas)
