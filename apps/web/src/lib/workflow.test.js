import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import {
  canConnect,
  connectWorkflowNodes,
  createCanvasElements,
  removeWorkflowEdge,
  reconnectWorkflowEdge,
  syncWorkflowEdges
} from './workflow';

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
});
