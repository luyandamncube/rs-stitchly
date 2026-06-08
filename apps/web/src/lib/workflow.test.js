import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import {
  canConnect,
  connectWorkflowNodes,
  createCanvasElements,
  removeWorkflowNode,
  removeWorkflowEdge,
  reconnectWorkflowEdge,
  syncWorkflowEdges
} from './workflow';

function buildTableInputToTableOutputWorkflow() {
  return {
    ...workflowFixture,
    nodes: [
      ...workflowFixture.nodes,
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
        position: { x: 120, y: 320 }
      },
      {
        node_id: 'table_output_copy',
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
          table_name: 'workflow_runs_copy',
          target_schema: 'tables',
          value_column: 'content',
          write_mode: 'append'
        },
        position: { x: 560, y: 320 }
      }
    ],
    edges: workflowFixture.edges
  };
}

function buildTableSchemaToTableOutputWorkflow() {
  return {
    ...workflowFixture,
    nodes: [
      ...workflowFixture.nodes,
      {
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
          schema_name: 'output',
          table_name: 'orders'
        },
        position: { x: 120, y: 320 }
      },
      {
        node_id: 'table_output_copy',
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
          table_name: 'workflow_runs_copy',
          target_schema: 'tables',
          value_column: 'content',
          write_mode: 'append'
        },
        position: { x: 560, y: 320 }
      }
    ],
    edges: workflowFixture.edges
  };
}

describe('createCanvasElements', () => {
  it('consumes the shared fixture workflow and preserves its graph shape', () => {
    const graph = createCanvasElements(
      workflowFixture,
      nodeDefinitionFixture.node_definitions,
      workflowFixture.nodes[0].node_id,
      workflowFixture.nodes[1].node_id
    );

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes[0].type).toBe('text_input');
    expect(graph.nodes[0].data.label).toBe('Text Input');
    expect(graph.edges[0].sourceHandle).toBe('text');
    expect(graph.edges[0].targetHandle).toBe('body');
    expect(graph.nodes[1].data.uiState.interaction.hovered).toBe(true);
  });

  it('maps table schema nodes onto their dedicated canvas node type', () => {
    const workflow = buildTableSchemaToTableOutputWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'table_schema_orders',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'table_schema_orders')?.type
    ).toBe('table_schema')
  })

  it('can remove and resync edges from the workflow graph', () => {
    const nextWorkflow = syncWorkflowEdges(workflowFixture, [])

    expect(nextWorkflow.edges).toHaveLength(0)
  })

  it('can remove a workflow edge by id', () => {
    const nextWorkflow = removeWorkflowEdge(
      workflowFixture,
      workflowFixture.edges[0].edge_id
    )

    expect(nextWorkflow.edges).toHaveLength(0)
  })

  it('can remove a workflow node and any attached edges', () => {
    const nextWorkflow = removeWorkflowNode(workflowFixture, 'input_text')

    expect(nextWorkflow.nodes).toHaveLength(1)
    expect(nextWorkflow.nodes[0].node_id).toBe('send_email_notification')
    expect(nextWorkflow.edges).toHaveLength(0)
  })

  it('can reconnect an existing edge without tripping the single-target guard', () => {
    const edge = workflowFixture.edges[0]
    const nextConnection = {
      edgeId: edge.edge_id,
      source: 'input_text',
      sourceHandle: 'text',
      target: 'send_email_notification',
      targetHandle: 'body'
    }

    expect(
      canConnect(nextConnection, workflowFixture, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = reconnectWorkflowEdge(workflowFixture, edge.edge_id, nextConnection)

    expect(nextWorkflow.edges[0].source_node_id).toBe('input_text')
    expect(nextWorkflow.edges[0].target_node_id).toBe('send_email_notification')
    expect(nextWorkflow.edges[0].target_port_id).toBe('body')
  })

  it('replaces an existing single-input edge when a new source connects to the same target port', () => {
    const workflowWithSecondInput = {
      ...workflowFixture,
      nodes: [
        ...workflowFixture.nodes,
        {
          ...workflowFixture.nodes[0],
          node_id: 'input_text_2',
          position: { x: 120, y: 320 }
        }
      ]
    }
    const replacementConnection = {
      source: 'input_text_2',
      sourceHandle: 'text',
      target: 'send_email_notification',
      targetHandle: 'body'
    }

    expect(
      canConnect(replacementConnection, workflowWithSecondInput, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      workflowWithSecondInput,
      replacementConnection,
      nodeDefinitionFixture.node_definitions
    )

    expect(nextWorkflow.edges).toHaveLength(1)
    expect(nextWorkflow.edges[0].source_node_id).toBe('input_text_2')
    expect(nextWorkflow.edges[0].target_node_id).toBe('send_email_notification')
    expect(nextWorkflow.edges[0].target_port_id).toBe('body')
  })

  it('can still validate and connect implemented node types when a definition is missing', () => {
    const definitionsWithoutSendEmail = nodeDefinitionFixture.node_definitions.filter(
      (definition) => definition.type_id !== 'send_email'
    )
    const connection = {
      source: 'input_text',
      sourceHandle: 'text',
      target: 'send_email_notification',
      targetHandle: 'body'
    }

    expect(
      canConnect(connection, workflowFixture, definitionsWithoutSendEmail)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      {
        ...workflowFixture,
        edges: []
      },
      connection,
      definitionsWithoutSendEmail
    )

    expect(nextWorkflow.edges).toHaveLength(1)
    expect(nextWorkflow.edges[0].source_port_id).toBe('text')
    expect(nextWorkflow.edges[0].target_port_id).toBe('body')
  })

  it('allows table input to connect into table output and updates the sink shape', () => {
    const workflow = buildTableInputToTableOutputWorkflow()
    const connection = {
      source: 'table_input_runs',
      sourceHandle: 'table',
      target: 'table_output_copy',
      targetHandle: 'text'
    }

    expect(
      canConnect(connection, workflow, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      {
        ...workflow,
        edges: []
      },
      connection,
      nodeDefinitionFixture.node_definitions
    )

    expect(nextWorkflow.edges).toHaveLength(1)
    expect(nextWorkflow.edges[0].source_port_id).toBe('table')
    expect(nextWorkflow.edges[0].target_port_id).toBe('text')
    expect(
      nextWorkflow.nodes.find((node) => node.node_id === 'table_output_copy')?.config.input_shape
    ).toBe('source_table')
  })

  it('allows table schema to connect into table output and updates the sink shape', () => {
    const workflow = buildTableSchemaToTableOutputWorkflow()
    const connection = {
      source: 'table_schema_orders',
      sourceHandle: 'table',
      target: 'table_output_copy',
      targetHandle: 'text'
    }

    expect(
      canConnect(connection, workflow, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      {
        ...workflow,
        edges: []
      },
      connection,
      nodeDefinitionFixture.node_definitions
    )

    expect(nextWorkflow.edges).toHaveLength(1)
    expect(nextWorkflow.edges[0].source_port_id).toBe('table')
    expect(nextWorkflow.edges[0].target_port_id).toBe('text')
    expect(
      nextWorkflow.nodes.find((node) => node.node_id === 'table_output_copy')?.config.input_shape
    ).toBe('table_schema')
  })
});
