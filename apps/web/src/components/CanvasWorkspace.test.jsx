import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import starterWorkflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import connectionFixture from '../../../../tests/fixtures/api/connections.json';
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import CanvasWorkspace from './CanvasWorkspace';

vi.mock('./WorkflowCanvas', () => ({
  default: function WorkflowCanvasMock({ onSelectionChange }) {
    return (
      <div data-testid="workflow-canvas">
        <span>Workflow canvas</span>
        <button onClick={() => onSelectionChange?.('table_input_runs')} type="button">
          Select table input node
        </button>
        <button onClick={() => onSelectionChange?.('send_email_notification')} type="button">
          Select send email node
        </button>
        <button onClick={() => onSelectionChange?.('table_output_news_brief')} type="button">
          Select table output node
        </button>
      </div>
    );
  }
}));

const api = vi.hoisted(() => ({
  cancelWorkspaceRun: vi.fn(),
  createRun: vi.fn(),
  createWorkspaceRun: vi.fn(),
  getConnections: vi.fn(),
  getNodeDefinitions: vi.fn(),
  getRunSnapshot: vi.fn(),
  getWorkspaceConnections: vi.fn(),
  getWorkspaceRun: vi.fn(),
  getWorkspaceRunEvents: vi.fn(),
  getWorkspaceRunLogs: vi.fn(),
  getWorkspaceRuns: vi.fn(),
  getWorkflow: vi.fn(),
  getWorkflowState: vi.fn(),
  getWorkflows: vi.fn(),
  subscribeToRun: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowState: vi.fn(),
  validateWorkflow: vi.fn()
}));

vi.mock('../lib/api', () => api);

const LATEST_RUN = {
  run_id: 'run_live_123',
  workflow_id: starterWorkflowFixture.workflow_id,
  workflow_version: starterWorkflowFixture.version,
  status: 'succeeded',
  trigger: { kind: 'manual' },
  started_at: '2026-05-26T08:00:00Z',
  finished_at: '2026-05-26T08:00:05Z',
  node_runs: [
    {
      node_id: 'input_text',
      type_id: 'text_input',
      status: 'succeeded',
      attempt: 1,
      started_at: '2026-05-26T08:00:00Z',
      finished_at: '2026-05-26T08:00:01Z',
      last_output: { type: 'text', value: 'Hello world' },
      log_count: 1,
      error: null
    },
    {
      node_id: 'send_email_notification',
      type_id: 'send_email',
      status: 'succeeded',
      attempt: 1,
      started_at: '2026-05-26T08:00:01Z',
      finished_at: '2026-05-26T08:00:05Z',
      last_output: null,
      log_count: 2,
      error: null
    }
  ],
  logs: [
    {
      timestamp: '2026-05-26T08:00:01Z',
      level: 'info',
      node_id: 'send_email_notification',
      message: 'Queued mock email delivery.'
    }
  ],
  error: null
};

const RUN_EVENTS = [
  {
    event_id: 'evt_run_succeeded',
    run_id: 'run_live_123',
    sequence: 5,
    timestamp: '2026-05-26T08:00:05Z',
    event_type: 'run_succeeded',
    target: {
      kind: 'run',
      node_id: null
    },
    payload: {
      completed_nodes: 2
    }
  }
];

function buildTableOutputWorkflow() {
  return {
    ...starterWorkflowFixture,
    nodes: [
      ...starterWorkflowFixture.nodes,
      {
        node_id: 'table_output_news_brief',
        type_id: 'table_output',
        definition_version: 1,
        label: 'Table Output',
        config: {
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          include_run_id: true,
          include_written_at: true,
          input_shape: 'single_text_row',
          open_in_catalog: false,
          table_name: 'news_brief',
          target_schema: 'outputs',
          value_column: 'content',
          write_mode: 'append'
        },
        position: {
          x: 880,
          y: 240
        }
      }
    ],
    edges: [
      ...starterWorkflowFixture.edges,
      {
        edge_id: 'edge_input_text_to_table_output_text',
        source_node_id: 'input_text',
        source_port_id: 'text',
        target_node_id: 'table_output_news_brief',
        target_port_id: 'text'
      }
    ]
  };
}

function buildTableInputWorkflow() {
  return {
    ...starterWorkflowFixture,
    nodes: [
      ...starterWorkflowFixture.nodes,
      {
        node_id: 'table_input_runs',
        type_id: 'table_input',
        definition_version: 1,
        label: 'Table Input',
        config: {
          catalog: 'workflow.duckdb',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          open_in_catalog: false,
          output_alias: 'workflow_runs',
          refresh_schema: true,
          row_filter: '',
          row_limit: null,
          schema_name: 'runs',
          selected_columns: [],
          table_name: 'workflow_runs'
        },
        position: {
          x: 120,
          y: 240
        }
      }
    ],
    edges: starterWorkflowFixture.edges
  };
}

