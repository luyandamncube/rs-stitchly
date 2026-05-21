import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Background, MiniMap, ReactFlow } from '@xyflow/react';

const DRAG_THRESHOLD_PX = 6;
const SANDBOX_NODE_DEFS = [
  {
    id: 'sandbox_a',
    icon: '*',
    label: 'Sandbox A',
    rows: [
      { icon: 'o', kind: 'pill', label: 'Surface', value: 'Node shell' },
      { icon: '·', kind: 'plain', label: 'Scope', value: 'Phase 1A' }
    ],
    subtitle: 'Trigger shell',
    topChip: 'Start',
    footer: { icon: 'o', label: 'Status', value: 'Ready' },
    left: 'clamp(24px, 12vw, 220px)',
    top: 'clamp(132px, 24vh, 180px)'
  },
  {
    id: 'sandbox_b',
    icon: '<>',
    label: 'Sandbox B',
    rows: [
      { icon: 'o', kind: 'pill', label: 'Surface', value: 'Node shell' },
      { icon: '·', kind: 'plain', label: 'Scope', value: 'Phase 1A' }
    ],
    subtitle: 'Compute shell',
    topChip: null,
    footer: { icon: 'o', label: 'Status', value: 'Ready' },
    left: 'clamp(280px, 48vw, 620px)',
    top: 'clamp(236px, 42vh, 320px)'
  }
];
const DEFAULT_SANDBOX_BROWSER_STATE = {
  connection: 'none',
  dragging: false,
  focused: false,
  hovered: false,
  pressed: false,
  selected: false
};

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

