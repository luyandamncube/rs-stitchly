import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json'
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json'
import { setDraggedNodeType } from '../lib/canvasDnD'
import { cloneWorkflow } from '../lib/workflow'
import WorkflowCanvas from './WorkflowCanvas'

function CanvasHarness({
  activeRunSnapshot = null,
  onNodeTypeDrop = () => {},
  workflowOverride = null
}) {
  const [workflow, setWorkflow] = useState(() =>
    cloneWorkflow(workflowOverride ?? workflowFixture)
  )
  const [selectedNodeId, setSelectedNodeId] = useState(null)

  return (
    <WorkflowCanvas
      activeRunSnapshot={activeRunSnapshot}
      nodeDefinitions={nodeDefinitionFixture.node_definitions}
      onNodeTypeDrop={onNodeTypeDrop}
      onSelectionChange={setSelectedNodeId}
      onWorkflowChange={setWorkflow}
      selectedNodeId={selectedNodeId}
      workflow={workflow}
    />
  )
}

function getSendEmailNode() {
  const node = screen.getByText('Send Email').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getTextInputNode() {
  const node = screen.getByText('Text Input').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getTableOutputNode() {
  const node = screen.getByText('Table Output').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getTableInputNode() {
  const node = screen.getByText('Table Input').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getTableSchemaNode() {
  const node = screen.getByText('Table Schema').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getDoltRepoSourceNode() {
  const node = screen.getByText('Dolt Repo Source').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getCheckpointReadNode() {
  const node = screen.getByText('Checkpoint Read').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getCheckpointWriteNode() {
  const node = screen.getByText('Checkpoint Write').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getDoltRepoSyncNode() {
  const node = screen.getByText('Dolt Repo Sync').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getDoltChangeManifestNode() {
  const node = screen.getByText('Dolt Change Manifest').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getDoltDumpNode() {
  const node = screen.getByText('Dolt Dump').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getDoltDiffExportNode() {
  const node = screen.getByText('Dolt Diff Export').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getLoadToDuckDbNode() {
  const node = screen.getByText('Load to DuckDB').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}


function getSqlTransformNode() {
  const node = screen.getByText('SQL Transform').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getTableMergeNode() {
  const node = screen.getByText('Table Merge').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getQualityCheckNode() {
  const node = screen.getByText('Quality Check').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function buildTableOutputWorkflow() {
  const workflow = cloneWorkflow(workflowFixture)

  workflow.nodes.push({
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
  })
  workflow.edges.push({
    edge_id: 'edge_input_text_to_table_output_text',
    source_node_id: 'input_text',
    source_port_id: 'text',
    target_node_id: 'table_output_news_brief',
    target_port_id: 'text'
  })

  return workflow
}

function buildTableSchemaOutputWorkflow() {
  const workflow = buildTableOutputWorkflow()
  const tableOutputNode = workflow.nodes.find((node) => node.node_id === 'table_output_news_brief')

  tableOutputNode.config.input_shape = 'table_schema'

  return workflow
}

function buildTableInputWorkflow() {
  const workflow = cloneWorkflow(workflowFixture)

  workflow.nodes.push({
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
      y: 320
    }
  })

  return workflow
}

function buildTableSchemaWorkflow() {
  const workflow = cloneWorkflow(workflowFixture)

  workflow.nodes.push({
    node_id: 'table_schema_orders',
    type_id: 'table_schema',
    definition_version: 1,
    label: 'Table Schema',
    config: {
      catalog: 'workflow.duckdb',
      checks: ['total_amount >= 0'],
      columns: [
        {
          name: 'order_id',
          nullable: false,
          primary_key: true,
          type: 'bigint'
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
      x: 120,
      y: 320
    }
  })

  return workflow
}

function buildMultiTableSchemaWorkflow() {
  const workflow = buildTableSchemaWorkflow()
  const tableSchemaNode = workflow.nodes.find((node) => node.node_id === 'table_schema_orders')

  tableSchemaNode.config.tables = [
    {
      schema_name: 'tables',
      table_name: 'orders',
      output_alias: 'orders_definition',
      create_mode: 'create_if_missing',
      columns: [
        {
          name: 'order_id',
          nullable: false,
          primary_key: true,
          type: 'bigint'
        }
      ]
    },
    {
      schema_name: 'tables',
      table_name: 'order_lines',
      output_alias: 'order_lines_definition',
      create_mode: 'create_if_missing',
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
        }
      ]
    }
  ]

  return workflow
}

function buildDoltRepoSourceWorkflow() {
  const workflow = cloneWorkflow(workflowFixture)

  workflow.nodes.push({
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
      x: 120,
      y: 320
    }
  })

  return workflow
}

function buildDoltRepoSyncWorkflow() {
  const workflow = buildDoltRepoSourceWorkflow()

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
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_repo_source_to_repo_sync',
    source_node_id: 'dolt_repo_source',
    source_port_id: 'repo_out',
    target_node_id: 'dolt_repo_sync',
    target_port_id: 'repo'
  })

  return workflow
}

function buildCheckpointReadWorkflow() {
  const workflow = buildDoltRepoSyncWorkflow()
  const repoSourceNode = workflow.nodes.find((node) => node.node_id === 'dolt_repo_source')

  repoSourceNode.config.repository = 'post-no-preference/options'

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
      x: 120,
      y: 220
    }
  })
  workflow.edges.push({
    edge_id: 'edge_checkpoint_read_to_dolt_repo_sync',
    source_node_id: 'checkpoint_read',
    source_port_id: 'checkpoint',
    target_node_id: 'dolt_repo_sync',
    target_port_id: 'checkpoint'
  })

  return workflow
}

function buildDoltChangeManifestWorkflow() {
  const workflow = buildDoltRepoSyncWorkflow()

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
      x: 920,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_repo_sync_to_change_manifest',
    source_node_id: 'dolt_repo_sync',
    source_port_id: 'repo_out',
    target_node_id: 'dolt_change_manifest',
    target_port_id: 'repo'
  })

  return workflow
}

function buildDoltDumpWorkflow() {
  const workflow = buildDoltChangeManifestWorkflow()

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
      x: 1320,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_change_manifest_to_dolt_dump',
    source_node_id: 'dolt_change_manifest',
    source_port_id: 'manifest',
    target_node_id: 'dolt_dump',
    target_port_id: 'repo'
  })

  return workflow
}

function buildDoltDiffExportWorkflow() {
  const workflow = buildDoltChangeManifestWorkflow()

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
      x: 1320,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_change_manifest_to_dolt_diff_export',
    source_node_id: 'dolt_change_manifest',
    source_port_id: 'manifest',
    target_node_id: 'dolt_diff_export',
    target_port_id: 'manifest'
  })

  return workflow
}

function buildLoadToDuckDbFromDumpWorkflow() {
  const workflow = buildDoltDumpWorkflow()

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
      x: 1720,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_dolt_dump_to_load_to_duckdb',
    source_node_id: 'dolt_dump',
    source_port_id: 'bundle',
    target_node_id: 'load_to_duckdb',
    target_port_id: 'bundle'
  })

  return workflow
}

