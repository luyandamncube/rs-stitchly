import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlow
} from '@xyflow/react'
import {
  canConnect,
  connectWorkflowNodes,
  createCanvasElements,
  reconnectWorkflowEdge,
  syncWorkflowEdges,
  syncWorkflowNodes
} from '../lib/workflow'

const EMPTY_CANVAS_DEBUG_STATE = {
  activeNodeId: null,
  blockerElement: null,
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
  nodeDefinitions = [],
  onDebugStateChange,
  onNodeOpen,
  onSelectionChange,
  onWorkflowChange,
  selectedNodeId = null,
  workflow
}) {
  const debugSignatureRef = useRef('')
  const [selectedEdgeId, setSelectedEdgeId] = useState(null)

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
      onDebugStateChange(nextState)
    },
    [onDebugStateChange]
  )

  const inspectCanvas = useCallback(
    (event, preferredNodeId = selectedNodeId) => {
      if (!onDebugStateChange || typeof document === 'undefined') {
        return
      }

      const pointer = pointForEvent(event)
      const stack = pointer ? document.elementsFromPoint(pointer.x, pointer.y).slice(0, 8) : []
      const topElement = stack[0] ?? null
      const activeNodeId = findActiveNodeId(stack, preferredNodeId, selectedNodeId)
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
        activeNodeId,
        blockerElement:
          nodeElement instanceof Element && topElement instanceof Element && !topElementInsideNode
            ? describeCanvasElement(topElement)
            : null,
        nodeFocusMatch: Boolean(nodeElement?.matches(':focus')),
        nodeHoverMatch: Boolean(nodeElement?.matches(':hover')),
        nodeRect,
        nodeSelectedState: activeNodeId != null && activeNodeId === selectedNodeId,
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
    [onDebugStateChange, publishDebugState, selectedNodeId]
  )

  const handleCanvasPointerMove = useCallback(
    (event) => {
      inspectCanvas(event)
    },
    [inspectCanvas]
  )

  const handleCanvasPointerLeave = useCallback(() => {
    publishDebugState(EMPTY_CANVAS_DEBUG_STATE)
  }, [publishDebugState])

  const handleNodeClick = useCallback(
    (event, node) => {
      setSelectedEdgeId(null)
      onSelectionChange?.(node.id)
      inspectCanvas(event, node.id)
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
      inspectCanvas(event, node.id)
    },
    [inspectCanvas]
  )

  const handleNodeMouseLeave = useCallback(
    (event, node) => {
      inspectCanvas(event, selectedNodeId)
    },
    [inspectCanvas, selectedNodeId]
  )

  const handlePaneClick = useCallback(
    (event) => {
      setSelectedEdgeId(null)
      onSelectionChange?.(null)
      inspectCanvas(event, null)
    },
    [inspectCanvas, onSelectionChange]
  )

  const handleEdgeClick = useCallback(
    (event, edge) => {
      setSelectedEdgeId(edge.id)
      onSelectionChange?.(null)
      inspectCanvas(event, null)
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
      onWorkflowChange(connectWorkflowNodes(workflow, connection))
    },
    [nodeDefinitions, onWorkflowChange, workflow]
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
      onWorkflowChange(reconnectWorkflowEdge(workflow, oldEdge.id, connection))
    },
    [nodeDefinitions, onWorkflowChange, workflow]
  )

  return (
    <div
      className="canvas-surface"
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
            strokeWidth: 2.6
          },
          type: 'bezier'
        }}
        defaultViewport={{
          x: 0,
          y: 0,
          zoom: 1
        }}
        edges={edges}
        edgesReconnectable
        isValidConnection={(connection) => canConnect(connection, workflow, nodeDefinitions)}
        maxZoom={1}
        minZoom={1}
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        onConnect={handleConnect}
        onEdgeClick={handleEdgeClick}
        onEdgesChange={handleEdgesChange}
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

export default memo(WorkflowCanvas)
