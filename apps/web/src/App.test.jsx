import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

vi.mock('./components/CanvasWorkspace', () => ({
  default: function CanvasWorkspaceMock() {
    return <div data-testid="canvas-workspace">Canvas workspace</div>;
  }
}));

const api = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  getSession: vi.fn(),
  getWorkspaceRuns: vi.fn(),
  login: vi.fn(),
  logout: vi.fn()
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
    api.getSession.mockReset();
    api.getWorkspaceRuns.mockReset();
    api.login.mockReset();
    api.logout.mockReset();
    api.getSession.mockResolvedValue(UNAUTHENTICATED_SESSION);
    api.getWorkspaceRuns.mockResolvedValue({ runs: [] });
  });

  it('shows the login route by default and enters workspace overview after sign-in', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /log in/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText(/real shell is now active/i)).toBeInTheDocument();
  });

  it('navigates to the canvas route with a collapsed overlay rail and workspace pill', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open canvas/i }));

    await waitFor(() => {
      expect(container.querySelector('.dashboard-app--canvas')).not.toBeNull();
    });

    expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
    expect(container.querySelector('.workspace-stage__viewport--canvas-route')).not.toBeNull();
    expect(container.querySelector('.dashboard-app--sidebar-collapsed')).not.toBeNull();
    expect(screen.getByText('Default Workspace')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desktop' })).toBeNull();
    expect(screen.queryByRole('button', { name: /expand sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull();
  });

  it('opens the canvas node shelf on click from the collapsed rail', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open canvas/i }));

    const outputButton = await screen.findByRole('button', { name: 'Output' });
    expect(outputButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(outputButton);

    expect(outputButton).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.dashboard-node-group.is-open')).not.toBeNull();
    expect(screen.getByText('Preview Output')).toBeInTheDocument();
    expect(screen.getByText('Send Email')).toBeInTheDocument();
  });

  it('closes the active canvas node shelf after a drag operation ends', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open canvas/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Output' }));

    const sendEmailShelfItem = await screen.findByRole('button', { name: 'Send Email' });
    fireEvent.dragEnd(sendEmailShelfItem);

    await waitFor(() => {
      expect(container.querySelector('.dashboard-node-group.is-open')).toBeNull();
    });

    expect(screen.queryByText('Preview Output')).toBeNull();
  });

  it('uses the collapsed rail as the default sidebar state without a visible toggle', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(container.querySelector('.dashboard-app--sidebar-collapsed')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /expand sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull();
  });

  it('collapses the attention panel to a compact summary', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/orders import failed/i)).toBeInTheDocument();
    expect(screen.getByText(/pending approvals/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /collapse attention panel/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand attention panel/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/3 active items/i)).toBeInTheDocument();
    expect(screen.queryByText(/pending approvals/i)).toBeNull();
  });
});