function buildLoadToDuckDbFromDiffWorkflow() {
  const workflow = buildDoltDiffExportWorkflow()

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
      x: 1720,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_dolt_diff_export_to_load_to_duckdb',
    source_node_id: 'dolt_diff_export',
    source_port_id: 'bundle',
    target_node_id: 'load_to_duckdb',
    target_port_id: 'bundle'
  })

  return workflow
}


function buildSqlTransformCollectionWorkflow() {
  const workflow = buildLoadToDuckDbFromDumpWorkflow()

  workflow.nodes.push({
    node_id: 'sql_transform',
    type_id: 'sql_transform',
    definition_version: 1,
    label: 'SQL Transform',
    config: {
      materialization_mode: 'view',
      output_table_name_template: '{{table_name}}__normalized',
      sql_text: 'select * from {{source}}',
      target_schema: 'staging_curated'
    },
    position: { x: 2120, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_load_to_duckdb_tables_to_sql_transform_items',
    source_node_id: 'load_to_duckdb',
    source_port_id: 'tables',
    target_node_id: 'sql_transform',
    target_port_id: 'items'
  })

  return workflow
}

function buildTableMergeWorkflow() {
  const workflow = buildLoadToDuckDbFromDumpWorkflow()

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
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_load_to_duckdb_to_table_merge',
    source_node_id: 'load_to_duckdb',
    source_port_id: 'table',
    target_node_id: 'table_merge',
    target_port_id: 'table'
  })

  return workflow
}


