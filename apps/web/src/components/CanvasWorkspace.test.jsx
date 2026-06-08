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
        <button onClick={() => onSelectionChange?.('table_schema_orders')} type="button">
          Select table schema node
        </button>
      </div>
    );
  }
}));

const api = vi.hoisted(() => ({
  cancelWorkspaceRun: vi.fn(),
  createRun: vi.fn(),
  createWorkflow: vi.fn(),
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

function buildSchemaBootstrapWorkflow() {
  const workflow = buildTableOutputWorkflow();
  const tableOutputNode = workflow.nodes.find(
    (node) => node.node_id === 'table_output_news_brief'
  );

  tableOutputNode.config.input_shape = 'table_schema';
  workflow.edges = workflow.edges.filter(
    (edge) =>
      !(
        edge.target_node_id === 'table_output_news_brief' &&
        edge.target_port_id === 'text'
      )
  );
  workflow.nodes.push({
    node_id: 'table_schema_orders',
    type_id: 'table_schema',
    definition_version: 1,
    label: 'Table Schema',
    config: {
      catalog: 'workflow.duckdb',
      checks: [],
      columns: [
        {
          name: 'order_id',
          nullable: false,
          primary_key: true,
          type: 'bigint'
        },
        {
          name: 'customer_id',
          nullable: false,
          primary_key: false,
          type: 'varchar'
        }
      ],
      create_mode: 'create_if_missing',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      if_target_exists: 'keep_existing',
      open_in_catalog: false,
      output_alias: 'orders_definition',
      primary_key: ['order_id'],
      schema_name: 'tables',
      table_name: 'orders',
      tables: [
        {
          checks: [],
          columns: [
            {
              name: 'order_id',
              nullable: false,
              primary_key: true,
              type: 'bigint'
            },
            {
              name: 'customer_id',
              nullable: false,
              primary_key: false,
              type: 'varchar'
            }
          ],
          create_mode: 'create_if_missing',
          if_target_exists: 'keep_existing',
          output_alias: 'orders_definition',
          primary_key: ['order_id'],
          schema_name: 'tables',
          table_name: 'orders'
        },
        {
          checks: [],
          columns: [
            {
              name: 'line_id',
              nullable: false,
              primary_key: true,
              type: 'bigint'
            },
            {
              name: 'order_id',
              nullable: false,
              primary_key: false,
              type: 'bigint'
            },
            {
              name: 'sku',
              nullable: false,
              primary_key: false,
              type: 'varchar'
            }
          ],
          create_mode: 'create_if_missing',
          if_target_exists: 'keep_existing',
          output_alias: 'order_lines_definition',
          primary_key: ['line_id'],
          schema_name: 'tables',
          table_name: 'order_lines'
        }
      ]
    },
    position: {
      x: 320,
      y: 360
    }
  });
  workflow.edges.push({
    edge_id: 'edge_table_schema_to_table_output_text',
    source_node_id: 'table_schema_orders',
    source_port_id: 'table',
    target_node_id: 'table_output_news_brief',
    target_port_id: 'text'
  });

  return workflow;
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

function buildTableSchemaWorkflow() {
  return {
    ...starterWorkflowFixture,
    nodes: [
      ...starterWorkflowFixture.nodes,
      {
        node_id: 'table_schema_orders',
        type_id: 'table_schema',
        definition_version: 1,
        label: 'Table Schema',
        config: {
          catalog: 'workflow.duckdb',
          checks: [],
          columns: [
            {
              name: 'order_id',
              nullable: false,
              primary_key: true,
              type: 'bigint'
            },
            {
              name: 'posted_at',
              nullable: true,
              type: 'timestamp'
            }
          ],
          create_mode: 'create_if_missing',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          if_target_exists: 'keep_existing',
          open_in_catalog: false,
          output_alias: 'orders_definition',
          primary_key: ['order_id'],
          schema_name: 'tables',
          table_name: 'orders'
        },
        position: {
          x: 320,
          y: 360
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
    api.createWorkflow.mockReset();
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
    api.createWorkflow.mockImplementation(async (_workspaceId, workflow) => ({
      workflow: {
        workflow_id: workflow.workflow_id,
        version: workflow.version
      },
      definition: workflow
    }));
    api.updateWorkflow.mockImplementation(async (_workspaceId, _workflowId, workflow) => ({
      workflow: {
        workflow_id: workflow.workflow_id,
        version: workflow.version
      },
      definition: workflow
    }));
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

  it('bootstraps a new persisted workspace with a fresh starter workflow id', async () => {
    api.createWorkflow.mockImplementation(async (_workspaceId, workflow) => ({
      workflow: {
        workflow_id: workflow.workflow_id,
        version: workflow.version
      },
      definition: workflow
    }));

    render(<CanvasWorkspace workspaceId="ws_test" />);

    await screen.findByLabelText('Workflow run status');

    await waitFor(() => {
      expect(api.createWorkflow).toHaveBeenCalledTimes(1);
    });

    const [, createdWorkflow] = api.createWorkflow.mock.calls[0];
    expect(createdWorkflow.workflow_id).not.toBe(starterWorkflowFixture.workflow_id);
    expect(createdWorkflow.name).toBeTruthy();
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
    fireEvent.click(connectionSelect);

    const gmailOption = await screen.findByRole('option', {
      name: 'Gmail · ops@gmail.com'
    });
    fireEvent.click(gmailOption);

    expect(connectionSelect.value).toBe('conn_gmail_ops');
    expect(connectionSelect).toHaveTextContent('Gmail · ops@gmail.com');
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

    expect((await screen.findByLabelText('Target schema')).value).toBe('outputs');
    expect(screen.getByLabelText('Target table')).toHaveValue('news_brief');
    expect(screen.getByLabelText('Write mode').value).toBe('append');
    expect(screen.getByLabelText('Value column')).toHaveValue('content');
    expect(screen.getByText('Execution timing')).toBeInTheDocument();
    expect(screen.getByText('Include run id')).toBeInTheDocument();
    expect(screen.getByText('Open table in catalog after write')).toBeInTheDocument();
  });

  it('shows the schema bootstrap option for table output nodes', async () => {
    const workflowWithTableOutput = buildSchemaBootstrapWorkflow();

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

    const inputShape = await screen.findByLabelText('Input shape');
    expect(inputShape.value).toBe('table_schema');
    fireEvent.click(inputShape);
    expect(screen.getByRole('option', { name: 'Schema bootstrap' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Target table')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Value column')).not.toBeInTheDocument();

    const resultTableShape = screen.getByLabelText('Result table shape');
    expect(resultTableShape).toHaveTextContent('outputs.orders');
    expect(resultTableShape).toHaveTextContent('outputs.order_lines');
    expect(resultTableShape).toHaveTextContent('order_id');
    expect(resultTableShape).toHaveTextContent('line_id');
  });

  it('keeps the node management panel visible while run control is open', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Open run control' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select table output node' }));

    const inputShape = await screen.findByLabelText('Input shape');
    expect(inputShape.value).toBe('single_text_row');
    fireEvent.click(inputShape);
    expect(screen.getByRole('option', { name: 'Schema bootstrap' })).toBeInTheDocument();
    expect(screen.getByText('Validate Workflow')).toBeInTheDocument();
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
    expect(screen.getByLabelText('Schema').value).toBe('runs');
    expect(screen.getByLabelText('Source table').value).toBe('workflow_runs');
    expect(screen.getByLabelText('Output alias')).toHaveValue('workflow_runs');
    expect(screen.getByText('Refresh schema before execution')).toBeInTheDocument();
    expect(screen.getByText('Execution timing')).toBeInTheDocument();
  });

  it('shows a friendly JSON editor for table schema nodes', async () => {
    const workflowWithTableSchema = buildTableSchemaWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithTableSchema.workflow_id,
        version: workflowWithTableSchema.version
      },
      definition: workflowWithTableSchema
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithTableSchema.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select table schema node' }));

    const schemaEditor = await screen.findByLabelText('Schema JSON');
    expect(schemaEditor.value).toContain('"table": "orders"');
    expect(schemaEditor.value).toContain('"required": true');
    expect(schemaEditor.value).toContain('"pk": true');
    expect(schemaEditor.value).not.toContain('"schema_name"');
    expect(screen.queryByRole('button', { name: 'Lint JSON' })).not.toBeInTheDocument();

    fireEvent.change(schemaEditor, {
      target: {
        value: `${schemaEditor.value}\n`
      }
    });

    expect(
      await screen.findByText(
        'Schema JSON looks valid for orders with 2 columns; primary key: order_id.'
      )
    ).toBeInTheDocument();
  });

  it('formats and applies friendly table schema JSON as canonical config', async () => {
    const workflowWithTableSchema = buildTableSchemaWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithTableSchema.workflow_id,
        version: workflowWithTableSchema.version
      },
      definition: workflowWithTableSchema
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithTableSchema.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select table schema node' }));

    const schemaEditor = await screen.findByLabelText('Schema JSON');
    fireEvent.change(schemaEditor, {
      target: {
        value: JSON.stringify({
          table: 'orders',
          columns: [
            { name: 'order_id', type: 'bigint', required: true, pk: true },
            { name: 'customer_id', type: 'varchar', required: true },
            {
              name: 'total_amount',
              type: 'decimal(18,2)',
              required: true,
              default: '0.00'
            },
            {
              name: 'currency_code',
              type: 'varchar',
              required: true,
              default: "'USD'"
            },
            { name: 'posted_at', type: 'timestamp' }
          ]
        })
      }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Format JSON' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Schema JSON').value).toContain('\n  "columns": [\n');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Schema' }));

    await waitFor(() => {
      expect(api.updateWorkflow).toHaveBeenCalled();
    });

    const updatedWorkflow = api.updateWorkflow.mock.calls.at(-1)[2];
    const tableSchemaNode = updatedWorkflow.nodes.find(
      (node) => node.node_id === 'table_schema_orders'
    );

    expect(tableSchemaNode.config.schema_name).toBe('tables');
    expect(tableSchemaNode.config.table_name).toBe('orders');
    expect(tableSchemaNode.config.execution).toEqual({
      wait_after_seconds: 0,
      wait_before_seconds: 0
    });
    expect(tableSchemaNode.config.primary_key).toEqual(['order_id']);
    expect(tableSchemaNode.config.columns).toEqual([
      {
        name: 'order_id',
        nullable: false,
        primary_key: true,
        type: 'bigint'
      },
      {
        name: 'customer_id',
        nullable: false,
        primary_key: false,
        type: 'varchar'
      },
      {
        default: '0.00',
        name: 'total_amount',
        nullable: false,
        primary_key: false,
        type: 'decimal(18,2)'
      },
      {
        default: "'USD'",
        name: 'currency_code',
        nullable: false,
        primary_key: false,
        type: 'varchar'
      },
      {
        name: 'posted_at',
        nullable: true,
        primary_key: false,
        type: 'timestamp'
      }
    ]);
  });

  it('renders result table shape cleanly after applying friendly table schema JSON', async () => {
    const workflowWithTableSchema = buildTableSchemaWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithTableSchema.workflow_id,
        version: workflowWithTableSchema.version
      },
      definition: workflowWithTableSchema
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithTableSchema.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select table schema node' }));

    const schemaEditor = await screen.findByLabelText('Schema JSON');
    fireEvent.change(schemaEditor, {
      target: {
        value: JSON.stringify({
          table: 'orders',
          alias: 'orders_fact_definition',
          columns: Array.from({ length: 7 }, (_, index) => ({
            name: `col_${index + 1}`,
            type: 'int'
          })),
          checks: ['total_amount >= 0']
        })
      }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Schema' }));

    const resultTableShape = await screen.findByLabelText('Result table shape');

    expect(resultTableShape).toHaveTextContent('orders');
    expect(resultTableShape).toHaveTextContent('col_1');
    expect(resultTableShape).toHaveTextContent('int');
    expect(resultTableShape).toHaveTextContent('col_7');
    expect(resultTableShape).not.toHaveTextContent('"name"');
  });

  it('applies multi-table schema JSON and renders grouped result table shape', async () => {
    const workflowWithTableSchema = buildTableSchemaWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithTableSchema.workflow_id,
        version: workflowWithTableSchema.version
      },
      definition: workflowWithTableSchema
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithTableSchema.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select table schema node' }));

    const schemaEditor = await screen.findByLabelText('Schema JSON');
    fireEvent.change(schemaEditor, {
      target: {
        value: JSON.stringify({
          tables: [
            {
              table: 'orders',
              alias: 'orders_definition',
              columns: [
                { name: 'order_id', type: 'bigint', required: true, pk: true },
                { name: 'customer_id', type: 'varchar', required: true }
              ]
            },
            {
              table: 'order_lines',
              alias: 'order_lines_definition',
              columns: [
                { name: 'line_id', type: 'bigint', required: true, pk: true },
                { name: 'order_id', type: 'bigint', required: true },
                { name: 'sku', type: 'varchar', required: true }
              ]
            }
          ]
        })
      }
    });

    expect(
      await screen.findByText(
        'Schema JSON looks valid for 2 tables with 5 total columns.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Schema' }));

    await waitFor(() => {
      expect(api.updateWorkflow).toHaveBeenCalled();
    });

    const updatedWorkflow = api.updateWorkflow.mock.calls.at(-1)[2];
    const tableSchemaNode = updatedWorkflow.nodes.find(
      (node) => node.node_id === 'table_schema_orders'
    );

    expect(tableSchemaNode.config.tables).toHaveLength(2);
    expect(tableSchemaNode.config.schema_name).toBe('tables');
    expect(tableSchemaNode.config.table_name).toBe('orders');
    expect(tableSchemaNode.config.columns).toHaveLength(2);

    const resultTableShape = await screen.findByLabelText('Result table shape');
    expect(resultTableShape).toHaveTextContent('orders');
    expect(resultTableShape).toHaveTextContent('order_lines');
    expect(resultTableShape).toHaveTextContent('order_id');
    expect(resultTableShape).toHaveTextContent('line_id');
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
    expect(screen.getByText(/references unknown type `table_output`\./)).toBeInTheDocument();
    expect(screen.queryByText('Focus Node')).not.toBeInTheDocument();
  });
});