function WorkflowCanvas({
  onDebugStateChange,
  sandboxResetKey,
  sandboxState
}) {
  const [sandboxBrowserState, setSandboxBrowserState] = useState(buildInitialSandboxBrowserState);
  const [sandboxOffsets, setSandboxOffsets] = useState(buildInitialSandboxOffsets);
  const debugSignatureRef = useRef('');
  const lastPointerRef = useRef(null);
  const interactionModalityRef = useRef('pointer');
  const dragSessionRef = useRef(null);
  const connectionSessionRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    function handleWindowKeyDown() {
      interactionModalityRef.current = 'keyboard';
    }

    function handleWindowPointerDown() {
      interactionModalityRef.current = 'pointer';
    }

    window.addEventListener('keydown', handleWindowKeyDown, true);
    window.addEventListener('pointerdown', handleWindowPointerDown, true);

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown, true);
      window.removeEventListener('pointerdown', handleWindowPointerDown, true);
    };
  }, []);

  const publishDebugState = useCallback(
    (nextState) => {
      if (!onDebugStateChange) {
        return;
      }

      const nextSignature = JSON.stringify(nextState);
      if (nextSignature === debugSignatureRef.current) {
        return;
      }

      debugSignatureRef.current = nextSignature;
      onDebugStateChange(nextState);
    },
    [onDebugStateChange]
  );

  useEffect(() => {
    dragSessionRef.current = null;
    connectionSessionRef.current = null;
    lastPointerRef.current = null;
    setSandboxOffsets(buildInitialSandboxOffsets());
    setSandboxBrowserState(buildInitialSandboxBrowserState());
    publishDebugState(EMPTY_CANVAS_DEBUG_STATE);
  }, [publishDebugState, sandboxResetKey]);

  const resolvedSandboxStates = Object.fromEntries(
    SANDBOX_NODE_DEFS.map((sandboxNode) => {
      const browserState = sandboxBrowserState[sandboxNode.id] ?? createSandboxBrowserState();

      return [
        sandboxNode.id,
        resolveSandboxState(sandboxState, browserState, {
          applyDataStates: browserState.selected
        })
      ];
    })
  );

  const inspectCanvas = useCallback(
    (event, nextBrowserState = sandboxBrowserState) => {
      if (!onDebugStateChange || typeof document === 'undefined') {
        return;
      }

      const sandboxElements = Array.from(
        document.querySelectorAll('.canvas-state-sandbox[data-sandbox-id]')
      );
      const eventPointer = pointForEvent(event);
      const pointer = eventPointer ?? lastPointerRef.current;

      if (eventPointer) {
        lastPointerRef.current = eventPointer;
      }

      const stack = pointer ? document.elementsFromPoint(pointer.x, pointer.y).slice(0, 8) : [];
      const topElement = stack[0] ?? null;
      const activeSandboxId = findActiveSandboxId(stack, nextBrowserState);
      const sandboxElement =
        activeSandboxId != null
          ? sandboxElements.find((element) => element.dataset.sandboxId === activeSandboxId) ?? null
          : null;
      const topElementInsideSandbox =
        topElement instanceof Element && sandboxElement instanceof Element
          ? sandboxElement.contains(topElement) || topElement === sandboxElement
          : false;
      const sandboxRect = describeRect(sandboxElement?.getBoundingClientRect?.() ?? null);
      const activeBrowserState =
        activeSandboxId != null
          ? nextBrowserState[activeSandboxId] ?? createSandboxBrowserState()
          : createSandboxBrowserState();
      const nextResolvedState = resolveSandboxState(sandboxState, activeBrowserState, {
        applyDataStates: activeBrowserState.selected
      });

      publishDebugState({
        blockerElement:
          sandboxElement instanceof Element && topElement instanceof Element && !topElementInsideSandbox
            ? describeCanvasElement(topElement)
            : null,
        pointer: pointer ? { x: Math.round(pointer.x), y: Math.round(pointer.y) } : null,
        sandboxId: activeSandboxId,
        sandboxConnectionState: activeBrowserState.connection,
        sandboxDraggingState: activeBrowserState.dragging,
        pointerInsideSandbox: pointer ? isPointInsideRect(pointer.x, pointer.y, sandboxRect) : false,
        sandboxFocusMatch: Boolean(sandboxElement?.matches(':focus')),
        sandboxHoverMatch: Boolean(sandboxElement?.matches(':hover')),
        sandboxPressedState: activeBrowserState.pressed,
        sandboxSelectedState: activeBrowserState.selected,
        sandboxRect,
        sandboxResolvedState: nextResolvedState,
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
      });
    },
    [onDebugStateChange, publishDebugState, sandboxBrowserState, sandboxState]
  );

  const updateBrowserStateAndInspect = useCallback(
    (event, updater) => {
      setSandboxBrowserState((current) => {
        const nextState = updater(current);

        if (event) {
          inspectCanvas(event, nextState);
        }

        return nextState;
      });
    },
    [inspectCanvas]
  );

  const handleCanvasPointerLeave = useCallback(() => {
    publishDebugState(EMPTY_CANVAS_DEBUG_STATE);
  }, [publishDebugState]);

  const handleCanvasPointerMove = useCallback(
    (event) => {
      inspectCanvas(event, sandboxBrowserState);
    },
    [inspectCanvas, sandboxBrowserState]
  );

  const handleCanvasPointerDownCapture = useCallback(
    (event) => {
      interactionModalityRef.current = 'pointer';

      if (event.target instanceof Element && event.target.closest('.canvas-state-sandbox')) {
        return;
      }

      dragSessionRef.current = null;
      connectionSessionRef.current = null;
      updateBrowserStateAndInspect(event, () => buildInitialSandboxBrowserState());
    },
    [updateBrowserStateAndInspect]
  );

  const handleSandboxPointerEnter = useCallback(
    (nodeId, event) => {
      updateBrowserStateAndInspect(event, (current) => {
        const nextState = cloneSandboxBrowserStateMap(current);
        const sourceNodeId = connectionSessionRef.current?.sourceNodeId;

        nextState[nodeId] = {
          ...nextState[nodeId],
          hovered: true
        };

        if (
          sourceNodeId &&
          sourceNodeId !== nodeId &&
          nextState[nodeId].connection === 'none'
        ) {
          nextState[sourceNodeId].connection = 'source-active';
          nextState[nodeId].connection = candidateConnectionStateForTarget(sourceNodeId, nodeId);
        }

        return nextState;
      });
    },
    [updateBrowserStateAndInspect]
  );

  const handleSandboxPointerLeave = useCallback(
    (nodeId, event) => {
      updateBrowserStateAndInspect(event, (current) => {
        const nextState = cloneSandboxBrowserStateMap(current);
        const sourceNodeId = connectionSessionRef.current?.sourceNodeId;

        nextState[nodeId] = {
          ...nextState[nodeId],
          hovered: false,
          pressed: false
        };

        if (sourceNodeId && nextState[nodeId].connection === 'preview') {
          nextState[sourceNodeId].connection = 'source-active';
          nextState[nodeId].connection = 'none';
        }

        return nextState;
      });
    },
    [updateBrowserStateAndInspect]
  );

  const handleSandboxPointerDown = useCallback(
    (nodeId, event) => {
      const startPointer = pointForEvent(event);
      const startOffset = sandboxOffsets[nodeId] ?? createSandboxOffset();

      dragSessionRef.current = {
        nodeId,
        pointerId: event.pointerId,
        startOffset,
        startPointer
      };
      connectionSessionRef.current = null;

      if (typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {}
      }

      updateBrowserStateAndInspect(event, (current) => {
        const nextState = cloneSandboxBrowserStateMap(current);

        for (const sandboxNode of SANDBOX_NODE_DEFS) {
          if (sandboxNode.id !== nodeId) {
            nextState[sandboxNode.id].connection = 'none';
            nextState[sandboxNode.id].dragging = false;
            nextState[sandboxNode.id].pressed = false;
            nextState[sandboxNode.id].selected = false;
          }
        }

        nextState[nodeId] = {
          ...nextState[nodeId],
          connection: 'none',
          dragging: false,
          pressed: true,
          selected: true
        };

        return nextState;
      });
    },
    [sandboxOffsets, updateBrowserStateAndInspect]
  );

  const handleSandboxPointerUp = useCallback(
    (nodeId, event) => {
      if (dragSessionRef.current?.nodeId === nodeId) {
        dragSessionRef.current = null;
      }

      if (typeof event.currentTarget.releasePointerCapture === 'function') {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {}
      }

      updateBrowserStateAndInspect(event, (current) => ({
        ...current,
        [nodeId]: {
          ...(current[nodeId] ?? createSandboxBrowserState()),
          dragging: false,
          pressed: false
        }
      }));
    },
    [updateBrowserStateAndInspect]
  );

  const handleSandboxPointerCancel = useCallback(
    (nodeId, event) => {
      if (dragSessionRef.current?.nodeId === nodeId) {
        dragSessionRef.current = null;
      }

      if (typeof event.currentTarget.releasePointerCapture === 'function') {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {}
      }

      updateBrowserStateAndInspect(event, (current) => ({
        ...current,
        [nodeId]: {
          ...(current[nodeId] ?? createSandboxBrowserState()),
          dragging: false,
          pressed: false
        }
      }));
    },
    [updateBrowserStateAndInspect]
  );

  const handleSandboxPointerMove = useCallback(
    (nodeId, event) => {
      const session = dragSessionRef.current;
      const currentPointer = pointForEvent(event);
      const sourceNodeId = connectionSessionRef.current?.sourceNodeId;

      if (
        sourceNodeId &&
        sourceNodeId !== nodeId &&
        !session &&
        (sandboxBrowserState[nodeId]?.connection ?? 'none') === 'none'
      ) {
        updateBrowserStateAndInspect(event, (current) => {
          const nextState = cloneSandboxBrowserStateMap(current);
          nextState[sourceNodeId].connection = 'source-active';
          nextState[nodeId].connection = candidateConnectionStateForTarget(sourceNodeId, nodeId);
          return nextState;
        });
        return;
      }

      if (
        !session ||
        session.nodeId !== nodeId ||
        !pointerIdsMatch(session.pointerId, event.pointerId) ||
        !currentPointer
      ) {
        return;
      }

      if (!session.startPointer) {
        dragSessionRef.current = {
          ...session,
          startPointer: currentPointer
        };
        return;
      }

      const dragFrame = buildDragFrame(session, currentPointer, sandboxBrowserState.dragging);

      if (!dragFrame) {
        return;
      }

      if (dragFrame.dragging) {
        setSandboxOffsets((current) => ({
          ...current,
          [nodeId]: dragFrame.offset
        }));
      }

      updateBrowserStateAndInspect(event, (current) => ({
        ...current,
        [nodeId]: {
          ...(current[nodeId] ?? createSandboxBrowserState()),
          dragging: dragFrame.dragging,
          pressed: dragFrame.dragging ? false : true,
          selected: true
        }
      }));
    },
    [sandboxBrowserState, updateBrowserStateAndInspect]
  );

  const handleSandboxFocus = useCallback(
    (nodeId, event) => {
      updateBrowserStateAndInspect(event, (current) => ({
        ...current,
        [nodeId]: {
          ...(current[nodeId] ?? createSandboxBrowserState()),
          focused: interactionModalityRef.current === 'keyboard'
        }
      }));
    },
    [updateBrowserStateAndInspect]
  );

  const handleSandboxBlur = useCallback(
    (nodeId, event) => {
      updateBrowserStateAndInspect(event, (current) => ({
        ...current,
        [nodeId]: {
          ...(current[nodeId] ?? createSandboxBrowserState()),
          focused: false,
          pressed: false
        }
      }));
    },
    [updateBrowserStateAndInspect]
  );

  const handleConnectionHandlePointerDown = useCallback(
    (nodeId, event) => {
      interactionModalityRef.current = 'pointer';
      event.preventDefault();
      event.stopPropagation();
      dragSessionRef.current = null;
      connectionSessionRef.current = {
        pointerId: event.pointerId,
        sourceNodeId: nodeId
      };
      updateBrowserStateAndInspect(event, (current) => {
        const nextState = cloneSandboxBrowserStateMap(current);

        for (const sandboxNode of SANDBOX_NODE_DEFS) {
          if (sandboxNode.id !== nodeId) {
            nextState[sandboxNode.id].connection = 'none';
            nextState[sandboxNode.id].dragging = false;
            nextState[sandboxNode.id].pressed = false;
            nextState[sandboxNode.id].selected = false;
          }
        }

        nextState[nodeId] = {
          ...nextState[nodeId],
          connection: 'source-active',
          dragging: false,
          pressed: false,
          selected: true
        };

        return nextState;
      });
    },
    [updateBrowserStateAndInspect]
  );

  const handleConnectionTargetPointerDown = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleConnectionTargetPointerEnter = useCallback(
    (nodeId, event) => {
      setSandboxBrowserState((current) => {
        const sourceNodeId = connectionSessionRef.current?.sourceNodeId;

        if (!sourceNodeId || sourceNodeId === nodeId) {
          return current;
        }

        const nextState = cloneSandboxBrowserStateMap(current);
        nextState[sourceNodeId].connection = 'source-active';
        nextState[nodeId].connection = candidateConnectionStateForTarget(sourceNodeId, nodeId, 'handle');

        inspectCanvas(event, nextState);
        return nextState;
      });
    },
    [inspectCanvas]
  );

  const handleConnectionTargetPointerLeave = useCallback(
    (nodeId, event) => {
      setSandboxBrowserState((current) => {
        const sourceNodeId = connectionSessionRef.current?.sourceNodeId;

        if (
          !sourceNodeId ||
          !['target-valid', 'target-invalid'].includes(current[nodeId]?.connection)
        ) {
          return current;
        }

        const nextState = cloneSandboxBrowserStateMap(current);
        nextState[sourceNodeId].connection = 'source-active';
        nextState[nodeId].connection = candidateConnectionStateForTarget(sourceNodeId, nodeId);

        inspectCanvas(event, nextState);
        return nextState;
      });
    },
    [inspectCanvas]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    function handleWindowPointerEnd(event) {
      setSandboxBrowserState((current) => {
        const hasConnectionState = SANDBOX_NODE_DEFS.some(
          (sandboxNode) => current[sandboxNode.id]?.connection !== 'none'
        );

        if (!hasConnectionState) {
          return current;
        }

        connectionSessionRef.current = null;
        const nextState = cloneSandboxBrowserStateMap(current);

        for (const sandboxNode of SANDBOX_NODE_DEFS) {
          nextState[sandboxNode.id].connection = 'none';
        }

        inspectCanvas(event, nextState);
        return nextState;
      });
    }

    window.addEventListener('pointerup', handleWindowPointerEnd, true);
    window.addEventListener('pointercancel', handleWindowPointerEnd, true);

    return () => {
      window.removeEventListener('pointerup', handleWindowPointerEnd, true);
      window.removeEventListener('pointercancel', handleWindowPointerEnd, true);
    };
  }, [inspectCanvas]);

  return (
    <div
      className="canvas-surface"
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onPointerLeave={handleCanvasPointerLeave}
      onPointerMove={handleCanvasPointerMove}
    >
      <ReactFlow
        className="workflow-flow"
        colorMode="dark"
        defaultViewport={{
          x: 0,
          y: 0,
          zoom: 1
        }}
        defaultEdgeOptions={{
          animated: false,
          pathOptions: {
            borderRadius: 24,
            offset: 18
          },
          style: {
            stroke: 'rgba(255, 122, 26, 0.62)',
            strokeWidth: 2.6
          },
          type: 'smoothstep'
        }}
        edges={[]}
        maxZoom={1}
        minZoom={1}
        nodes={[]}
        panOnDrag={false}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        zoomOnPinch={false}
        zoomOnScroll={false}
      >
        <MiniMap pannable zoomable />
        <Background gap={24} size={1} color="rgba(255,255,255,0.06)" />
      </ReactFlow>

      {SANDBOX_NODE_DEFS.map((sandboxNode) => (
        <div
          key={sandboxNode.id}
          className="canvas-state-sandbox-shell"
          style={{
            left: sandboxNode.left,
            top: sandboxNode.top,
            transform: `translate3d(${(sandboxOffsets[sandboxNode.id] ?? createSandboxOffset()).x}px, ${(sandboxOffsets[sandboxNode.id] ?? createSandboxOffset()).y}px, 0)`
          }}
        >
          <CanvasStateSandbox
            footer={sandboxNode.footer}
            icon={sandboxNode.icon}
            label={sandboxNode.label}
            onConnectionHandlePointerDown={(event) =>
              handleConnectionHandlePointerDown(sandboxNode.id, event)
            }
            onConnectionTargetPointerDown={handleConnectionTargetPointerDown}
            onConnectionTargetPointerEnter={(event) =>
              handleConnectionTargetPointerEnter(sandboxNode.id, event)
            }
            onConnectionTargetPointerLeave={(event) =>
              handleConnectionTargetPointerLeave(sandboxNode.id, event)
            }
            onBlur={(event) => handleSandboxBlur(sandboxNode.id, event)}
            onFocus={(event) => handleSandboxFocus(sandboxNode.id, event)}
            onPointerCancel={(event) => handleSandboxPointerCancel(sandboxNode.id, event)}
            onPointerDown={(event) => handleSandboxPointerDown(sandboxNode.id, event)}
            onPointerEnter={(event) => handleSandboxPointerEnter(sandboxNode.id, event)}
            onPointerLeave={(event) => handleSandboxPointerLeave(sandboxNode.id, event)}
            onPointerMove={(event) => handleSandboxPointerMove(sandboxNode.id, event)}
            onPointerUp={(event) => handleSandboxPointerUp(sandboxNode.id, event)}
            resolvedState={resolvedSandboxStates[sandboxNode.id]}
            rows={sandboxNode.rows}
            sandboxId={sandboxNode.id}
            subtitle={sandboxNode.subtitle}
            topChip={sandboxNode.topChip}
          />
        </div>
      ))}
    </div>
  );
}