function buildTableMergeCollectionWorkflow() {
  const workflow = buildSqlTransformCollectionWorkflow()

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
      x: 2520,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_sql_transform_items_to_table_merge_items',
    source_node_id: 'sql_transform',
    source_port_id: 'items',
    target_node_id: 'table_merge',
    target_port_id: 'items'
  })

  return workflow
}

function buildCheckpointWriteWorkflow() {
  const workflow = buildTableMergeWorkflow()

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
      x: 2520,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_table_merge_to_checkpoint_write',
    source_node_id: 'table_merge',
    source_port_id: 'table',
    target_node_id: 'checkpoint_write',
    target_port_id: 'table'
  })

  return workflow
}

function buildQualityCheckWorkflow() {
  const workflow = buildTableMergeWorkflow()

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
      x: 2520,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_table_merge_to_quality_check',
    source_node_id: 'table_merge',
    source_port_id: 'table',
    target_node_id: 'quality_check',
    target_port_id: 'table'
  })

  return workflow
}


function buildQualityCheckCollectionWorkflow() {
  const workflow = buildTableMergeCollectionWorkflow()

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
      x: 2920,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_table_merge_items_to_quality_check_items',
    source_node_id: 'table_merge',
    source_port_id: 'items',
    target_node_id: 'quality_check',
    target_port_id: 'items'
  })

  return workflow
}

function buildCheckpointWriteCollectionWorkflow() {
  const workflow = buildQualityCheckCollectionWorkflow()

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
      write_timing: 'after_quality_gate'
    },
    position: {
      x: 3320,
      y: 320
    }
  })
  workflow.edges.push({
    edge_id: 'edge_quality_check_items_to_checkpoint_write_items',
    source_node_id: 'quality_check',
    source_port_id: 'items',
    target_node_id: 'checkpoint_write',
    target_port_id: 'items'
  })

  return workflow
}

