import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import starterWorkflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import connectionFixture from '../../../../tests/fixtures/api/connections.json';
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import CanvasWorkspace from './CanvasWorkspace.jsx';

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
        <button onClick={() => onSelectionChange?.('dolt_repo_source')} type="button">
          Select dolt repo source node
        </button>
        <button onClick={() => onSelectionChange?.('checkpoint_read')} type="button">
          Select checkpoint read node
        </button>
        <button onClick={() => onSelectionChange?.('checkpoint_write')} type="button">
          Select checkpoint write node
        </button>
        <button onClick={() => onSelectionChange?.('quality_check')} type="button">
          Select quality check node
        </button>
        <button onClick={() => onSelectionChange?.('dolt_repo_sync')} type="button">
          Select dolt repo sync node
        </button>
        <button onClick={() => onSelectionChange?.('dolt_change_manifest')} type="button">
          Select dolt change manifest node
        </button>
        <button onClick={() => onSelectionChange?.('dolt_dump')} type="button">
          Select dolt dump node
        </button>
        <button onClick={() => onSelectionChange?.('dolt_diff_export')} type="button">
          Select dolt diff export node
        </button>
        <button onClick={() => onSelectionChange?.('load_to_duckdb')} type="button">
          Select load to duckdb node
        </button>
        <button onClick={() => onSelectionChange?.('sql_transform')} type="button">
          Select sql transform node
        </button>
        <button onClick={() => onSelectionChange?.('table_merge')} type="button">
          Select table merge node
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

function buildDoltRepoSourceWorkflow() {
  return {
    ...starterWorkflowFixture,
    workflow_id: 'wf_dolt_repo_source_ui',
    nodes: [
      {
        node_id: 'dolt_repo_source',
        type_id: 'dolt_repo_source',
        definition_version: 1,
        label: 'Dolt Repo Source',
        config: {
          branch: 'main',
          checkout_ref: '',
          clone_mode: 'reuse_local_copy',
          connection_ref: 'dolthub_public',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          repository: 'post-no-preference/earnings',
          sync_strategy: 'pull_before_execution'
        },
        position: {
          x: 200,
          y: 180
        }
      }
    ],
    edges: []
  };
}

