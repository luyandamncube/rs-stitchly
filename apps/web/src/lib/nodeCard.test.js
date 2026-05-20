import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json'
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json'
import { buildNodeCardModel, getNodeCardWidth } from './nodeCard'

describe('node card helpers', () => {
  it('builds a trigger card from the shared fixture metadata', () => {
    const node = workflowFixture.nodes.find((item) => item.type_id === 'text_input')
    const definition = nodeDefinitionFixture.node_definitions.find(
      (item) => item.type_id === 'text_input'
    )

    const card = buildNodeCardModel({
      workflow: workflowFixture,
      node,
      definition,
      nodeDefinitions: nodeDefinitionFixture.node_definitions
    })

    expect(card.topChip).toBe('Start')
    expect(card.rows[0].value).toBe('ship the slice')
    expect(card.rows[1].value).toBe('14')
    expect(card.footer.value).toBe('Idle')
    expect(card.handles.outputs).toHaveLength(1)
  })

  it('resolves simple upstream text previews for downstream cards', () => {
    const node = workflowFixture.nodes.find((item) => item.type_id === 'preview_output')
    const definition = nodeDefinitionFixture.node_definitions.find(
      (item) => item.type_id === 'preview_output'
    )

    const card = buildNodeCardModel({
      workflow: workflowFixture,
      node,
      definition,
      nodeDefinitions: nodeDefinitionFixture.node_definitions
    })

    expect(card.rows[1].value).toBe('SHIP THE SLICE')
    expect(getNodeCardWidth(definition)).toBe(332)
  })
})
