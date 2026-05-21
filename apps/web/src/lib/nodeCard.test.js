import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json'
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json'
import { buildNodeCardModel, getNodeCardWidth } from './nodeCard'

describe('node card helpers', () => {
  it('builds a send email card from the shared fixture metadata', () => {
    const node = workflowFixture.nodes.find((item) => item.type_id === 'send_email')
    const definition = nodeDefinitionFixture.node_definitions.find(
      (item) => item.type_id === 'send_email'
    )

    const card = buildNodeCardModel({
      workflow: workflowFixture,
      node,
      definition,
      nodeDefinitions: nodeDefinitionFixture.node_definitions
    })

    expect(card.topChip).toBe('Notify')
    expect(card.rows[0].value).toBe('ops@stitchly.dev')
    expect(card.rows[1].value).toBe('Failed refunds need review from the latest sync')
    expect(card.footer.value).toBe('Idle')
    expect(card.handles.inputs).toHaveLength(1)
    expect(card.handles.outputs).toHaveLength(0)
  })

  it('resolves simple upstream text previews for downstream cards', () => {
    const workflow = {
      workflow_id: 'wf_preview_test',
      nodes: [
        {
          node_id: 'input_text',
          type_id: 'text_input',
          label: 'Source Text',
          config: { text: 'ship the slice' }
        },
        {
          node_id: 'transform_text',
          type_id: 'text_transform',
          label: 'Uppercase',
          config: { operation: 'uppercase' }
        },
        {
          node_id: 'preview_text',
          type_id: 'preview_output',
          label: 'Preview',
          config: { title: 'Result' }
        }
      ],
      edges: [
        {
          edge_id: 'edge_input_transform',
          source_node_id: 'input_text',
          source_port_id: 'text',
          target_node_id: 'transform_text',
          target_port_id: 'source'
        },
        {
          edge_id: 'edge_transform_preview',
          source_node_id: 'transform_text',
          source_port_id: 'text',
          target_node_id: 'preview_text',
          target_port_id: 'text'
        }
      ]
    }
    const node = workflow.nodes.find((item) => item.type_id === 'preview_output')
    const definition = nodeDefinitionFixture.node_definitions.find(
      (item) => item.type_id === 'preview_output'
    )

    const card = buildNodeCardModel({
      workflow,
      node,
      definition,
      nodeDefinitions: nodeDefinitionFixture.node_definitions
    })

    expect(card.rows[1].value).toBe('SHIP THE SLICE')
    expect(getNodeCardWidth(definition)).toBe(332)
  })
})