function buildDoltRepoSyncWorkflow() {
  const workflow = buildDoltRepoSourceWorkflow();

  workflow.nodes.push({
    node_id: 'dolt_repo_sync',
    type_id: 'dolt_repo_sync',
    definition_version: 1,
    label: 'Dolt Repo Sync',
    config: {
      branch_guard: 'require_tracked_branch_match',
      dirty_working_copy_policy: 'fail_if_dirty',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      no_change_behavior: 'emit_current_range',
      sync_action: 'pull_remote_head'
    },
    position: {
      x: 520,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_repo_source_to_repo_sync',
    source_node_id: 'dolt_repo_source',
    source_port_id: 'repo_out',
    target_node_id: 'dolt_repo_sync',
    target_port_id: 'repo'
  });

  return workflow;
}

function buildCheckpointReadWorkflow() {
  const workflow = buildDoltRepoSyncWorkflow();
  const repoSourceNode = workflow.nodes.find((node) => node.node_id === 'dolt_repo_source');

  repoSourceNode.config.repository = 'post-no-preference/options';

  workflow.nodes.push({
    node_id: 'checkpoint_read',
    type_id: 'checkpoint_read',
    definition_version: 1,
    label: 'Checkpoint Read',
    config: {
      branch: 'main',
      checkpoint_table: 'tables.ingest_checkpoints',
      emit_bootstrap_marker_if_missing: true,
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      fail_on_stale_checkpoint: false,
      source_repo: 'post-no-preference/options'
    },
    position: {
      x: 180,
      y: 120
    }
  });
  workflow.edges.push({
    edge_id: 'edge_checkpoint_read_to_dolt_repo_sync',
    source_node_id: 'checkpoint_read',
    source_port_id: 'checkpoint',
    target_node_id: 'dolt_repo_sync',
    target_port_id: 'checkpoint'
  });

  return workflow;
}

function buildDoltChangeManifestWorkflow() {
  const workflow = buildDoltRepoSyncWorkflow();

  workflow.nodes.push({
    node_id: 'dolt_change_manifest',
    type_id: 'dolt_change_manifest',
    definition_version: 1,
    label: 'Dolt Change Manifest',
    config: {
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      schema_change_policy: 'flag_and_continue',
      selected_tables: [],
      table_scope: 'all_tables'
    },
    position: {
      x: 840,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_repo_sync_to_change_manifest',
    source_node_id: 'dolt_repo_sync',
    source_port_id: 'repo_out',
    target_node_id: 'dolt_change_manifest',
    target_port_id: 'repo'
  });

  return workflow;
}

function buildDoltDumpWorkflow() {
  const workflow = buildDoltChangeManifestWorkflow();

  workflow.nodes.push({
    node_id: 'dolt_dump',
    type_id: 'dolt_dump',
    definition_version: 1,
    label: 'Dolt Dump',
    config: {
      artifact_retention: 'keep_latest_success',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      output_directory_policy: 'ephemeral_run_bundle',
      output_format: 'parquet',
      selected_tables: [],
      table_selection_mode: 'prefer_manifest_scope'
    },
    position: {
      x: 1160,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_change_manifest_to_dolt_dump',
    source_node_id: 'dolt_change_manifest',
    source_port_id: 'manifest',
    target_node_id: 'dolt_dump',
    target_port_id: 'repo'
  });

  return workflow;
}

function buildDoltDiffExportWorkflow() {
  const workflow = buildDoltChangeManifestWorkflow();

  workflow.nodes.push({
    node_id: 'dolt_diff_export',
    type_id: 'dolt_diff_export',
    definition_version: 1,
    label: 'Dolt Diff Export',
    config: {
      change_filter: 'all_changes',
      deleted_row_handling: 'emit_delete_markers',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      output_format: 'parquet'
    },
    position: {
      x: 1480,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_change_manifest_to_dolt_diff_export',
    source_node_id: 'dolt_change_manifest',
    source_port_id: 'manifest',
    target_node_id: 'dolt_diff_export',
    target_port_id: 'manifest'
  });

  return workflow;
}

function buildLoadToDuckDbWorkflow() {
  const workflow = buildDoltDumpWorkflow();

  workflow.nodes.push({
    node_id: 'load_to_duckdb',
    type_id: 'load_to_duckdb',
    definition_version: 1,
    label: 'Load to DuckDB',
    config: {
      delta_context_preservation: 'preserve_commit_range_and_delete_flags',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      schema_handling: 'infer_on_first_load_validate_on_recurring',
      table_mapping: 'bundle_aware_staging_names',
      target_schema: 'staging'
    },
    position: {
      x: 1800,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_dolt_dump_to_load_to_duckdb',
    source_node_id: 'dolt_dump',
    source_port_id: 'bundle',
    target_node_id: 'load_to_duckdb',
    target_port_id: 'bundle'
  });

  return workflow;
}

function buildSqlTransformCollectionWorkflow() {
  const workflow = buildLoadToDuckDbWorkflow();

  workflow.nodes.push({
    node_id: 'sql_transform',
    type_id: 'sql_transform',
    definition_version: 1,
    label: 'SQL Transform',
    config: {
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      materialization_mode: 'view',
      output_table_name: '',
      output_table_name_template: '{{table_name}}__normalized',
      source_table_name: '',
      sql_text: 'select *\nfrom {{source}}',
      target_schema: 'staging_curated'
    },
    position: {
      x: 2120,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_load_to_duckdb_tables_to_sql_transform_items',
    source_node_id: 'load_to_duckdb',
    source_port_id: 'tables',
    target_node_id: 'sql_transform',
    target_port_id: 'items'
  });

  return workflow;
}

function buildTableMergeWorkflow() {
  const workflow = buildLoadToDuckDbWorkflow();

  workflow.nodes.push({
    node_id: 'table_merge',
    type_id: 'table_merge',
    definition_version: 1,
    label: 'Table Merge',
    config: {
      delete_handling: 'apply_delete_markers',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      merge_key_columns: ['symbol', 'report_date'],
      schema_drift_behavior: 'fail_and_require_review',
      target_schema: 'tables',
      write_policy: 'upsert'
    },
    position: {
      x: 2120,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_load_to_duckdb_to_table_merge',
    source_node_id: 'load_to_duckdb',
    source_port_id: 'table',
    target_node_id: 'table_merge',
    target_port_id: 'table'
  });

  return workflow;
}

function buildCheckpointWriteWorkflow() {
  const workflow = buildTableMergeWorkflow();

  workflow.nodes.push({
    node_id: 'checkpoint_write',
    type_id: 'checkpoint_write',
    definition_version: 1,
    label: 'Checkpoint Write',
    config: {
      advance_on_partial_success: false,
      checkpoint_table: 'tables.ingest_checkpoints',
      commit_source: 'metadata.current_commit',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      only_persist_on_full_success: true,
      write_timing: 'after_merge_success'
    },
    position: {
      x: 2440,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_table_merge_to_checkpoint_write',
    source_node_id: 'table_merge',
    source_port_id: 'table',
    target_node_id: 'checkpoint_write',
    target_port_id: 'table'
  });

  return workflow;
}

function buildQualityCheckWorkflow() {
  const workflow = buildTableMergeWorkflow();

  workflow.nodes.push({
    node_id: 'quality_check',
    type_id: 'quality_check',
    definition_version: 1,
    label: 'Quality Check',
    config: {
      allow_warning_only_runs_to_continue: true,
      block_checkpoint_write_on_failure: true,
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      null_key_policy: 'block_on_primary_key_nulls',
      schema_drift_rule: 'fail_on_required_column_drift',
      suite_preset: 'post_merge_ingest_gate',
      warning_budget: 2
    },
    position: {
      x: 2440,
      y: 180
    }
  });
  workflow.edges.push({
    edge_id: 'edge_table_merge_to_quality_check',
    source_node_id: 'table_merge',
    source_port_id: 'table',
    target_node_id: 'quality_check',
    target_port_id: 'table'
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

  it('shows the dolt repo source management panel with repo controls', async () => {
    const workflowWithDoltRepoSource = buildDoltRepoSourceWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithDoltRepoSource.workflow_id,
        version: workflowWithDoltRepoSource.version
      },
      definition: workflowWithDoltRepoSource
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithDoltRepoSource.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select dolt repo source node' }));

    expect(await screen.findByLabelText('Connection ref')).toHaveTextContent('dolthub_public');
    expect(screen.getByLabelText('Repository')).toHaveValue('post-no-preference/earnings');
    expect(screen.getByLabelText('Branch')).toHaveTextContent('main');
    expect(screen.getByLabelText('Checkout ref override')).toHaveValue('');
    expect(screen.getByLabelText('Clone mode')).toHaveTextContent('Reuse local working copy');
    expect(screen.getByLabelText('Sync strategy')).toHaveTextContent('Pull before execution');
    expect(screen.getByLabelText('Current repo state')).toHaveTextContent('a34ef9c');
    expect(screen.getByLabelText('Current repo state')).toHaveTextContent('pull before execution');
  });

  it('shows the dolt repo sync management panel with recurring sync controls', async () => {
    const workflowWithDoltRepoSync = buildDoltRepoSyncWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithDoltRepoSync.workflow_id,
        version: workflowWithDoltRepoSync.version
      },
      definition: workflowWithDoltRepoSync
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithDoltRepoSync.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select dolt repo sync node' }));

    expect(await screen.findByLabelText('Sync action')).toHaveTextContent('Pull remote head');
    expect(screen.getByLabelText('No-change behavior')).toHaveTextContent(
      'Emit same from/to commit'
    );
    expect(screen.getByLabelText('Branch guard')).toHaveTextContent(
      'Require tracked branch match'
    );
    expect(screen.getByLabelText('Dirty working copy policy')).toHaveTextContent(
      'Fail if local repo is dirty'
    );
    expect(screen.getByLabelText('Current sync state')).toHaveTextContent('92fd7ac');
    expect(screen.getByLabelText('Current sync state')).toHaveTextContent('a34ef9c');
    expect(screen.getByLabelText('Input repo handle')).toHaveTextContent(
      'post-no-preference/earnings'
    );
  });

  it('shows the checkpoint read management panel and checkpoint-aware sync state', async () => {
    const workflowWithCheckpointRead = buildCheckpointReadWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithCheckpointRead.workflow_id,
        version: workflowWithCheckpointRead.version
      },
      definition: workflowWithCheckpointRead
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithCheckpointRead.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select checkpoint read node' }));

    expect(await screen.findByLabelText('Current checkpoint state')).toHaveTextContent(
      'tables.ingest_checkpoints'
    );
    expect(screen.getByLabelText('Current checkpoint state')).toHaveTextContent('ac31f0b');
    expect(screen.getByLabelText('Current checkpoint state')).toHaveTextContent(
      'Recurring Delta'
    );
    expect(screen.getByLabelText('Checkpoint output contract')).toHaveTextContent(
      'checkpoint_context'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select dolt repo sync node' }));

    expect(await screen.findByLabelText('Previous commit source')).toHaveTextContent(
      'checkpoint_context.last_synced_commit'
    );
    expect(screen.getByLabelText('Previous commit source')).toHaveTextContent('ac31f0b');
  });

  it('shows the dolt change manifest management panel with scoped manifest controls', async () => {
    const workflowWithDoltChangeManifest = buildDoltChangeManifestWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithDoltChangeManifest.workflow_id,
        version: workflowWithDoltChangeManifest.version
      },
      definition: workflowWithDoltChangeManifest
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithDoltChangeManifest.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select dolt change manifest node' }));

    expect(await screen.findByLabelText('Table scope')).toHaveTextContent('All tables in repo');
    expect(screen.getByLabelText('Schema change policy')).toHaveTextContent(
      'Flag and continue'
    );
    expect(screen.getByLabelText('Resolved range')).toHaveTextContent('92fd7ac');
    expect(screen.getByLabelText('Resolved range')).toHaveTextContent('a34ef9c');
    expect(screen.getByLabelText('Input repo handle')).toHaveTextContent(
      'post-no-preference/earnings'
    );
    expect(screen.getByLabelText('Manifest preview')).toHaveTextContent('3 tables');
    expect(screen.getByLabelText('Manifest preview')).toHaveTextContent('1 table flagged');
  });

  it('shows the dolt dump management panel with export bundle controls', async () => {
    const workflowWithDoltDump = buildDoltDumpWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithDoltDump.workflow_id,
        version: workflowWithDoltDump.version
      },
      definition: workflowWithDoltDump
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithDoltDump.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select dolt dump node' }));

    expect(await screen.findByLabelText('Table selection mode')).toHaveTextContent(
      'Prefer manifest scope, else all tables'
    );
    expect(screen.getByLabelText('File format')).toHaveTextContent('Parquet');
    expect(screen.getByLabelText('Artifact retention')).toHaveTextContent(
      'Keep latest successful bundle'
    );
    expect(screen.getByLabelText('Output directory policy')).toHaveTextContent(
      'Ephemeral run bundle'
    );
    expect(screen.getByLabelText('Input handle')).toHaveTextContent(
      'post-no-preference/earnings'
    );
    expect(screen.getByLabelText('Input handle')).toHaveTextContent(
      'dataset_ref.manifest_ref'
    );
    expect(screen.getByLabelText('Current export state')).toHaveTextContent('change manifest');
    expect(screen.getByLabelText('Current export state')).toHaveTextContent('3 changed');
  });

  it('shows the dolt diff export management panel with delta bundle controls', async () => {
    const workflowWithDoltDiffExport = buildDoltDiffExportWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithDoltDiffExport.workflow_id,
        version: workflowWithDoltDiffExport.version
      },
      definition: workflowWithDoltDiffExport
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithDoltDiffExport.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select dolt diff export node' }));

    expect(await screen.findByLabelText('Change filter')).toHaveTextContent('All changes');
    expect(screen.getByLabelText('File format')).toHaveTextContent('Parquet');
    expect(screen.getByLabelText('Deleted row handling')).toHaveTextContent(
      'Emit delete markers'
    );
    expect(screen.getByLabelText('Input manifest')).toHaveTextContent(
      'post-no-preference/earnings'
    );
    expect(screen.getByLabelText('Input manifest')).toHaveTextContent('3 tables');
    expect(screen.getByLabelText('Current delta state')).toHaveTextContent('92fd7ac');
    expect(screen.getByLabelText('Current delta state')).toHaveTextContent('All changes');
    expect(screen.getByLabelText('Current delta state')).toHaveTextContent('none flagged');
  });

  it('shows the load to duckdb management panel with staging landing controls', async () => {
    const workflowWithLoadToDuckDb = buildLoadToDuckDbWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithLoadToDuckDb.workflow_id,
        version: workflowWithLoadToDuckDb.version
      },
      definition: workflowWithLoadToDuckDb
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithLoadToDuckDb.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select load to duckdb node' }));

    expect(await screen.findByLabelText('Target schema')).toHaveTextContent('staging');
    expect(screen.getByLabelText('Table mapping')).toHaveTextContent(
      'Bundle-aware staging names'
    );
    expect(screen.getByLabelText('Schema handling')).toHaveTextContent(
      'Infer first, validate later'
    );
    expect(screen.getByLabelText('Delta context preservation')).toHaveTextContent(
      'Preserve commit range and delete flags'
    );
    expect(screen.getByLabelText('Input bundle')).toHaveTextContent('dolt_dump bundle');
    expect(screen.getByLabelText('Input bundle')).toHaveTextContent(
      'post-no-preference/earnings'
    );
    expect(screen.getByLabelText('Current staging state')).toHaveTextContent(
      'snapshot bundle'
    );
    expect(screen.getByLabelText('Current staging state')).toHaveTextContent('3 tables');
  });

  it('shows the sql transform management panel with per-table template controls', async () => {
    const workflowWithSqlTransform = buildSqlTransformCollectionWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithSqlTransform.workflow_id,
        version: workflowWithSqlTransform.version
      },
      definition: workflowWithSqlTransform
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithSqlTransform.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select sql transform node' }));

    expect(await screen.findByLabelText('Current transform state')).toHaveTextContent(
      'Per-table SQL template'
    );
    expect(screen.getByLabelText('Current transform state')).toHaveTextContent('3 tables');
    expect(screen.getByLabelText('SQL transform input summary')).toHaveTextContent(
      'Table collection'
    );
    expect(screen.getByLabelText('SQL transform input summary')).toHaveTextContent(
      'load_to_duckdb table_ref_collection'
    );
    expect(screen.getByLabelText('SQL transform input summary')).toHaveTextContent(
      'staging.earnings_calendar'
    );
    expect(screen.getByLabelText('Single-table source override status')).toHaveTextContent(
      'disabled for table collections'
    );
    expect(screen.getByLabelText('Output table name template')).toHaveValue(
      '{{table_name}}__normalized'
    );
    expect(screen.getByLabelText('SQL template')).toHaveValue('select *\nfrom {{source}}');
    expect(screen.getByLabelText('SQL transform preview context')).toHaveTextContent(
      'staging_curated.earnings_calendar__normalized'
    );
    expect(screen.getByLabelText('SQL transform preview context')).toHaveTextContent(
      'staging_curated.{{table_name}}__normalized'
    );
    expect(screen.getByLabelText('Rendered SQL preview')).toHaveTextContent(
      'from staging.earnings_calendar'
    );
    expect(screen.getByText('Transform contract').closest('.canvas-node-panel__footer')).toHaveTextContent(
      'same SQL template per table'
    );
  });

  it('shows the table merge management panel with durable reconcile controls', async () => {
    const workflowWithTableMerge = buildTableMergeWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithTableMerge.workflow_id,
        version: workflowWithTableMerge.version
      },
      definition: workflowWithTableMerge
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithTableMerge.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select table merge node' }));

    expect(await screen.findByLabelText('Target schema')).toHaveTextContent('tables');
    expect(screen.getByLabelText('Write policy')).toHaveTextContent('Upsert');
    expect(screen.getByLabelText('Merge key')).toHaveValue('symbol, report_date');
    expect(screen.getByLabelText('Delete handling')).toHaveTextContent(
      'Apply delete markers'
    );
    expect(screen.getByLabelText('Schema drift behavior')).toHaveTextContent(
      'Fail and require review'
    );
    expect(screen.getByLabelText('Current merge state')).toHaveTextContent(
      'earnings_calendar +2 more'
    );
  });

  it('shows the checkpoint write management panel with checkpoint persistence controls', async () => {
    const workflowWithCheckpointWrite = buildCheckpointWriteWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithCheckpointWrite.workflow_id,
        version: workflowWithCheckpointWrite.version
      },
      definition: workflowWithCheckpointWrite
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithCheckpointWrite.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select checkpoint write node' }));

    expect(await screen.findByLabelText('Checkpoint table')).toHaveValue(
      'tables.ingest_checkpoints'
    );
    expect(screen.getByLabelText('Commit source')).toHaveTextContent(
      'metadata.current_commit'
    );
    expect(screen.getByLabelText('Write timing')).toHaveTextContent(
      'After merge success'
    );
    expect(screen.getByLabelText('Current checkpoint plan')).toHaveTextContent('a34ef9c');
    expect(screen.getByLabelText('Current checkpoint plan')).toHaveTextContent(
      'Bootstrap Refresh'
    );
    expect(screen.getByLabelText('Input durable table')).toHaveTextContent(
      'post-no-preference/earnings'
    );
    expect(screen.getByLabelText('Checkpoint write output contract')).toHaveTextContent(
      'checkpoint_write_result'
    );
  });

  it('shows the quality check management panel with gate controls', async () => {
    const workflowWithQualityCheck = buildQualityCheckWorkflow();

    api.getWorkflow.mockResolvedValue({
      workflow: {
        workflow_id: workflowWithQualityCheck.workflow_id,
        version: workflowWithQualityCheck.version
      },
      definition: workflowWithQualityCheck
    });

    render(
      <CanvasWorkspace
        workflowId={workflowWithQualityCheck.workflow_id}
        workspaceId="ws_test"
      />
    );

    await screen.findByLabelText('Workflow run status');

    fireEvent.click(screen.getByRole('button', { name: 'Select quality check node' }));

    expect(await screen.findByLabelText('Suite preset')).toHaveTextContent(
      'Post-merge ingest gate'
    );
    expect(screen.getByLabelText('Schema drift rule')).toHaveTextContent(
      'Fail on required column drift'
    );
    expect(screen.getByLabelText('Null key policy')).toHaveTextContent(
      'Block on primary-key nulls'
    );
    expect(screen.getByLabelText('Warning budget')).toHaveValue(2);
    expect(screen.getByLabelText('Current gate state')).toHaveTextContent('Warn');
    expect(screen.getByLabelText('Current gate state')).toHaveTextContent('a34ef9c');
    expect(screen.getByLabelText('Input durable table')).toHaveTextContent(
      'post-no-preference/earnings'
    );
    expect(screen.getByLabelText('Quality check output contract')).toHaveTextContent(
      'quality_gate_result'
    );
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
