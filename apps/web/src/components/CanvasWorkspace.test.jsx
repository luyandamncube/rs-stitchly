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
        <button onClick={() => onSelectionChange?.('send_email_notification')} type="button">
          Select send email node
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
});
