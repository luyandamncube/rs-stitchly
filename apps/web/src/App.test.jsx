import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

vi.mock('./components/CanvasWorkspace', () => ({
  default: function CanvasWorkspaceMock() {
    return <div data-testid="canvas-workspace">Canvas workspace</div>;
  }
}));

const api = vi.hoisted(() => ({
  createWorkflow: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkflow: vi.fn(),
  getSession: vi.fn(),
  getWorkflow: vi.fn(),
  getWorkflows: vi.fn(),
  getWorkflowState: vi.fn(),
  getWorkspaceRuns: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowState: vi.fn()
}));

vi.mock('./lib/api', () => api);

const UNAUTHENTICATED_SESSION = {
  authenticated: false,
  active_workspace_id: null,
  user: null,
  workspaces: []
};

const AUTHENTICATED_SESSION = {
  authenticated: true,
  active_workspace_id: 'ws_default',
  user: {
    user_id: 'usr_builder',
    email: 'builder@stitchly.dev',
    display_name: 'Builder'
  },
  workspaces: [
    {
      workspace_id: 'ws_default',
      slug: 'default-workspace',
      name: 'Default Workspace',
      role: 'owner'
    }
  ]
};

describe('App platform shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    api.createWorkspace.mockReset();
    api.createWorkflow.mockReset();
    api.deleteWorkflow.mockReset();
    api.getSession.mockReset();
    api.getWorkflow.mockReset();
    api.getWorkflows.mockReset();
    api.getWorkflowState.mockReset();
    api.getWorkspaceRuns.mockReset();
    api.login.mockReset();
    api.logout.mockReset();
    api.updateWorkflow.mockReset();
    api.updateWorkflowState.mockReset();
    api.getSession.mockResolvedValue(UNAUTHENTICATED_SESSION);
    api.getWorkflowState.mockResolvedValue({ last_opened_workflow_id: null });
    api.getWorkflows.mockResolvedValue({ workflows: [] });
    api.getWorkspaceRuns.mockResolvedValue({ runs: [] });
    api.updateWorkflowState.mockResolvedValue({ last_opened_workflow_id: null });
  });

  it('shows the login route by default and enters the canvas after sign-in', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /log in/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
    });
  });

  it('navigates to the canvas home route with a collapsed overlay rail', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(container.querySelector('.dashboard-app--canvas')).not.toBeNull();
    });

    expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
    expect(container.querySelector('.workspace-stage__viewport--canvas-route')).not.toBeNull();
    expect(container.querySelector('.dashboard-app--sidebar-collapsed')).not.toBeNull();
    expect(container.querySelector('.canvas-menu')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Desktop' })).toBeNull();
    expect(screen.queryByRole('button', { name: /expand sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Runs' })).toBeNull();
  });

  it('resolves a direct /flow/:workflowId route through the session workspaces', async () => {
    api.getSession.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: 'Nd5Mg8S0YK4devRg1YCkIO',
        workspace_id: 'ws_default',
        name: 'Resolved Workflow',
        description: 'Resolved from direct route.',
        version: 1,
        updated_at: '2026-05-24T10:00:00Z'
      },
      definition: {
        workflow_id: 'Nd5Mg8S0YK4devRg1YCkIO',
        version: 1,
        schema_version: 1,
        name: 'Resolved Workflow',
        description: 'Resolved from direct route.',
        nodes: [],
        edges: [],
        metadata: { viewport: { x: 0, y: 0, zoom: 1 } }
      }
    });
    window.history.replaceState({}, '', '/flow/Nd5Mg8S0YK4devRg1YCkIO');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
    });

    expect(api.getWorkflow).toHaveBeenCalledWith(
      'ws_default',
      'Nd5Mg8S0YK4devRg1YCkIO'
    );
  });

  it('opens the canvas node shelf on click from the collapsed rail', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const outputButton = await screen.findByRole('button', { name: 'Output' });
    expect(outputButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(outputButton);

    expect(outputButton).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.canvas-menu.is-open')).not.toBeNull();
    expect(screen.getByText('Preview Output')).toBeInTheDocument();
    expect(screen.getByText('Send Email')).toBeInTheDocument();
  });

  it('opens the workflow popup on click from the collapsed rail', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const workflowsButton = await screen.findByRole('button', { name: 'Workflows' });
    expect(workflowsButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(workflowsButton);

    expect(workflowsButton).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.canvas-menu.is-open')).not.toBeNull();
    expect(screen.getByLabelText('Workflow window')).toBeInTheDocument();
    expect(screen.getByText('Recent workflows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage workflows' })).toBeInTheDocument();
  });

  it('opens the brand menu popup from the top logo button', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const brandButton = await screen.findByRole('button', { name: 'Stitchly' });
    expect(brandButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(brandButton);

    expect(brandButton).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.canvas-menu.is-open')).not.toBeNull();
    expect(screen.getByLabelText('App menu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open recent/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preferences/i })).toBeInTheDocument();
  });

  it('creates a new workflow and opens it in a new tab from the brand menu', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.createWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: 'tFRXIL9X4YxHMVYqbeFH2T',
        workspace_id: 'ws_default',
        name: 'Blank Workflow',
        description: 'A blank workflow ready for new nodes and connections.',
        version: 1,
        updated_at: '2026-05-24T10:00:00Z'
      },
      definition: {
        workflow_id: 'tFRXIL9X4YxHMVYqbeFH2T',
        version: 1,
        schema_version: 1,
        name: 'Blank Workflow',
        description: 'A blank workflow ready for new nodes and connections.',
        nodes: [],
        edges: [],
        metadata: { viewport: { x: 0, y: 0, zoom: 1 } }
      }
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stitchly' }));
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));

    await waitFor(() => {
      expect(api.createWorkflow).toHaveBeenCalled();
    });

    expect(openSpy).toHaveBeenCalledWith(
      '/flow/tFRXIL9X4YxHMVYqbeFH2T',
      '_blank',
      'noopener'
    );
    await waitFor(() => {
      expect(screen.queryByLabelText('App menu')).toBeNull();
    });

    openSpy.mockRestore();
  });

  it('opens a recent workflow in the current tab from the brand menu', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkflows.mockResolvedValue({
      workflows: [
        {
          workflow_id: 'Nd5Mg8S0YK4devRg1YCkIO',
          workspace_id: 'ws_default',
          name: 'Refund review',
          description: 'Ops response and notification flow.',
          version: 3,
          updated_at: '2026-05-24T10:00:00Z'
        },
        {
          workflow_id: 'tFRXIL9X4YxHMVYqbeFH2T',
          workspace_id: 'ws_default',
          name: 'Billing sync',
          description: 'Scheduled compute and output chain.',
          version: 2,
          updated_at: '2026-05-23T09:00:00Z'
        }
      ]
    });
    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: 'Nd5Mg8S0YK4devRg1YCkIO',
        workspace_id: 'ws_default',
        name: 'Refund review',
        description: 'Ops response and notification flow.',
        version: 3,
        updated_at: '2026-05-24T10:00:00Z'
      },
      definition: {
        workflow_id: 'Nd5Mg8S0YK4devRg1YCkIO',
        version: 3,
        schema_version: 1,
        name: 'Refund review',
        description: 'Ops response and notification flow.',
        nodes: [],
        edges: [],
        metadata: { viewport: { x: 0, y: 0, zoom: 1 } }
      }
    });

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stitchly' }));
    fireEvent.click(screen.getByRole('button', { name: /open recent/i }));

    expect(await screen.findByLabelText('Recent workflows')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refund review/i }));

    await waitFor(() => {
      expect(api.updateWorkflowState).toHaveBeenCalledWith(
        'ws_default',
        'Nd5Mg8S0YK4devRg1YCkIO'
      );
    });
    expect(window.location.pathname).toBe('/flow/Nd5Mg8S0YK4devRg1YCkIO');
  });

  it('closes the active canvas node shelf after a drag operation ends', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Output' }));

    const sendEmailShelfItem = await screen.findByRole('button', { name: 'Send Email' });
    fireEvent.dragEnd(sendEmailShelfItem);

    await waitFor(() => {
      expect(container.querySelector('.canvas-menu__drawer')).toBeNull();
    });

    expect(screen.queryByText('Preview Output')).toBeNull();
  });

  it('uses the collapsed rail as the default sidebar state without a visible toggle', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
    });
    expect(container.querySelector('.dashboard-app--sidebar-collapsed')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /expand sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull();
  });

  it('collapses the attention panel to a compact summary', async () => {
    api.getSession.mockResolvedValue(AUTHENTICATED_SESSION);
    window.history.replaceState({}, '', '/w/default-workspace/workflows');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
    expect(screen.getByText(/orders import failed/i)).toBeInTheDocument();
    expect(screen.getByText(/pending approvals/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /collapse attention panel/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand attention panel/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/3 active items/i)).toBeInTheDocument();
    expect(screen.queryByText(/pending approvals/i)).toBeNull();
  });

  it('creates a starter workflow and opens its explicit canvas route', async () => {
    api.getSession.mockResolvedValue(AUTHENTICATED_SESSION);
    window.history.replaceState({}, '', '/w/default-workspace/workflows');
    api.createWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: 'tFRXIL9X4YxHMVYqbeFH2T',
        workspace_id: 'ws_default',
        name: 'Starter Workflow',
        description: 'A starter workflow with text input feeding the send email node.',
        version: 1,
        updated_at: '2026-05-24T10:00:00Z'
      },
      definition: {
        workflow_id: 'tFRXIL9X4YxHMVYqbeFH2T',
        version: 1,
        schema_version: 1,
        name: 'Starter Workflow',
        description: 'A starter workflow with text input feeding the send email node.',
        nodes: [],
        edges: [],
        metadata: { viewport: { x: 0, y: 0, zoom: 1 } }
      }
    });

    const { container } = render(<App />);

    expect(await screen.findByRole('heading', { name: 'Workflows' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create starter workflow/i }));

    await waitFor(() => {
      expect(container.querySelector('.dashboard-app--canvas')).not.toBeNull();
    });

    expect(api.updateWorkflowState).toHaveBeenCalledWith(
      'ws_default',
      'tFRXIL9X4YxHMVYqbeFH2T'
    );
    expect(window.location.pathname).toBe('/flow/tFRXIL9X4YxHMVYqbeFH2T');
    expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
  });
});