describe('WorkflowCanvas', () => {
  it('renders the real text input and send email nodes from the persisted workflow', () => {
    render(<CanvasHarness />)

    const textInputNode = getTextInputNode()
    const sendEmailNode = getSendEmailNode()

    expect(textInputNode).toHaveClass('workflow-node-card')
    expect(
      within(textInputNode).getByText(
        'Please inspect the latest failed refunds batch and acknowledge the issue.'
      )
    ).toBeInTheDocument()
    expect(within(textInputNode).getByText('73 chars')).toBeInTheDocument()
    expect(sendEmailNode).toHaveClass('workflow-node-card')
    expect(within(sendEmailNode).getByText('ops@stitchly.dev')).toBeInTheDocument()
    expect(
      within(sendEmailNode).getByText('Failed refunds need review from the latest sync')
    ).toBeInTheDocument()
    expect(within(sendEmailNode).getByText('Last send')).toBeInTheDocument()
  })

  it('does not keep the old placeholder starter nodes in the flow', () => {
    const { container } = render(<CanvasHarness />)

    const textInputNode = container.querySelector('[data-id="input_text"] .workflow-node-card')
    const sendEmailNode = container.querySelector(
      '[data-id="send_email_notification"] .workflow-node-card'
    )
    const placeholderNode = container.querySelector('.schema-node')

    expect(textInputNode).not.toBeNull()
    expect(sendEmailNode).not.toBeNull()
    expect(placeholderNode).toBeNull()
  })

  it('selects a node on click and clears selection on canvas click', () => {
    const { container } = render(<CanvasHarness />)

    const sendEmailNode = getSendEmailNode()
    const canvasPane = container.querySelector('.react-flow__pane')

    expect(canvasPane).not.toBeNull()
    expect(sendEmailNode).not.toHaveClass('is-selected')

    fireEvent.click(sendEmailNode)

    expect(sendEmailNode).toHaveClass('is-selected')

    fireEvent.click(canvasPane)

    expect(sendEmailNode).not.toHaveClass('is-selected')
  })

  it('deletes the selected node with the keyboard shortcut', () => {
    render(<CanvasHarness />)

    const sendEmailNode = getSendEmailNode()

    fireEvent.click(sendEmailNode)
    expect(sendEmailNode).toHaveClass('is-selected')

    fireEvent.keyDown(window, { key: 'Delete' })

    expect(screen.queryByText('Send Email')).not.toBeInTheDocument()
    expect(screen.getByText('Text Input')).toBeInTheDocument()
  })

  it('keeps the node selected on double click without opening a separate inspector', () => {
    render(<CanvasHarness />)

    const sendEmailNode = getSendEmailNode()

    fireEvent.click(sendEmailNode)
    fireEvent.doubleClick(sendEmailNode)

    expect(sendEmailNode).toHaveClass('is-selected')
  })

  it('emits a node drop event when a shelf item is dragged onto the canvas', () => {
    const onNodeTypeDrop = vi.fn()
    const dragData = new Map()
    const dataTransfer = {
      dropEffect: '',
      effectAllowed: '',
      getData(type) {
        return dragData.get(type) ?? ''
      },
      setData(type, value) {
        dragData.set(type, value)
      }
    }

    const { container } = render(<CanvasHarness onNodeTypeDrop={onNodeTypeDrop} />)
    const canvasSurface = container.querySelector('.canvas-surface')

    expect(canvasSurface).not.toBeNull()

    setDraggedNodeType(dataTransfer, 'send_email')
    fireEvent.dragOver(canvasSurface, { dataTransfer })
    fireEvent.drop(canvasSurface, { clientX: 240, clientY: 180, dataTransfer })

    expect(onNodeTypeDrop).toHaveBeenCalledWith(
      'send_email',
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number)
      })
    )
  })

  it('maps an active run snapshot into real node runtime states', () => {
    const activeRunSnapshot = {
      run_id: 'run_phase1',
      workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
      workflow_version: 1,
      status: 'failed',
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
          last_output: {
            data_type: 'text',
            value: 'Normalized output'
          },
          log_count: 1,
          error: null
        },
        {
          node_id: 'send_email_notification',
          type_id: 'send_email',
          status: 'failed',
          attempt: 1,
          started_at: '2026-05-26T08:00:01Z',
          finished_at: '2026-05-26T08:00:05Z',
          last_output: null,
          log_count: 1,
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

    render(<CanvasHarness activeRunSnapshot={activeRunSnapshot} />)

    const textInputNode = getTextInputNode()
    const sendEmailNode = getSendEmailNode()

    expect(textInputNode).toHaveAttribute('data-runtime-state', 'succeeded')
    expect(sendEmailNode).toHaveAttribute('data-runtime-state', 'failed')
    expect(within(textInputNode).getByText('Succeeded')).toBeInTheDocument()
    expect(within(sendEmailNode).getByText('Failed')).toBeInTheDocument()
    expect(within(textInputNode).getByText('Normalized output')).toBeInTheDocument()
  })

  it('shows the execution wait marker when a node has configured waits', () => {
    const workflowWithWait = cloneWorkflow(workflowFixture)
    const sendEmailNode = workflowWithWait.nodes.find(
      (node) => node.node_id === 'send_email_notification'
    )

    sendEmailNode.config.execution = {
      wait_before_seconds: 5,
      wait_after_seconds: 3
    }

    render(<CanvasHarness workflowOverride={workflowWithWait} />)

    const emailNode = getSendEmailNode()
    const delayIcon = emailNode.querySelector('.workflow-node-card__delay-icon')

    expect(delayIcon).not.toBeNull()
    expect(delayIcon).toHaveTextContent('←')
    expect(delayIcon).toHaveTextContent('→')
  })

  it('renders the table output node with destination and shape details', () => {
    render(<CanvasHarness workflowOverride={buildTableOutputWorkflow()} />)

    const tableOutputNode = getTableOutputNode()

    expect(tableOutputNode).toHaveClass('workflow-node-card--table-output')
    expect(within(tableOutputNode).getByText('outputs.news_brief')).toBeInTheDocument()
    expect(within(tableOutputNode).getByText('Single text row')).toBeInTheDocument()
    expect(within(tableOutputNode).getByText('Last write')).toBeInTheDocument()
  })

  it('renders the table output node with the schema bootstrap label', () => {
    render(<CanvasHarness workflowOverride={buildTableSchemaOutputWorkflow()} />)

    const tableOutputNode = getTableOutputNode()

    expect(within(tableOutputNode).getByText('Schema bootstrap')).toBeInTheDocument()
  })

  it('renders the table input node with source and catalog details', () => {
    render(<CanvasHarness workflowOverride={buildTableInputWorkflow()} />)

    const tableInputNode = getTableInputNode()

    expect(tableInputNode).toHaveClass('workflow-node-card--table-input')
    expect(within(tableInputNode).getByText('runs.workflow_runs')).toBeInTheDocument()
    expect(within(tableInputNode).getByText('All columns')).toBeInTheDocument()
    expect(within(tableInputNode).getByText('workflow.duckdb')).toBeInTheDocument()
  })

  it('renders the table schema node with workflow card styling instead of the generic schema fallback', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildTableSchemaWorkflow()} />)

    const tableSchemaNode = getTableSchemaNode()

    expect(tableSchemaNode).toHaveClass('workflow-node-card--table-schema')
    expect(within(tableSchemaNode).getByText('orders')).toBeInTheDocument()
    expect(within(tableSchemaNode).getByText('1 col')).toBeInTheDocument()
    expect(within(tableSchemaNode).getByText('create_if_missing')).toBeInTheDocument()
    expect(within(tableSchemaNode).getByText('orders_definition')).toBeInTheDocument()
    expect(container.querySelector('[data-id="table_schema_orders"] .schema-node')).toBeNull()
  })

  it('renders multi-table schema nodes as table bundles instead of a fake schema destination', () => {
    render(<CanvasHarness workflowOverride={buildMultiTableSchemaWorkflow()} />)

    const tableSchemaNode = getTableSchemaNode()

    expect(within(tableSchemaNode).getByText('2 tables')).toBeInTheDocument()
    expect(within(tableSchemaNode).getByText('3 cols')).toBeInTheDocument()
    expect(within(tableSchemaNode).getByText('orders +1 more')).toBeInTheDocument()
    expect(within(tableSchemaNode).queryByText(/^tables$/)).toBeNull()
  })

  it('renders the dolt repo source node with workflow card styling instead of the generic schema fallback', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildDoltRepoSourceWorkflow()} />)

    const doltRepoSourceNode = getDoltRepoSourceNode()

    expect(doltRepoSourceNode).toHaveClass('workflow-node-card--dolt-repo-source')
    expect(within(doltRepoSourceNode).getByText('post-no-preference/earnings')).toBeInTheDocument()
    expect(within(doltRepoSourceNode).getByText('main')).toBeInTheDocument()
    expect(within(doltRepoSourceNode).getByText('Pull Before Execution')).toBeInTheDocument()
    expect(within(doltRepoSourceNode).getByText('Current commit')).toBeInTheDocument()
    expect(within(doltRepoSourceNode).getByText('a34ef9c')).toBeInTheDocument()
    expect(container.querySelector('[data-id="dolt_repo_source"] .schema-node')).toBeNull()
  })

  it('renders the dolt repo sync node with commit-range details instead of the generic schema fallback', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildDoltRepoSyncWorkflow()} />)

    const doltRepoSyncNode = getDoltRepoSyncNode()

    expect(doltRepoSyncNode).toHaveClass('workflow-node-card--dolt-repo-sync')
    expect(within(doltRepoSyncNode).getByText('92fd7ac')).toBeInTheDocument()
    expect(within(doltRepoSyncNode).getByText('a34ef9c')).toBeInTheDocument()
    expect(within(doltRepoSyncNode).getByText('Sync action')).toBeInTheDocument()
    expect(within(doltRepoSyncNode).getByText('Pull Remote Head')).toBeInTheDocument()
    expect(container.querySelector('[data-id="dolt_repo_sync"] .schema-node')).toBeNull()
  })

  it('renders the checkpoint read node and feeds its previous commit into dolt repo sync', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildCheckpointReadWorkflow()} />)

    const checkpointReadNode = getCheckpointReadNode()
    const doltRepoSyncNode = getDoltRepoSyncNode()

    expect(checkpointReadNode).toHaveClass('workflow-node-card--checkpoint-read')
    expect(within(checkpointReadNode).getByText('repo checkpoint')).toBeInTheDocument()
    expect(within(checkpointReadNode).getByText('bootstrap marker')).toBeInTheDocument()
    expect(within(checkpointReadNode).getByText('ac31f0b')).toBeInTheDocument()
    expect(within(doltRepoSyncNode).getByText('ac31f0b')).toBeInTheDocument()
    expect(container.querySelector('[data-id="checkpoint_read"] .schema-node')).toBeNull()
  })

  it('renders the dolt change manifest node with scoped change details instead of the generic schema fallback', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildDoltChangeManifestWorkflow()} />)

    const doltChangeManifestNode = getDoltChangeManifestNode()

    expect(doltChangeManifestNode).toHaveClass('workflow-node-card--dolt-change-manifest')
    expect(within(doltChangeManifestNode).getByText('92fd7ac -> a34ef9c')).toBeInTheDocument()
    expect(within(doltChangeManifestNode).getByText('all tables')).toBeInTheDocument()
    expect(within(doltChangeManifestNode).getByText('Schema drift')).toBeInTheDocument()
    expect(within(doltChangeManifestNode).getByText('1 table flagged')).toBeInTheDocument()
    expect(container.querySelector('[data-id="dolt_change_manifest"] .schema-node')).toBeNull()
  })

  it('renders the dolt dump node with bundle export details instead of the generic schema fallback', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildDoltDumpWorkflow()} />)

    const doltDumpNode = getDoltDumpNode()

    expect(doltDumpNode).toHaveClass('workflow-node-card--dolt-dump')
    expect(within(doltDumpNode).getByText('parquet')).toBeInTheDocument()
    expect(within(doltDumpNode).getByText('3 changed')).toBeInTheDocument()
    expect(within(doltDumpNode).getByText('Bundle')).toBeInTheDocument()
    expect(within(doltDumpNode).getByText('directory_ref')).toBeInTheDocument()
    expect(container.querySelector('[data-id="dolt_dump"] .schema-node')).toBeNull()
  })

  it('renders the dolt diff export node with delta bundle details instead of the generic schema fallback', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildDoltDiffExportWorkflow()} />)

    const doltDiffExportNode = getDoltDiffExportNode()

    expect(doltDiffExportNode).toHaveClass('workflow-node-card--dolt-diff-export')
    expect(within(doltDiffExportNode).getByText('92fd7ac -> a34ef9c')).toBeInTheDocument()
    expect(within(doltDiffExportNode).getByText('All changes')).toBeInTheDocument()
    expect(within(doltDiffExportNode).getByText('Bundle')).toBeInTheDocument()
    expect(within(doltDiffExportNode).getByText('directory_ref')).toBeInTheDocument()
    expect(container.querySelector('[data-id="dolt_diff_export"] .schema-node')).toBeNull()
  })

  it('renders the load to duckdb node with staging landing details instead of the generic schema fallback', () => {
    const { container } = render(
      <CanvasHarness workflowOverride={buildLoadToDuckDbFromDumpWorkflow()} />
    )

    const loadToDuckDbNode = getLoadToDuckDbNode()

    expect(loadToDuckDbNode).toHaveClass('workflow-node-card--load-to-duckdb')
    expect(within(loadToDuckDbNode).getByText('staging')).toBeInTheDocument()
    expect(within(loadToDuckDbNode).getByText('snapshot bundle')).toBeInTheDocument()
    expect(within(loadToDuckDbNode).getByText('Merge context')).toBeInTheDocument()
    expect(within(loadToDuckDbNode).getByText('a34ef9c')).toBeInTheDocument()
    expect(container.querySelector('[data-id="load_to_duckdb"] [data-handleid="table"]')).not.toBeNull()
    expect(container.querySelector('[data-id="load_to_duckdb"] [data-handleid="tables"]')).not.toBeNull()
    expect(container.querySelector('[data-id="load_to_duckdb"] .schema-node')).toBeNull()
  })


  it('renders the sql transform node with legacy and collection handles', () => {
    const { container } = render(
      <CanvasHarness workflowOverride={buildSqlTransformCollectionWorkflow()} />
    )

    const sqlTransformNode = getSqlTransformNode()

    expect(sqlTransformNode).toHaveClass('workflow-node-card--sql-transform')
    expect(within(sqlTransformNode).getByText('view')).toBeInTheDocument()
    expect(within(sqlTransformNode).getByText('Target')).toBeInTheDocument()
    expect(within(sqlTransformNode).getByText('staging_curated.{{table_name}}__normalized')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-id="sql_transform"] [data-handleid="table"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-id="sql_transform"] [data-handleid="items"]')).toHaveLength(2)
    expect(container.querySelector('[data-id="sql_transform"] .schema-node')).toBeNull()
  })

  it('renders the table merge node with durable reconcile details instead of the generic schema fallback', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildTableMergeWorkflow()} />)

    const tableMergeNode = getTableMergeNode()

    expect(tableMergeNode).toHaveClass('workflow-node-card--table-merge')
    expect(within(tableMergeNode).getByText('upsert')).toBeInTheDocument()
    expect(within(tableMergeNode).getByText('symbol, report_date')).toBeInTheDocument()
    expect(within(tableMergeNode).getByText('markers on')).toBeInTheDocument()
    expect(within(tableMergeNode).getByText('Target')).toBeInTheDocument()
    expect(within(tableMergeNode).getByText('tables durable')).toBeInTheDocument()
    expect(container.querySelector('[data-id="table_merge"] .schema-node')).toBeNull()
  })



  it('renders the table merge node with legacy and collection handles', () => {
    const { container } = render(
      <CanvasHarness workflowOverride={buildTableMergeCollectionWorkflow()} />
    )

    const tableMergeNode = getTableMergeNode()

    expect(tableMergeNode).toHaveClass('workflow-node-card--table-merge')
    expect(within(tableMergeNode).getByText('upsert')).toBeInTheDocument()
    expect(within(tableMergeNode).getByText('Target')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-id="table_merge"] [data-handleid="table"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-id="table_merge"] [data-handleid="items"]')).toHaveLength(2)
    expect(container.querySelector('[data-id="table_merge"] .schema-node')).toBeNull()
  })

  it('renders the checkpoint write node with checkpoint persistence details instead of the generic schema fallback', () => {
    const { container } = render(
      <CanvasHarness workflowOverride={buildCheckpointWriteWorkflow()} />
    )

    const checkpointWriteNode = getCheckpointWriteNode()

    expect(checkpointWriteNode).toHaveClass('workflow-node-card--checkpoint-write')
    expect(within(checkpointWriteNode).getByText('success only')).toBeInTheDocument()
    expect(within(checkpointWriteNode).getByText('repo + branch')).toBeInTheDocument()
    expect(within(checkpointWriteNode).getByText('Commit source')).toBeInTheDocument()
    expect(within(checkpointWriteNode).getByText('metadata.current_commit')).toBeInTheDocument()
    expect(container.querySelector('[data-id="checkpoint_write"] .schema-node')).toBeNull()
  })

  it('renders the quality check node with gate details instead of the generic schema fallback', () => {
    const { container } = render(<CanvasHarness workflowOverride={buildQualityCheckWorkflow()} />)

    const qualityCheckNode = getQualityCheckNode()

    expect(qualityCheckNode).toHaveClass('workflow-node-card--quality-check')
    expect(within(qualityCheckNode).getByText('post-merge audit')).toBeInTheDocument()
    expect(within(qualityCheckNode).getByText('checkpoint + publish')).toBeInTheDocument()
    expect(within(qualityCheckNode).getByText('2 warnings')).toBeInTheDocument()
    expect(container.querySelector('[data-id="quality_check"] .schema-node')).toBeNull()
  })


  it('renders the quality check node with legacy and collection handles', () => {
    const { container } = render(
      <CanvasHarness workflowOverride={buildQualityCheckCollectionWorkflow()} />
    )

    const qualityCheckNode = getQualityCheckNode()

    expect(qualityCheckNode).toHaveClass('workflow-node-card--quality-check')
    expect(container.querySelectorAll('[data-id="quality_check"] [data-handleid="table"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-id="quality_check"] [data-handleid="items"]')).toHaveLength(2)
    expect(container.querySelector('[data-id="quality_check"] .schema-node')).toBeNull()
  })

  it('renders the checkpoint write node with legacy and collection handles', () => {
    const { container } = render(
      <CanvasHarness workflowOverride={buildCheckpointWriteCollectionWorkflow()} />
    )

    const checkpointWriteNode = getCheckpointWriteNode()

    expect(checkpointWriteNode).toHaveClass('workflow-node-card--checkpoint-write')
    expect(container.querySelectorAll('[data-id="checkpoint_write"] [data-handleid="table"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-id="checkpoint_write"] [data-handleid="items"]')).toHaveLength(2)
    expect(container.querySelector('[data-id="checkpoint_write"] .schema-node')).toBeNull()
  })
})
