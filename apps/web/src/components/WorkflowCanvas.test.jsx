import { fireEvent, render, screen } from '@testing-library/react';
import WorkflowCanvas, {
  candidateConnectionStateForTarget,
  buildDragFrame,
  buildSandboxClassName,
  CanvasStateSandbox
} from './WorkflowCanvas';

describe('CanvasStateSandbox', () => {
  it('maps resolved interaction state to sandbox classes', () => {
    const className = buildSandboxClassName({
      connection: 'none',
      interaction: {
        dragging: true,
        focused: true,
        hovered: true,
        pressed: false,
        selected: true
      },
      runtime: 'idle',
      validation: 'valid'
    });

    expect(className).toContain('canvas-state-sandbox');
    expect(className).toContain('is-hovered');
    expect(className).toContain('is-selected');
    expect(className).toContain('is-dragging');
    expect(className).toContain('is-focused');
  });

  it('renders the sandbox as a plain focusable canvas element', () => {
    render(
      <CanvasStateSandbox
        label="Sandbox A"
        resolvedState={{
          connection: 'target-valid',
          interaction: {
            dragging: false,
            focused: false,
            hovered: false,
            pressed: false,
            selected: false
          },
          runtime: 'running',
          validation: 'warning'
        }}
      />
    );

    const sandbox = screen.getByText('Sandbox A');
    const connectionHandle = screen.getByRole('button', { name: 'Sandbox A source handle' });
    const targetHandle = screen.getByRole('button', { name: 'Sandbox A target handle' });

    expect(sandbox).toHaveClass('canvas-state-sandbox');
    expect(connectionHandle).toHaveClass('canvas-state-sandbox__handle');
    expect(targetHandle).toHaveClass('canvas-state-sandbox__handle');
    expect(sandbox).toHaveAttribute('aria-selected', 'false');
    expect(sandbox).toHaveAttribute('data-sandbox-id', 'sandbox');
    expect(sandbox).toHaveAttribute('data-connection-state', 'target-valid');
    expect(sandbox).toHaveAttribute('data-runtime-state', 'running');
    expect(sandbox).toHaveAttribute('data-validation-state', 'warning');
    expect(sandbox).toHaveAttribute('tabindex', '0');
  });

  it('selects the sandbox on pointer down and clears selection on empty canvas press', () => {
    const sandboxState = {
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

    const { container } = render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandbox = screen.getByText('Sandbox A');
    const canvasSurface = container.querySelector('.canvas-surface');

    expect(canvasSurface).not.toBeNull();
    expect(sandbox).not.toHaveClass('is-selected');

    fireEvent.pointerDown(sandbox);

    expect(sandbox).toHaveClass('is-selected');
    expect(sandbox).not.toHaveClass('is-focused');
    expect(sandbox).toHaveAttribute('aria-selected', 'true');

    fireEvent.pointerDown(canvasSurface);

    expect(sandbox).not.toHaveClass('is-selected');
    expect(sandbox).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps selection exclusive between the two sandbox nodes', () => {
    const sandboxState = {
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

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');

    fireEvent.pointerDown(sandboxA);

    expect(sandboxA).toHaveAttribute('aria-selected', 'true');
    expect(sandboxB).toHaveAttribute('aria-selected', 'false');

    fireEvent.pointerDown(sandboxB);

    expect(sandboxA).toHaveAttribute('aria-selected', 'false');
    expect(sandboxB).toHaveAttribute('aria-selected', 'true');
  });

  it('applies warning only to the currently selected sandbox node', () => {
    const sandboxState = {
      connection: 'none',
      interaction: {
        dragging: false,
        forceFocused: false,
        forceHovered: false,
        forcePressed: false,
        selected: false
      },
      runtime: 'idle',
      validation: 'warning'
    };

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');

    expect(sandboxA).toHaveAttribute('data-validation-state', 'valid');
    expect(sandboxB).toHaveAttribute('data-validation-state', 'valid');

    fireEvent.pointerDown(sandboxA);

    expect(sandboxA).toHaveAttribute('data-validation-state', 'warning');
    expect(sandboxB).toHaveAttribute('data-validation-state', 'valid');

    fireEvent.pointerDown(sandboxB);

    expect(sandboxA).toHaveAttribute('data-validation-state', 'valid');
    expect(sandboxB).toHaveAttribute('data-validation-state', 'warning');
  });

  it('applies error only to the currently selected sandbox node', () => {
    const sandboxState = {
      connection: 'none',
      interaction: {
        dragging: false,
        forceFocused: false,
        forceHovered: false,
        forcePressed: false,
        selected: false
      },
      runtime: 'idle',
      validation: 'error'
    };

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');

    expect(sandboxA).toHaveAttribute('data-validation-state', 'valid');
    expect(sandboxB).toHaveAttribute('data-validation-state', 'valid');

    fireEvent.pointerDown(sandboxB);

    expect(sandboxA).toHaveAttribute('data-validation-state', 'valid');
    expect(sandboxB).toHaveAttribute('data-validation-state', 'error');

    fireEvent.pointerDown(sandboxA);

    expect(sandboxA).toHaveAttribute('data-validation-state', 'error');
    expect(sandboxB).toHaveAttribute('data-validation-state', 'valid');
  });

  it('applies queued runtime state only to the currently selected sandbox node', () => {
    const sandboxState = {
      connection: 'none',
      interaction: {
        dragging: false,
        forceFocused: false,
        forceHovered: false,
        forcePressed: false,
        selected: false
      },
      runtime: 'queued',
      validation: 'valid'
    };

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');

    fireEvent.pointerDown(sandboxA);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'queued');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');

    fireEvent.pointerDown(sandboxB);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'queued');
  });

  it('applies running runtime state only to the currently selected sandbox node', () => {
    const sandboxState = {
      connection: 'none',
      interaction: {
        dragging: false,
        forceFocused: false,
        forceHovered: false,
        forcePressed: false,
        selected: false
      },
      runtime: 'running',
      validation: 'valid'
    };

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');

    fireEvent.pointerDown(sandboxB);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'running');

    fireEvent.pointerDown(sandboxA);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'running');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');
  });

  it('applies succeeded runtime state only to the currently selected sandbox node', () => {
    const sandboxState = {
      connection: 'none',
      interaction: {
        dragging: false,
        forceFocused: false,
        forceHovered: false,
        forcePressed: false,
        selected: false
      },
      runtime: 'succeeded',
      validation: 'valid'
    };

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');

    fireEvent.pointerDown(sandboxA);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'succeeded');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');

    fireEvent.pointerDown(sandboxB);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'succeeded');
  });

  it('applies failed runtime state only to the currently selected sandbox node', () => {
    const sandboxState = {
      connection: 'none',
      interaction: {
        dragging: false,
        forceFocused: false,
        forceHovered: false,
        forcePressed: false,
        selected: false
      },
      runtime: 'failed',
      validation: 'valid'
    };

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');

    fireEvent.pointerDown(sandboxB);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'failed');

    fireEvent.pointerDown(sandboxA);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'failed');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');
  });

  it('applies skipped runtime state only to the currently selected sandbox node', () => {
    const sandboxState = {
      connection: 'none',
      interaction: {
        dragging: false,
        forceFocused: false,
        forceHovered: false,
        forcePressed: false,
        selected: false
      },
      runtime: 'skipped',
      validation: 'valid'
    };

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');

    fireEvent.pointerDown(sandboxA);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'skipped');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'idle');

    fireEvent.pointerDown(sandboxB);

    expect(sandboxA).toHaveAttribute('data-runtime-state', 'idle');
    expect(sandboxB).toHaveAttribute('data-runtime-state', 'skipped');
  });

  it('shows pressed only during active pointer contact and clears it on release or cancel', () => {
    const sandboxState = {
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

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandbox = screen.getByText('Sandbox A');

    fireEvent.pointerDown(sandbox);

    expect(sandbox).toHaveClass('is-pressed');
    expect(sandbox).toHaveClass('is-selected');

    fireEvent.pointerUp(sandbox);

    expect(sandbox).not.toHaveClass('is-pressed');
    expect(sandbox).toHaveClass('is-selected');

    fireEvent.pointerDown(sandbox);

    expect(sandbox).toHaveClass('is-pressed');

    fireEvent.pointerCancel(sandbox);

    expect(sandbox).not.toHaveClass('is-pressed');
    expect(sandbox).toHaveClass('is-selected');
  });

  it('enters source-active connection state from the handle and clears it on pointer release', () => {
    const sandboxState = {
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

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandbox = screen.getByText('Sandbox A');
    const connectionHandle = screen.getByRole('button', { name: 'Sandbox A source handle' });

    fireEvent.pointerDown(connectionHandle, { clientX: 140, clientY: 120, pointerId: 7 });

    expect(sandbox).toHaveAttribute('data-connection-state', 'source-active');
    expect(sandbox).toHaveAttribute('aria-selected', 'true');
    expect(sandbox).not.toHaveClass('is-pressed');
    expect(sandbox).not.toHaveClass('is-dragging');

    fireEvent.pointerUp(window, { clientX: 160, clientY: 126, pointerId: 7 });

    expect(sandbox).toHaveAttribute('data-connection-state', 'none');
  });

  it('enters target-valid when an active source gesture reaches the target handle', () => {
    const sandboxState = {
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

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');
    const sourceHandle = screen.getByRole('button', { name: 'Sandbox A source handle' });
    const targetHandle = screen.getByRole('button', { name: 'Sandbox B target handle' });

    fireEvent.pointerDown(sourceHandle, { clientX: 140, clientY: 120, pointerId: 8 });

    expect(sandboxA).toHaveAttribute('data-connection-state', 'source-active');
    expect(sandboxB).toHaveAttribute('data-connection-state', 'none');

    fireEvent.pointerEnter(targetHandle, { clientX: 96, clientY: 118, pointerId: 8 });

    expect(sandboxA).toHaveAttribute('data-connection-state', 'source-active');
    expect(sandboxB).toHaveAttribute('data-connection-state', 'target-valid');

    fireEvent.pointerLeave(targetHandle, { clientX: 90, clientY: 118, pointerId: 8 });

    expect(sandboxA).toHaveAttribute('data-connection-state', 'source-active');
    expect(sandboxB).toHaveAttribute('data-connection-state', 'none');

    fireEvent.pointerEnter(targetHandle, { clientX: 96, clientY: 118, pointerId: 8 });
    fireEvent.pointerUp(window, { clientX: 96, clientY: 118, pointerId: 8 });

    expect(sandboxA).toHaveAttribute('data-connection-state', 'none');
    expect(sandboxB).toHaveAttribute('data-connection-state', 'none');
  });

  it('enters target-invalid when an incompatible source gesture reaches the target handle', () => {
    const sandboxState = {
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

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandboxA = screen.getByText('Sandbox A');
    const sandboxB = screen.getByText('Sandbox B');
    const sourceHandle = screen.getByRole('button', { name: 'Sandbox B source handle' });
    const targetHandle = screen.getByRole('button', { name: 'Sandbox A target handle' });

    fireEvent.pointerDown(sourceHandle, { clientX: 360, clientY: 260, pointerId: 9 });

    expect(sandboxB).toHaveAttribute('data-connection-state', 'source-active');
    expect(sandboxA).toHaveAttribute('data-connection-state', 'none');

    fireEvent.pointerEnter(targetHandle, { clientX: 96, clientY: 118, pointerId: 9 });

    expect(sandboxB).toHaveAttribute('data-connection-state', 'source-active');
    expect(sandboxA).toHaveAttribute('data-connection-state', 'target-invalid');

    fireEvent.pointerLeave(targetHandle, { clientX: 88, clientY: 116, pointerId: 9 });

    expect(sandboxB).toHaveAttribute('data-connection-state', 'source-active');
    expect(sandboxA).toHaveAttribute('data-connection-state', 'none');

    fireEvent.pointerEnter(targetHandle, { clientX: 96, clientY: 118, pointerId: 9 });
    fireEvent.pointerUp(window, { clientX: 96, clientY: 118, pointerId: 9 });

    expect(sandboxA).toHaveAttribute('data-connection-state', 'none');
    expect(sandboxB).toHaveAttribute('data-connection-state', 'none');
  });

  it('computes preview and handle candidate states for connection targets', () => {
    expect(candidateConnectionStateForTarget('sandbox_a', 'sandbox_b')).toBe('preview');
    expect(candidateConnectionStateForTarget('sandbox_a', 'sandbox_b', 'handle')).toBe('target-valid');
    expect(candidateConnectionStateForTarget('sandbox_b', 'sandbox_a')).toBe('preview');
    expect(candidateConnectionStateForTarget('sandbox_b', 'sandbox_a', 'handle')).toBe('target-invalid');
    expect(candidateConnectionStateForTarget('sandbox_a', 'sandbox_a')).toBe('none');
  });

  it('computes dragging frames after the movement threshold is crossed', () => {
    const session = {
      startOffset: { x: 0, y: 0 },
      startPointer: { x: 20, y: 30 }
    };

    const nearFrame = buildDragFrame(session, { x: 23, y: 34 });
    const dragFrame = buildDragFrame(session, { x: 48, y: 57 });
    const continuingFrame = buildDragFrame(session, { x: 22, y: 33 }, true);

    expect(nearFrame).toEqual({
      deltaX: 3,
      deltaY: 4,
      dragging: false,
      offset: { x: 0, y: 0 }
    });

    expect(dragFrame).toEqual({
      deltaX: 28,
      deltaY: 27,
      dragging: true,
      offset: { x: 28, y: 27 }
    });

    expect(continuingFrame).toEqual({
      deltaX: 2,
      deltaY: 3,
      dragging: true,
      offset: { x: 2, y: 3 }
    });
  });

  it('applies focused state for keyboard focus and clears it on blur', () => {
    const sandboxState = {
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

    render(<WorkflowCanvas sandboxState={sandboxState} />);

    const sandbox = screen.getByText('Sandbox A');

    fireEvent.keyDown(window, { key: 'Tab' });
    fireEvent.focus(sandbox);

    expect(sandbox).toHaveClass('is-focused');
    expect(sandbox).not.toHaveClass('is-selected');

    fireEvent.blur(sandbox);

    expect(sandbox).not.toHaveClass('is-focused');
  });

  it('does not crash debug inspection when focus events have no pointer coordinates', () => {
    const sandboxState = {
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

    const onDebugStateChange = vi.fn();

    render(<WorkflowCanvas onDebugStateChange={onDebugStateChange} sandboxState={sandboxState} />);

    const sandbox = screen.getByText('Sandbox A');

    expect(() => fireEvent.focus(sandbox)).not.toThrow();
    expect(onDebugStateChange).toHaveBeenCalled();
  });
});
