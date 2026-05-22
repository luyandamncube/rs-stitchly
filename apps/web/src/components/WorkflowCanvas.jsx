import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionMode,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useConnection
} from '@xyflow/react'
import { getDraggedNodeType } from '../lib/canvasDnD'
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
  send_email: memo(SendEmailNode),
  stitchly: memo(StitchlyNode),
  text_input: memo(TextInputNode)
}

function WorkflowCanvas({
  draggedNodeType = null,
  nodeDefinitions = [],
  onDebugStateChange,
  onNodeTypeDrop,
  onNodeOpen,
  onSelectionChange,
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
    () => createCanvasElements(workflow, nodeDefinitions, selectedNodeId, null, selectedEdgeId),
    [nodeDefinitions, selectedEdgeId, selectedNodeId, workflow]
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

  const handleNodeDoubleClick = useCallback(
    (_event, node) => {
      onNodeOpen?.(node.id)
    },
    [onNodeOpen]
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
          type: 'bezier'
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
        maxZoom={1}
        minZoom={1}
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
        }}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodesChange={handleNodesChange}
        onPaneClick={handlePaneClick}
        onReconnect={handleReconnect}
        panOnDrag={false}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        zoomOnPinch={false}
        zoomOnScroll={false}
      >
        <MiniMap pannable zoomable />
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
  const nodeLabel = data.node?.label ?? data.label ?? 'Text input'
  const textValue = data.node?.config?.text ?? '--'
  const charCount = typeof textValue === 'string' ? textValue.length : 0

  return (
    <div
      className={buildTextInputClassName({
        dragging,
        hovered: Boolean(data.uiState?.interaction?.hovered),
        selected
      })}
      title="Click to select. Drag to move. Double-click to inspect."
    >
      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            T
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <span className="workflow-node-card__menu" aria-hidden="true">
          ...
        </span>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--primary">
          <span className="workflow-node-card__label">Text</span>
          <strong className="workflow-node-card__value workflow-node-card__value--multiline">
            {textValue}
          </strong>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">
          <span className="workflow-node-card__footer-icon" aria-hidden="true">
            #
          </span>
          <span>Length</span>
        </span>
        <strong>{charCount} chars</strong>
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
  const nodeLabel = data.node?.label ?? data.label ?? 'Send Email'
  const recipient = data.node?.config?.to ?? '--'
  const subject = data.node?.config?.subject ?? '--'

  return (
    <div
      className={buildWorkflowNodeCardClassName('workflow-node-card--output-result', {
        dragging,
        hovered: Boolean(data.uiState?.interaction?.hovered),
        selected
      })}
      title="Click to select. Drag to move. Double-click to inspect."
    >
      <Handle
        className="schema-node__handle workflow-node-card__handle"
        id="body"
        position={Position.Left}
        type="target"
      />

      <span className="workflow-node-card__top-chip">Notify</span>

      <header className="workflow-node-card__header">
        <div className="workflow-node-card__heading">
          <span className="workflow-node-card__icon" aria-hidden="true">
            @
          </span>
          <strong>{nodeLabel}</strong>
        </div>
        <span className="workflow-node-card__menu" aria-hidden="true">
          ...
        </span>
      </header>

      <section className="workflow-node-card__body">
        <div className="workflow-node-card__row workflow-node-card__row--kv">
          <span className="workflow-node-card__label">
            <span className="workflow-node-card__label-icon" aria-hidden="true">
              T
            </span>
            <span>To</span>
          </span>
          <strong className="workflow-node-card__value">{recipient}</strong>
        </div>

        <div className="workflow-node-card__row workflow-node-card__row--primary">
          <span className="workflow-node-card__label">Subject</span>
          <strong className="workflow-node-card__value workflow-node-card__value--truncate">
            {subject}
          </strong>
        </div>
      </section>

      <footer className="workflow-node-card__footer">
        <span className="workflow-node-card__footer-meta">
          <span className="workflow-node-card__footer-icon" aria-hidden="true">
            S
          </span>
          <span>Last send</span>
        </span>
        <strong>Idle</strong>
      </footer>
    </div>
  )
}

function StitchlyNode({ data, dragging, selected }) {
  const card = data.card
  const hovered = Boolean(data.uiState?.interaction?.hovered)

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
  return buildWorkflowNodeCardClassName('workflow-node-card--input-literal', {
    dragging,
    hovered,
    selected
  })
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