describe('CanvasWorkspace', () => {
  beforeEach(() => {
    api.cancelWorkspaceRun.mockReset();
    api.createRun.mockReset();
    api.createWorkspaceRun.mockReset();
    api.getConnections.mockReset();
    api.getNodeDefinitions.mockReset();
    api.getRunSnapshot.mockReset();
    api.getWorkspaceConnections.mockReset();
    api.getWorkspaceRun.mockReset();
    api.getWorkspaceRunEvents.mockReset();
    api.getWorkspaceRunLogs.mockReset();
    api.getWorkspaceRuns.mockReset();
    api.getWorkflow.mockReset();
    api.getWorkflowState.mockReset();
    api.getWorkflows.mockReset();
    api.subscribeToRun.mockReset();
    api.updateWorkflow.mockReset();
    api.updateWorkflowState.mockReset();
    api.validateWorkflow.mockReset();

    api.getNodeDefinitions.mockResolvedValue(nodeDefinitionFixture);
    api.getConnections.mockResolvedValue(connectionFixture);
    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: starterWorkflowFixture.workflow_id,
        version: starterWorkflowFixture.version
      },
      definition: starterWorkflowFixture
    });
    api.getWorkspaceConnections.mockResolvedValue({
      connections: [
        {
          workspace_id: 'ws_test',
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
    api.getWorkspaceRuns.mockResolvedValue({ runs: [LATEST_RUN] });
    api.getWorkspaceRun.mockResolvedValue({ run: LATEST_RUN });
    api.getWorkspaceRunEvents.mockResolvedValue({ events: RUN_EVENTS });
    api.getWorkspaceRunLogs.mockResolvedValue({ logs: LATEST_RUN.logs });
    api.getWorkflowState.mockResolvedValue({ last_opened_workflow_id: null });
    api.getWorkflows.mockResolvedValue({ workflows: [] });
    api.updateWorkflowState.mockResolvedValue({
      last_opened_workflow_id: starterWorkflowFixture.workflow_id
    });
    api.subscribeToRun.mockReturnValue(() => {});
  });

  it('restores the latest persisted workflow run into the canvas shell', async () => {
    render(
      <CanvasWorkspace
        workflowId={starterWorkflowFixture.workflow_id}
        workspaceId="ws_test"
      />
    );

    const statusStrip = await screen.findByLabelText('Workflow run status');
    await waitFor(() => {
      expect(statusStrip).toHaveTextContent('Succeeded');
      expect(statusStrip).toHaveTextContent('2/2 nodes');
      expect(statusStrip).toHaveTextContent('run_live_123');
    });

    fireEvent.click(statusStrip);

    await waitFor(() => {
      expect(api.getWorkspaceRun).toHaveBeenCalledWith('ws_test', 'run_live_123');
    });
    expect(
      await screen.findByRole('heading', { name: 'run_live_123' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Run Facts')).toBeInTheDocument();
    expect(await screen.findByText('Queued mock email delivery.')).toBeInTheDocument();
    expect(await screen.findByText('Run Succeeded')).toBeInTheDocument();
  });

  it('lets the send email node select an added Gmail integration', async () => {
    render(
      <CanvasWorkspace
        workflowId={starterWorkflowFixture.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select send email node' }));

    const connectionSelect = await screen.findByLabelText('Connection');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Gmail · ops@gmail.com' })).toBeInTheDocument();
    });

    fireEvent.change(connectionSelect, {
      target: { value: 'conn_gmail_ops' }
    });

    expect(connectionSelect).toHaveValue('conn_gmail_ops');
  });

  it('shows the table output management panel with execution timing controls', async () => {
    const workflowWithTableOutput = buildTableOutputWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithTableOutput.workflow_id,
        version: workflowWithTableOutput.version
      },
      definition: workflowWithTableOutput
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithTableOutput.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select table output node' }));

    expect(await screen.findByLabelText('Target schema')).toHaveValue('outputs');
    expect(screen.getByLabelText('Target table')).toHaveValue('news_brief');
    expect(screen.getByLabelText('Write mode')).toHaveValue('append');
    expect(screen.getByLabelText('Value column')).toHaveValue('content');
    expect(screen.getByText('Execution timing')).toBeInTheDocument();
    expect(screen.getByText('Include run id')).toBeInTheDocument();
    expect(screen.getByText('Open table in catalog after write')).toBeInTheDocument();
  });

  it('shows the table input management panel with source controls', async () => {
    const workflowWithTableInput = buildTableInputWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithTableInput.workflow_id,
        version: workflowWithTableInput.version
      },
      definition: workflowWithTableInput
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithTableInput.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select table input node' }));

    expect(await screen.findByLabelText('Catalog')).toHaveValue('workflow.duckdb');
    expect(screen.getByLabelText('Schema')).toHaveValue('runs');
    expect(screen.getByLabelText('Source table')).toHaveValue('workflow_runs');
    expect(screen.getByLabelText('Output alias')).toHaveValue('workflow_runs');
    expect(screen.getByText('Refresh schema before execution')).toBeInTheDocument();
    expect(screen.getByText('Execution timing')).toBeInTheDocument();
  });

  it('keeps validation errors inside run control instead of opening the problem popup', async () => {
    const workflowWithTableOutput = buildTableOutputWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithTableOutput.workflow_id,
        version: workflowWithTableOutput.version
      },
      definition: workflowWithTableOutput
    });
    api.validateWorkflow.mockResolvedValue({
      valid: false,
      errors: [
        {
          code: 'unknown_node_type',
          message: 'Node `table_output` references unknown type `table_output`.',
          path: 'workflow.nodes.table_output.type_id'
        }
      ],
      warnings: []
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithTableOutput.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Open run control' }));
    fireEvent.click(screen.getByRole('button', { name: 'Validate Workflow' }));

    expect(await screen.findByText('Validation Issue')).toBeInTheDocument();
    expect(
      screen.getByText('Node `table_output` references unknown type `table_output`.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Open Node Inspector')).not.toBeInTheDocument();
  });
});
