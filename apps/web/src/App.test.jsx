import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

vi.mock('./components/CanvasWorkspace', () => ({
  default: function CanvasWorkspaceMock({ onOpenRunInPanel }) {
    return (
      <div data-testid="canvas-workspace">
        <span>Canvas workspace</span>
        <button
          onClick={() => onOpenRunInPanel?.('run_6734')}
          type="button"
        >
          Open latest run in panel
        </button>
      </div>
    );
  }
}));

const api = vi.hoisted(() => ({
  cancelWorkspaceRun: vi.fn(),
  connectWorkspaceGmail: vi.fn(),
  createWorkflow: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspaceCatalogTable: vi.fn(),
  deleteWorkspace: vi.fn(),
  deleteWorkflow: vi.fn(),
  getSession: vi.fn(),
  getWorkflow: vi.fn(),
  getWorkspaceCatalog: vi.fn(),
  getWorkspaceCatalogSchema: vi.fn(),
  getWorkspaceCatalogTable: vi.fn(),
  getWorkspaceConnections: vi.fn(),
  getWorkspaceRun: vi.fn(),
  getWorkspaceRunEvents: vi.fn(),
  getWorkspaceRunLogs: vi.fn(),
  getWorkflows: vi.fn(),
  getWorkflowState: vi.fn(),
  getWorkspaceRuns: vi.fn(),
  login: vi.fn(),
  loginWithGoogleCode: vi.fn(),
  logout: vi.fn(),
  previewWorkspaceCatalogTableDelete: vi.fn(),
  runWorkspaceCatalogQuery: vi.fn(),
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

const AUTHENTICATED_MULTI_WORKSPACE_SESSION = {
  ...AUTHENTICATED_SESSION,
  workspaces: [
    ...AUTHENTICATED_SESSION.workspaces,
    {
      workspace_id: 'ws_secondary',
      slug: 'warehouse-workspace',
      name: 'Warehouse Workspace',
      role: 'owner'
    }
  ]
};

const WORKSPACE_CATALOG_RESPONSE = {
  catalogs: [
    {
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_name: 'Text Preview',
      database_name: 'workflow.duckdb',
      schemas: [
        {
          schema_name: 'runs',
          table_count: 2,
          tables: [
            {
              table_name: 'workflow_runs',
              table_type: 'BASE TABLE',
              column_count: 3
            },
            {
              table_name: 'node_runs',
              table_type: 'BASE TABLE',
              column_count: 2
            }
          ]
        },
        {
          schema_name: 'staging',
          table_count: 0,
          tables: []
        },
        {
          schema_name: 'tables',
          table_count: 0,
          tables: []
        },
        {
          schema_name: 'outputs',
          table_count: 1,
          tables: [
            {
              table_name: 'node_outputs',
              table_type: 'BASE TABLE',
              column_count: 2
            }
          ]
        }
      ]
    }
  ]
};

const SECONDARY_WORKSPACE_CATALOG_RESPONSE = {
  catalogs: [
    {
      workflow_id: 'wf_warehouse_ops',
      workflow_name: 'Warehouse Ops',
      database_name: 'workflow.duckdb',
      schemas: [
        {
          schema_name: 'runs',
          table_count: 1,
          tables: [
            {
              table_name: 'workflow_runs',
              table_type: 'BASE TABLE',
              column_count: 3
            }
          ]
        },
        {
          schema_name: 'outputs',
          table_count: 1,
          tables: [
            {
              table_name: 'node_outputs',
              table_type: 'BASE TABLE',
              column_count: 2
            }
          ]
        }
      ]
    }
  ]
};

const WORKSPACE_CATALOG_TABLE_RESPONSE = {
  workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
  workflow_name: 'Text Preview',
  database_name: 'workflow.duckdb',
  schema_name: 'runs',
  table_name: 'workflow_runs',
  columns: [
    {
      column_name: 'run_id',
      data_type: 'VARCHAR',
      nullable: false,
      description: null
    },
    {
      column_name: 'workflow_id',
      data_type: 'VARCHAR',
      nullable: false,
      description: null
    },
    {
      column_name: 'status',
      data_type: 'VARCHAR',
      nullable: false,
      description: null
    }
  ],
  sample_rows: [['run_1', 'ScJUvQ7dgxHqu7tXtsekiL', 'succeeded']]
};

const WORKSPACE_CATALOG_NODE_RUNS_TABLE_RESPONSE = {
  workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
  workflow_name: 'Text Preview',
  database_name: 'workflow.duckdb',
  schema_name: 'runs',
  table_name: 'node_runs',
  columns: [
    {
      column_name: 'run_id',
      data_type: 'VARCHAR',
      nullable: false,
      description: null
    },
    {
      column_name: 'node_id',
      data_type: 'VARCHAR',
      nullable: false,
      description: null
    },
    {
      column_name: 'created_at',
      data_type: 'VARCHAR',
      nullable: false,
      description: null
    },
    {
      column_name: 'updated_at',
      data_type: 'VARCHAR',
      nullable: false,
      description: null
    }
  ],
  sample_rows: []
};

const WORKSPACE_CATALOG_QUERY_RESPONSE = {
  workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
  workflow_name: 'Text Preview',
  database_name: 'workflow.duckdb',
  query: 'SELECT run_id, workflow_id, status\nFROM runs.workflow_runs\nLIMIT 1000',
  columns: [
    {
      column_name: 'run_id',
      data_type: 'VARCHAR'
    },
    {
      column_name: 'workflow_id',
      data_type: 'VARCHAR'
    },
    {
      column_name: 'status',
      data_type: 'VARCHAR'
    }
  ],
  rows: [['run_1', 'ScJUvQ7dgxHqu7tXtsekiL', 'succeeded']]
};

describe('App platform shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    delete window.google;
    api.cancelWorkspaceRun.mockReset();
    api.connectWorkspaceGmail.mockReset();
    api.createWorkspace.mockReset();
    api.createWorkflow.mockReset();
    api.deleteWorkspaceCatalogTable.mockReset();
    api.deleteWorkspace.mockReset();
    api.deleteWorkflow.mockReset();
    api.getSession.mockReset();
    api.getWorkflow.mockReset();
    api.getWorkspaceCatalog.mockReset();
    api.getWorkspaceCatalogSchema.mockReset();
    api.getWorkspaceCatalogTable.mockReset();
    api.getWorkspaceConnections.mockReset();
    api.getWorkspaceRun.mockReset();
    api.getWorkspaceRunEvents.mockReset();
    api.getWorkspaceRunLogs.mockReset();
    api.getWorkflows.mockReset();
    api.getWorkflowState.mockReset();
    api.getWorkspaceRuns.mockReset();
    api.login.mockReset();
    api.loginWithGoogleCode.mockReset();
    api.logout.mockReset();
    api.previewWorkspaceCatalogTableDelete.mockReset();
    api.runWorkspaceCatalogQuery.mockReset();
    api.updateWorkflow.mockReset();
    api.updateWorkflowState.mockReset();
    api.getSession.mockResolvedValue(UNAUTHENTICATED_SESSION);
    api.getWorkflowState.mockResolvedValue({ last_opened_workflow_id: null });
    api.getWorkspaceCatalog.mockImplementation(async (workspaceId) => {
      if (workspaceId === 'ws_secondary') {
        return SECONDARY_WORKSPACE_CATALOG_RESPONSE;
      }

      return WORKSPACE_CATALOG_RESPONSE;
    });
    api.getWorkspaceCatalogSchema.mockResolvedValue({
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_name: 'Text Preview',
      database_name: 'workflow.duckdb',
      schema_name: 'runs',
      tables: WORKSPACE_CATALOG_RESPONSE.catalogs[0].schemas[0].tables
    });
    api.getWorkspaceCatalogTable.mockResolvedValue(WORKSPACE_CATALOG_TABLE_RESPONSE);
    api.previewWorkspaceCatalogTableDelete.mockResolvedValue({
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_name: 'Text Preview',
      database_name: 'workflow.duckdb',
      schema_name: 'runs',
      table_name: 'workflow_runs',
      is_deletable: false,
      protected_reason: 'This is a system-managed table and cannot be deleted from the catalog tree.',
      affected_workflows: []
    });
    api.runWorkspaceCatalogQuery.mockResolvedValue(WORKSPACE_CATALOG_QUERY_RESPONSE);
    api.getWorkflows.mockResolvedValue({ workflows: [] });
    api.getWorkspaceConnections.mockResolvedValue({ connections: [] });
    api.getWorkspaceRuns.mockResolvedValue({ runs: [] });
    api.getWorkspaceRun.mockResolvedValue({ run: null });
    api.getWorkspaceRunEvents.mockResolvedValue({ events: [] });
    api.getWorkspaceRunLogs.mockResolvedValue({ logs: [] });
    api.updateWorkflowState.mockResolvedValue({ last_opened_workflow_id: null });
    api.deleteWorkspaceCatalogTable.mockResolvedValue({
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_name: 'Text Preview',
      database_name: 'workflow.duckdb',
      schema_name: 'tables',
      table_name: 'daily_digest',
      deleted: true,
      invalidated_workflows: []
    });
    api.deleteWorkspace.mockResolvedValue({ workspace_id: 'ws_secondary', deleted: true });
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

  it('exchanges a Google auth code and enters the canvas after sign-in', async () => {
    const requestCode = vi.fn();
    const initCodeClient = vi.fn((config) => {
      requestCode.mockImplementation(() => {
        config.callback({ code: 'google-auth-code-123' });
      });
      return { requestCode };
    });

    window.google = {
      accounts: {
        oauth2: {
          initCodeClient
        }
      }
    };
    api.loginWithGoogleCode.mockResolvedValue(AUTHENTICATED_SESSION);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /log in/i })
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(initCodeClient).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() => {
      expect(api.loginWithGoogleCode).toHaveBeenCalledWith('google-auth-code-123');
    });
    await waitFor(() => {
      expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
    });

    delete window.google;
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

  it('resolves a direct /flow/:workflowId route against the hinted workspace first', async () => {
    api.getSession.mockResolvedValue(AUTHENTICATED_MULTI_WORKSPACE_SESSION);
    api.getWorkflow.mockImplementation(async (workspaceId, workflowId) => {
      if (workspaceId === 'ws_secondary') {
        return {
          workflow: {
            workflow_id: workflowId,
            workspace_id: 'ws_secondary',
            name: 'Warehouse Workflow',
            description: 'Resolved from workspace hint.',
            version: 1,
            updated_at: '2026-05-24T10:00:00Z'
          },
          definition: {
            workflow_id: workflowId,
            version: 1,
            schema_version: 1,
            name: 'Warehouse Workflow',
            description: 'Resolved from workspace hint.',
            nodes: [],
            edges: [],
            metadata: { viewport: { x: 0, y: 0, zoom: 1 } }
          }
        };
      }

      const error = new Error('Not found');
      error.status = 404;
      throw error;
    });
    window.history.replaceState(
      {},
      '',
      '/flow/ScJUvQ7dgxHqu7tXtsekiL?workspaceId=ws_secondary'
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
    });

    expect(api.getWorkflow.mock.calls[0]).toEqual([
      'ws_secondary',
      'ScJUvQ7dgxHqu7tXtsekiL'
    ]);
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
    expect(screen.getByText('Table Output')).toBeInTheDocument();
    expect(screen.getByText('Send Email')).toBeInTheDocument();
  });

  it('opens the workflow popup on click from the collapsed rail', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkflows.mockResolvedValue({
      workflows: [
        {
          workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
          workspace_id: 'ws_default',
          name: 'Text Preview',
          description: 'Starter text preview flow.',
          version: 1,
          updated_at: '2026-05-24T10:00:00Z'
        }
      ]
    });

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
    fireEvent.click(screen.getByRole('button', { name: 'New workflow' }));
    expect(screen.getByRole('button', { name: 'Blank' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Starter' })).toBeInTheDocument();
    expect(await screen.findByText('Text Preview')).toBeInTheDocument();
  });

  it('opens the integrations popup on click from the collapsed rail', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkspaceConnections.mockResolvedValue({
      connections: [
        {
          workspace_id: 'ws_default',
          connection_id: 'conn_gmail_ops',
          connection_kind: 'gmail',
          display_name: 'Gmail · ops@gmail.com',
          comment: 'Authorized Gmail sender',
          auth_scheme: 'oauth2',
          status: 'active',
          external_account_label: 'ops@gmail.com',
          external_account_id: 'google-subject-123',
          capabilities: { send_email: true },
          scopes: ['https://www.googleapis.com/auth/gmail.send'],
          created_at: '2026-05-25T13:43:00Z',
          updated_at: '2026-05-25T13:43:00Z',
          last_error_message: null
        }
      ]
    });

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const integrationsButton = await screen.findByRole('button', { name: 'Integrations' });
    expect(integrationsButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(integrationsButton);

    expect(integrationsButton).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.canvas-menu.is-open')).not.toBeNull();
    expect(screen.getByLabelText('Integrations window')).toBeInTheDocument();
    expect(await screen.findByText('Gmail · ops@gmail.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New integration' })).toBeEnabled();
  });

  it('opens the data sources popup on click from the collapsed rail', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_MULTI_WORKSPACE_SESSION);

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const dataButton = await screen.findByRole('button', { name: 'Data' });
    expect(dataButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(dataButton);

    expect(dataButton).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.canvas-menu.is-open')).not.toBeNull();
    expect(screen.getByLabelText('Data sources window')).toBeInTheDocument();
    expect(screen.getByText('Catalog Tree')).toBeInTheDocument();
    const tree = screen.getByRole('tree', { name: 'Catalog hierarchy' });
    expect(
      await within(tree).findByText('default-workspace · ScJUvQ7dgxHqu7tXtsekiL · workflow.duckdb')
    ).toBeInTheDocument();
    expect(
      within(tree).getByText('warehouse-workspace · wf_warehouse_ops · workflow.duckdb')
    ).toBeInTheDocument();
    expect(within(tree).getByText('runs')).toBeInTheDocument();
    expect(within(tree).getByText('workflow_runs')).toBeInTheDocument();
    expect(screen.getByText('SQL Editor')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize query editor' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sample Data' })).toBeDisabled();
    await waitFor(() => {
      expect(api.getWorkspaceCatalog).toHaveBeenCalledWith('ws_default');
      expect(api.getWorkspaceCatalog).toHaveBeenCalledWith('ws_secondary');
      expect(api.getWorkspaceCatalogSchema).toHaveBeenCalledWith(
        'ws_default',
        'ScJUvQ7dgxHqu7tXtsekiL',
        'runs'
      );
    });
    expect(api.getWorkspaceCatalogTable).not.toHaveBeenCalled();

    const collapseSchemaButton = within(tree).getByRole('button', {
      name: 'Collapse schema runs'
    });
    fireEvent.click(collapseSchemaButton);
    expect(within(tree).queryByText('workflow_runs')).toBeNull();

    const expandSchemaButton = within(tree).getByRole('button', {
      name: 'Expand schema runs'
    });
    fireEvent.click(expandSchemaButton);
    expect(within(tree).getByText('workflow_runs')).toBeInTheDocument();
  });

  it('warns before deleting a user table and refreshes the catalog tree', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkspaceCatalog
      .mockResolvedValueOnce({
        catalogs: [
          {
            workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
            workflow_name: 'Text Preview',
            database_name: 'workflow.duckdb',
            schemas: [
              {
                schema_name: 'tables',
                table_count: 1,
                tables: [
                  {
                    table_name: 'daily_digest',
                    table_type: 'BASE TABLE',
                    column_count: 4,
                    is_deletable: true
                  }
                ]
              }
            ]
          }
        ]
      })
      .mockResolvedValueOnce({
        catalogs: [
          {
            workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
            workflow_name: 'Text Preview',
            database_name: 'workflow.duckdb',
            schemas: [
              {
                schema_name: 'tables',
                table_count: 0,
                tables: []
              }
            ]
          }
        ]
      });
    api.getWorkspaceCatalogSchema.mockResolvedValue({
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_name: 'Text Preview',
      database_name: 'workflow.duckdb',
      schema_name: 'tables',
      tables: [
        {
          table_name: 'daily_digest',
          table_type: 'BASE TABLE',
          column_count: 4,
          is_deletable: true
        }
      ]
    });
    api.previewWorkspaceCatalogTableDelete.mockResolvedValue({
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_name: 'Text Preview',
      database_name: 'workflow.duckdb',
      schema_name: 'tables',
      table_name: 'daily_digest',
      is_deletable: true,
      protected_reason: null,
      affected_workflows: [
        {
          workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
          workflow_name: 'Text Preview',
          nodes: [
            {
              node_id: 'table_input_digest',
              node_type: 'table_input',
              usage_kind: 'source',
              node_label: 'Table Input'
            }
          ]
        }
      ]
    });
    api.deleteWorkspaceCatalogTable.mockResolvedValue({
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_name: 'Text Preview',
      database_name: 'workflow.duckdb',
      schema_name: 'tables',
      table_name: 'daily_digest',
      deleted: true,
      invalidated_workflows: [
        {
          workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
          workflow_name: 'Text Preview',
          nodes: []
        }
      ]
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Data' }));

    const tree = await screen.findByRole('tree', { name: 'Catalog hierarchy' });
    const deleteButton = await screen.findByRole('button', {
      name: 'Delete table tables.daily_digest'
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(api.previewWorkspaceCatalogTableDelete).toHaveBeenCalledWith(
        'ws_default',
        'ScJUvQ7dgxHqu7tXtsekiL',
        'tables',
        'daily_digest'
      );
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('The following workflows use this table:')
    );
    await waitFor(() => {
      expect(api.deleteWorkspaceCatalogTable).toHaveBeenCalledWith(
        'ws_default',
        'ScJUvQ7dgxHqu7tXtsekiL',
        'tables',
        'daily_digest'
      );
    });
    await waitFor(() => {
      expect(within(tree).queryByText('daily_digest')).toBeNull();
    });

    confirmSpy.mockRestore();
  });

  it('updates the SQL editor for a selected table and runs edited preview queries', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.runWorkspaceCatalogQuery
      .mockResolvedValueOnce(WORKSPACE_CATALOG_QUERY_RESPONSE)
      .mockResolvedValueOnce({
        workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
        workflow_name: 'Text Preview',
        database_name: 'workflow.duckdb',
        query: 'SELECT status\nFROM runs.workflow_runs\nLIMIT 1000',
        columns: [
          {
            column_name: 'status',
            data_type: 'VARCHAR'
          }
        ],
        rows: [['succeeded']]
      });

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Data' }));

    const tree = await screen.findByRole('tree', { name: 'Catalog hierarchy' });
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'workflow_runs' }));

    await waitFor(() => {
      expect(api.getWorkspaceCatalogTable).toHaveBeenCalledWith(
        'ws_default',
        'ScJUvQ7dgxHqu7tXtsekiL',
        'runs',
        'workflow_runs'
      );
    });
    await waitFor(() => {
      expect(api.runWorkspaceCatalogQuery).toHaveBeenCalledWith(
        'ws_default',
        'ScJUvQ7dgxHqu7tXtsekiL',
        expect.stringContaining('FROM runs.workflow_runs')
      );
    });

    const editor = await screen.findByLabelText('SQL query editor');
    expect(editor.value).toContain('FROM runs.workflow_runs');

    fireEvent.change(editor, {
      target: {
        value: 'SELECT status\nFROM runs.workflow_runs\nLIMIT 1000'
      }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run query (1000)' }));

    await waitFor(() => {
      expect(api.runWorkspaceCatalogQuery).toHaveBeenLastCalledWith(
        'ws_default',
        'ScJUvQ7dgxHqu7tXtsekiL',
        'SELECT status\nFROM runs.workflow_runs\nLIMIT 1000'
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Sample Data' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it('reseeds the default preview query when switching between tables', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkspaceCatalogTable.mockImplementation(
      async (_workspaceId, _workflowId, _schemaName, tableName) => {
        if (tableName === 'node_runs') {
          return WORKSPACE_CATALOG_NODE_RUNS_TABLE_RESPONSE;
        }

        return WORKSPACE_CATALOG_TABLE_RESPONSE;
      }
    );
    api.runWorkspaceCatalogQuery.mockResolvedValue(WORKSPACE_CATALOG_QUERY_RESPONSE);

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Data' }));

    const tree = await screen.findByRole('tree', { name: 'Catalog hierarchy' });
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'node_runs' }));

    await waitFor(() => {
      expect(api.runWorkspaceCatalogQuery).toHaveBeenCalledWith(
        'ws_default',
        'ScJUvQ7dgxHqu7tXtsekiL',
        expect.stringContaining('FROM runs.node_runs')
      );
    });

    fireEvent.click(within(tree).getByRole('treeitem', { name: 'workflow_runs' }));

    await waitFor(() => {
      expect(api.runWorkspaceCatalogQuery).toHaveBeenLastCalledWith(
        'ws_default',
        'ScJUvQ7dgxHqu7tXtsekiL',
        expect.stringContaining('FROM runs.workflow_runs')
      );
    });

    const seededQuery = api.runWorkspaceCatalogQuery.mock.calls.at(-1)?.[2] ?? '';
    expect(seededQuery).toContain('FROM runs.workflow_runs');
    expect(seededQuery).toContain('workflow_id');
    expect(seededQuery).not.toContain('node_id');
  });

  it('skips unsafe timestamp mirror columns in the default node-runs preview query', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkspaceCatalogTable.mockResolvedValue(WORKSPACE_CATALOG_NODE_RUNS_TABLE_RESPONSE);
    api.runWorkspaceCatalogQuery.mockResolvedValue({
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_name: 'Text Preview',
      database_name: 'workflow.duckdb',
      query: 'SELECT run_id, node_id\nFROM runs.node_runs\nLIMIT 1000',
      columns: [
        {
          column_name: 'run_id',
          data_type: 'VARCHAR'
        },
        {
          column_name: 'node_id',
          data_type: 'VARCHAR'
        }
      ],
      rows: [['run_1', 'node_a']]
    });

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Data' }));

    const tree = await screen.findByRole('tree', { name: 'Catalog hierarchy' });
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'node_runs' }));

    await waitFor(() => {
      expect(api.runWorkspaceCatalogQuery).toHaveBeenCalled();
    });

    const seededQuery = api.runWorkspaceCatalogQuery.mock.calls.at(-1)?.[2] ?? '';
    expect(seededQuery).toContain('FROM runs.node_runs');
    expect(seededQuery).not.toContain('"created_at"');
    expect(seededQuery).not.toContain('"updated_at"');
  });

  it('opens the runs popup and shows workspace-scoped run history data', async () => {
    const startedAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const finishedAt = new Date(Date.now() - 42 * 60 * 1000).toISOString();

    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkflows.mockResolvedValue({
      workflows: [
        {
          workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
          workspace_id: 'ws_default',
          name: 'Email Draft Flow',
          description: 'Starter text preview flow.',
          version: 1,
          updated_at: '2026-05-24T10:00:00Z'
        }
      ]
    });
    api.getWorkspaceRun.mockResolvedValue({
      run: {
        run_id: 'run_6734',
        workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
        workflow_name_at_run: 'Email Draft Flow',
        workflow_version: 1,
        status: 'failed',
        trigger: { kind: 'manual' },
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: 180000,
        retry_count: 2,
        error_count: 1,
        node_runs: [
          {
            node_id: 'send_email_notification',
            type_id: 'send_email',
            status: 'failed',
            attempt: 3,
            started_at: startedAt,
            finished_at: finishedAt,
            last_output: null,
            log_count: 2,
            error: {
              category: 'execution_error',
              message: 'SMTP timeout'
            }
          }
        ],
        error: {
          category: 'execution_error',
          message: 'SMTP timeout'
        }
      }
    });
    api.getWorkspaceRunEvents.mockResolvedValue({
      events: [
        {
          event_id: 'evt_6734_1',
          sequence: 1,
          timestamp: finishedAt,
          event_type: 'node_failed',
          target: {
            kind: 'node',
            node_id: 'send_email_notification'
          },
          payload: {
            attempt: 3
          }
        }
      ]
    });
    api.getWorkspaceRunLogs.mockResolvedValue({
      logs: [
        {
          timestamp: finishedAt,
          level: 'error',
          node_id: 'send_email_notification',
          message: 'SMTP timeout'
        }
      ]
    });
    api.getWorkspaceRuns.mockResolvedValue({
      runs: [
        {
          run_id: 'run_6734',
          workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
          workflow_version: 1,
          status: 'failed',
          trigger: { kind: 'manual' },
          started_at: startedAt,
          finished_at: finishedAt,
          node_runs: [
            {
              node_id: 'send_email_notification',
              type_id: 'send_email',
              status: 'failed',
              attempt: 3,
              started_at: startedAt,
              finished_at: finishedAt,
              last_output: null,
              log_count: 2,
              error: {
                category: 'execution_error',
                message: 'SMTP timeout'
              }
            }
          ],
          logs: [],
          error: {
            category: 'execution_error',
            message: 'SMTP timeout'
          }
        }
      ]
    });

    const { container } = render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const runsButton = await screen.findByRole('button', { name: 'Runs' });
    expect(runsButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(runsButton);

    expect(runsButton).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.canvas-menu.is-open')).not.toBeNull();
    expect(await screen.findByLabelText('Runs history window')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run workflow' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Email Draft Flow' })).toBeInTheDocument();
    expect(screen.getByText('SMTP timeout')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent?.trim() === '1 / 2')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '6734' }));

    expect(await screen.findByText('Run Detail')).toBeInTheDocument();
    expect(screen.getByText('Run Facts')).toBeInTheDocument();
    expect(screen.getByText('Node States')).toBeInTheDocument();
    expect(screen.getByText('Recent Events')).toBeInTheDocument();
    expect(screen.getByText('Recent Logs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByLabelText('Runs history window')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6734' })).toBeInTheDocument();
  });

  it('opens embedded run detail from the canvas latest-run entry point', async () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const finishedAt = new Date(Date.now() - 29 * 60 * 1000).toISOString();

    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkflows.mockResolvedValue({
      workflows: [
        {
          workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
          workspace_id: 'ws_default',
          name: 'Email Draft Flow',
          description: 'Starter text preview flow.',
          version: 1,
          updated_at: '2026-05-24T10:00:00Z'
        }
      ]
    });
    api.getWorkspaceRuns.mockResolvedValue({
      runs: [
        {
          run_id: 'run_6734',
          workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
          workflow_version: 1,
          status: 'succeeded',
          trigger: { kind: 'manual' },
          started_at: startedAt,
          finished_at: finishedAt,
          node_runs: [],
          logs: [],
          error: null
        }
      ]
    });
    api.getWorkspaceRun.mockResolvedValue({
      run: {
        run_id: 'run_6734',
        workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
        workflow_name_at_run: 'Email Draft Flow',
        workflow_version: 1,
        status: 'succeeded',
        trigger: { kind: 'manual' },
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: 60000,
        retry_count: 0,
        error_count: 0,
        node_runs: [],
        error: null
      }
    });
    api.getWorkspaceRunEvents.mockResolvedValue({ events: [] });
    api.getWorkspaceRunLogs.mockResolvedValue({ logs: [] });

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    fireEvent.click(await screen.findByRole('button', { name: 'Open latest run in panel' }));

    expect(await screen.findByLabelText('Runs history window')).toBeInTheDocument();
    expect(await screen.findByText('Run Detail')).toBeInTheDocument();
    expect(screen.getByText('Run Facts')).toBeInTheDocument();
    expect(screen.getAllByText('run_6734').length).toBeGreaterThan(0);
  });

  it('opens the workspace directory popup and shows workspace workflows as a tree', async () => {
    api.login.mockResolvedValue({
      ...AUTHENTICATED_SESSION,
      workspaces: [
        ...AUTHENTICATED_SESSION.workspaces,
        {
          workspace_id: 'ws_ops',
          slug: 'ops-space',
          name: 'Ops Space',
          role: 'editor'
        }
      ]
    });
    api.getWorkflows.mockImplementation(async (workspaceId) => {
      if (workspaceId === 'ws_default') {
        return {
          workflows: [
            {
              workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
              workspace_id: 'ws_default',
              name: 'Text Preview',
              description: 'Starter text preview flow.',
              version: 1,
              updated_at: '2026-05-24T10:00:00Z'
            }
          ]
        };
      }

      return {
        workflows: [
          {
            workflow_id: 'wf_ops_alerts',
            workspace_id: 'ws_ops',
            name: 'Ops Alerts',
            description: 'Ops workflow.',
            version: 1,
            updated_at: '2026-05-24T11:00:00Z'
          }
        ]
      };
    });

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const workspacesButton = await screen.findByRole('button', { name: 'Workspaces' });
    fireEvent.click(workspacesButton);

    expect(await screen.findByLabelText('Workspace directory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument();
    expect(await screen.findByText('Default Workspace · Current')).toBeInTheDocument();
    expect(await screen.findByText('Ops Space')).toBeInTheDocument();
    expect(await screen.findByText('Text Preview')).toBeInTheDocument();
    expect(await screen.findByText('Ops Alerts')).toBeInTheDocument();
  });

  it('opens another workspace from the workspace header using its latest workflow route', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_MULTI_WORKSPACE_SESSION);
    api.getWorkflows.mockImplementation(async (workspaceId) => {
      if (workspaceId === 'ws_secondary') {
        return {
          workflows: [
            {
              workflow_id: 'wf_warehouse_ops',
              workspace_id: 'ws_secondary',
              name: 'Warehouse Ops',
              description: 'Secondary workflow.',
              version: 1,
              updated_at: '2026-05-24T11:00:00Z'
            }
          ]
        };
      }

      return {
        workflows: [
          {
            workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
            workspace_id: 'ws_default',
            name: 'Text Preview',
            description: 'Primary workflow.',
            version: 1,
            updated_at: '2026-05-24T10:00:00Z'
          }
        ]
      };
    });
    api.getWorkflow.mockImplementation(async (workspaceId, workflowId) => {
      if (workspaceId === 'ws_secondary' && workflowId === 'wf_warehouse_ops') {
        return {
          workflow: {
            workflow_id: workflowId,
            workspace_id: 'ws_secondary',
            name: 'Warehouse Ops',
            description: 'Secondary workflow.',
            version: 1,
            updated_at: '2026-05-24T11:00:00Z'
          },
          definition: {
            workflow_id: workflowId,
            version: 1,
            schema_version: 1,
            name: 'Warehouse Ops',
            description: 'Secondary workflow.',
            nodes: [],
            edges: [],
            metadata: { viewport: { x: 0, y: 0, zoom: 1 } }
          }
        };
      }

      const error = new Error('Not found');
      error.status = 404;
      throw error;
    });

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const workspacesButton = await screen.findByRole('button', { name: 'Workspaces' });
    fireEvent.click(workspacesButton);
    const directory = await screen.findByLabelText('Workspace directory');
    const targetWorkspaceButton = within(directory)
      .getAllByRole('button', { name: /Warehouse Workspace/i })
      .find((button) => !button.getAttribute('aria-label'));
    expect(targetWorkspaceButton).toBeDefined();
    fireEvent.click(targetWorkspaceButton);

    expect(window.location.pathname).toBe('/flow/wf_warehouse_ops');
    expect(window.location.search).toBe('?workspaceId=ws_secondary');
    await waitFor(() => {
      expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument();
    });
  });

  it('opens another workspace workflow with a workspace hint in the flow route', async () => {
    api.login.mockResolvedValue({
      ...AUTHENTICATED_SESSION,
      workspaces: [
        ...AUTHENTICATED_SESSION.workspaces,
        {
          workspace_id: 'ws_ops',
          slug: 'ops-space',
          name: 'Ops Space',
          role: 'editor'
        }
      ]
    });
    api.getWorkflows.mockImplementation(async (workspaceId) => {
      if (workspaceId === 'ws_default') {
        return {
          workflows: [
            {
              workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
              workspace_id: 'ws_default',
              name: 'Text Preview',
              description: 'Starter text preview flow.',
              version: 1,
              updated_at: '2026-05-24T10:00:00Z'
            }
          ]
        };
      }

      return {
        workflows: [
          {
            workflow_id: 'wf_ops_alerts',
            workspace_id: 'ws_ops',
            name: 'Ops Alerts',
            description: 'Ops workflow.',
            version: 1,
            updated_at: '2026-05-24T11:00:00Z'
          }
        ]
      };
    });

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const workspacesButton = await screen.findByRole('button', { name: 'Workspaces' });
    fireEvent.click(workspacesButton);
    fireEvent.click(await screen.findByRole('button', { name: /Ops Alerts/i }));

    await waitFor(() => {
      expect(api.updateWorkflowState).toHaveBeenCalledWith('ws_ops', 'wf_ops_alerts');
    });
    expect(window.location.pathname).toBe('/flow/wf_ops_alerts');
    expect(window.location.search).toBe('?workspaceId=ws_ops');
  });

  it('shows owner delete buttons in the workspace popup and removes a deleted workspace', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.login.mockResolvedValue(AUTHENTICATED_MULTI_WORKSPACE_SESSION);
    api.getSession
      .mockResolvedValueOnce(UNAUTHENTICATED_SESSION)
      .mockResolvedValue({
        ...AUTHENTICATED_SESSION,
        workspaces: [...AUTHENTICATED_SESSION.workspaces]
      });
    api.getWorkflows.mockImplementation(async (workspaceId) => {
      if (workspaceId === 'ws_secondary') {
        return {
          workflows: [
            {
              workflow_id: 'wf_warehouse_ops',
              workspace_id: 'ws_secondary',
              name: 'Warehouse Ops',
              description: 'Secondary workflow.',
              version: 1,
              updated_at: '2026-05-24T11:00:00Z'
            }
          ]
        };
      }

      return {
        workflows: [
          {
            workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
            workspace_id: 'ws_default',
            name: 'Text Preview',
            description: 'Primary workflow.',
            version: 1,
            updated_at: '2026-05-24T10:00:00Z'
          }
        ]
      };
    });

    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Workspaces' }));

    const deleteButton = await screen.findByRole('button', {
      name: 'Delete workspace Warehouse Workspace'
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(api.deleteWorkspace).toHaveBeenCalledWith('ws_secondary');
    });
    await waitFor(() => {
      expect(screen.queryByText('Warehouse Workspace')).not.toBeInTheDocument();
    });

    confirmSpy.mockRestore();
  });

  it('keeps /workspaces/new accessible for authenticated users with existing workspaces', async () => {
    api.getSession.mockResolvedValue(AUTHENTICATED_SESSION);
    window.history.replaceState({}, '', '/workspaces/new');

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /create a workspace/i })
    ).toBeInTheDocument();
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
      '/flow/tFRXIL9X4YxHMVYqbeFH2T?workspaceId=ws_default',
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
    window.history.replaceState({}, '', '/w/default-workspace/runs');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Runs' })).toBeInTheDocument();
    expect(screen.getByText(/orders import failed/i)).toBeInTheDocument();
    expect(screen.getByText(/pending approvals/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /collapse attention panel/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand attention panel/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/3 active items/i)).toBeInTheDocument();
    expect(screen.queryByText(/pending approvals/i)).toBeNull();
  });

  it('creates a starter workflow from the workflow popup and opens its explicit canvas route', async () => {
    api.login.mockResolvedValue(AUTHENTICATED_SESSION);
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

    await screen.findByRole('heading', { name: /log in/i });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const workflowsButton = await screen.findByRole('button', { name: 'Workflows' });
    fireEvent.click(workflowsButton);
    fireEvent.click(await screen.findByRole('button', { name: 'New workflow' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Starter' }));

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

  it('loads the explicit workflows workspace route', async () => {
    api.getSession.mockResolvedValue(AUTHENTICATED_SESSION);
    api.getWorkflows.mockResolvedValue({ workflows: [] });
    window.history.replaceState({}, '', '/w/default-workspace/workflows');

    render(<App />);

    expect(await screen.findByText('No workflows yet')).toBeInTheDocument();
    expect(api.getWorkflows).toHaveBeenCalledWith('ws_default');
    expect(window.location.pathname).toBe('/w/default-workspace/workflows');
  });

  it('fails hard for unsupported workspace screens instead of redirecting', async () => {
    api.getSession.mockResolvedValue(AUTHENTICATED_SESSION);
    window.history.replaceState({}, '', '/w/default-workspace/not-a-screen');

    render(<App />);

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByText('/w/default-workspace/not-a-screen')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/w/default-workspace/not-a-screen');
  });
});