export function CanvasStateSandbox({
  footer = DEFAULT_SANDBOX_FOOTER,
  icon = '*',
  label = 'State Sandbox',
  onConnectionHandlePointerDown,
  onConnectionTargetPointerDown,
  onConnectionTargetPointerEnter,
  onConnectionTargetPointerLeave,
  onBlur,
  onFocus,
  onPointerCancel,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
  resolvedState,
  rows = DEFAULT_SANDBOX_ROWS,
  sandboxId = 'sandbox',
  subtitle = 'State sandbox',
  topChip = 'Start'
}) {
  return (
    <div
      aria-label={label}
      className={buildSandboxClassName(resolvedState)}
      aria-selected={resolvedState.interaction.selected}
      data-sandbox-id={sandboxId}
      data-connection-state={resolvedState.connection}
      data-runtime-state={resolvedState.runtime}
      data-validation-state={resolvedState.validation}
      onBlur={onBlur}
      onFocus={onFocus}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      tabIndex={0}
      title="State sandbox. Use the debug panel to toggle interaction, connection, validation, and runtime states."
    >
      <button
        aria-label={`${label} target handle`}
        className="canvas-state-sandbox__handle canvas-state-sandbox__handle--target"
        onPointerDown={onConnectionTargetPointerDown}
        onPointerEnter={onConnectionTargetPointerEnter}
        onPointerLeave={onConnectionTargetPointerLeave}
        tabIndex={-1}
        type="button"
      />
      {topChip ? <span className="canvas-state-sandbox__top-chip">{topChip}</span> : null}
      <div className="canvas-state-sandbox__frame">
        <div className="canvas-state-sandbox__header">
          <div className="canvas-state-sandbox__heading">
            <span className="canvas-state-sandbox__icon" aria-hidden="true">
              {icon}
            </span>
            <div className="canvas-state-sandbox__heading-copy">
              <strong className="canvas-state-sandbox__title">{label}</strong>
              <span className="canvas-state-sandbox__subtitle">{subtitle}</span>
            </div>
          </div>
          <span className="canvas-state-sandbox__menu" aria-hidden="true">
            ...
          </span>
        </div>

        <div className="canvas-state-sandbox__body">
          {rows.map((row) => (
            <div
              key={row.label}
              className={`canvas-state-sandbox__row canvas-state-sandbox__row--${row.kind ?? 'plain'}`}
            >
              <span className="canvas-state-sandbox__row-label">
                {row.icon ? (
                  <span className="canvas-state-sandbox__row-icon" aria-hidden="true">
                    {row.icon}
                  </span>
                ) : null}
                <span>{row.label}</span>
              </span>
              <strong className="canvas-state-sandbox__row-value">{row.value}</strong>
            </div>
          ))}
        </div>

        <div className="canvas-state-sandbox__footer">
          <span className="canvas-state-sandbox__footer-label">
            {footer.icon ? (
              <span className="canvas-state-sandbox__footer-icon" aria-hidden="true">
                {footer.icon}
              </span>
            ) : null}
            <span>{footer.label}</span>
          </span>
          <strong className="canvas-state-sandbox__footer-value">{footer.value}</strong>
        </div>
      </div>
      <button
        aria-label={`${label} source handle`}
        className="canvas-state-sandbox__handle canvas-state-sandbox__handle--source"
        onPointerDown={onConnectionHandlePointerDown}
        tabIndex={-1}
        type="button"
      />
    </div>
  );
}

const DEFAULT_SANDBOX_ROWS = [
  { icon: 'o', kind: 'pill', label: 'Surface', value: 'Node shell' },
  { icon: '·', kind: 'plain', label: 'Scope', value: 'Sandbox' }
];

const DEFAULT_SANDBOX_FOOTER = { icon: 'o', label: 'Status', value: 'Ready' };

export function buildSandboxClassName(resolvedState) {
  const classes = ['canvas-state-sandbox'];

  if (resolvedState.interaction.hovered) {
    classes.push('is-hovered');
  }

  if (resolvedState.interaction.selected) {
    classes.push('is-selected');
  }

  if (resolvedState.interaction.dragging) {
    classes.push('is-dragging');
  }

  if (resolvedState.interaction.focused) {
    classes.push('is-focused');
  }

  if (resolvedState.interaction.pressed) {
    classes.push('is-pressed');
  }

  return classes.join(' ');
}

function resolveSandboxState(sandboxState, browserState, { applyDataStates = false } = {}) {
  return {
    connection: sandboxState.connection !== 'none' ? sandboxState.connection : browserState.connection,
    interaction: {
      dragging: sandboxState.interaction.dragging || browserState.dragging,
      focused: sandboxState.interaction.forceFocused || browserState.focused,
      hovered: sandboxState.interaction.forceHovered || browserState.hovered,
      pressed: sandboxState.interaction.forcePressed || browserState.pressed,
      selected: sandboxState.interaction.selected || browserState.selected
    },
    runtime: applyDataStates ? sandboxState.runtime : 'idle',
    validation: applyDataStates ? sandboxState.validation : 'valid'
  };
}

function describeCanvasElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  return {
    className:
      typeof element.className === 'string'
        ? element.className.trim().replace(/\s+/g, ' ')
        : '',
    pointerEvents: getComputedStyle(element).pointerEvents,
    tag: element.tagName.toLowerCase(),
    zIndex: getComputedStyle(element).zIndex
  };
}

function describeRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    bottom: Math.round(rect.bottom),
    height: Math.round(rect.height),
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    top: Math.round(rect.top),
    width: Math.round(rect.width)
  };
}

function isPointInsideRect(x, y, rect) {
  if (!rect) {
    return false;
  }

  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function pointForEvent(event) {
  if (!event) {
    return null;
  }

  const x = Number(event.clientX);
  const y = Number(event.clientY);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function buildInitialSandboxBrowserState() {
  return Object.fromEntries(
    SANDBOX_NODE_DEFS.map((sandboxNode) => [sandboxNode.id, createSandboxBrowserState()])
  );
}

function buildInitialSandboxOffsets() {
  return Object.fromEntries(
    SANDBOX_NODE_DEFS.map((sandboxNode) => [sandboxNode.id, createSandboxOffset()])
  );
}

function cloneSandboxBrowserStateMap(current) {
  return Object.fromEntries(
    SANDBOX_NODE_DEFS.map((sandboxNode) => [
      sandboxNode.id,
      {
        ...(current[sandboxNode.id] ?? createSandboxBrowserState())
      }
    ])
  );
}

function createSandboxBrowserState() {
  return {
    ...DEFAULT_SANDBOX_BROWSER_STATE
  };
}

function createSandboxOffset() {
  return {
    x: 0,
    y: 0
  };
}

function findActiveSandboxId(stack, browserStateMap) {
  for (const element of stack) {
    if (!(element instanceof Element)) {
      continue;
    }

    const sandboxElement = element.closest('.canvas-state-sandbox[data-sandbox-id]');

    if (sandboxElement instanceof HTMLElement) {
      return sandboxElement.dataset.sandboxId ?? null;
    }
  }

  for (const sandboxNode of SANDBOX_NODE_DEFS) {
    if (browserStateMap[sandboxNode.id]?.hovered) {
      return sandboxNode.id;
    }
  }

  for (const sandboxNode of SANDBOX_NODE_DEFS) {
    if (browserStateMap[sandboxNode.id]?.selected) {
      return sandboxNode.id;
    }
  }

  return SANDBOX_NODE_DEFS[0]?.id ?? null;
}

function isSandboxConnectionValid(sourceNodeId, targetNodeId) {
  return sourceNodeId === 'sandbox_a' && targetNodeId === 'sandbox_b';
}

export function candidateConnectionStateForTarget(sourceNodeId, targetNodeId, targetPhase = 'node') {
  if (!sourceNodeId || sourceNodeId === targetNodeId) {
    return 'none';
  }

  if (targetPhase !== 'handle') {
    return 'preview';
  }

  return isSandboxConnectionValid(sourceNodeId, targetNodeId)
    ? 'target-valid'
    : 'target-invalid';
}

export function buildDragFrame(session, currentPointer, wasDragging = false) {
  if (!session?.startPointer || !session?.startOffset || !currentPointer) {
    return null;
  }

  const deltaX = currentPointer.x - session.startPointer.x;
  const deltaY = currentPointer.y - session.startPointer.y;
  const dragging = wasDragging || Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX;

  return {
    deltaX,
    deltaY,
    dragging,
    offset: dragging
      ? {
          x: session.startOffset.x + deltaX,
          y: session.startOffset.y + deltaY
        }
      : session.startOffset
  };
}

function pointerIdsMatch(sessionPointerId, eventPointerId) {
  const sessionId = Number(sessionPointerId);
  const eventId = Number(eventPointerId);

  if (!Number.isFinite(sessionId) || !Number.isFinite(eventId)) {
    return true;
  }

  return sessionId === eventId;
}

function breakpointForWidth(width) {
  if (width <= 720) {
    return '<=720';
  }

  if (width <= 920) {
    return '<=920';
  }

  if (width <= 1180) {
    return '<=1180';
  }

  return '>1180';
}

export default memo(WorkflowCanvas);
