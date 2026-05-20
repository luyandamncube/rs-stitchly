import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import { createCanvasElements } from './workflow';

describe('createCanvasElements', () => {
  it('consumes the shared fixture workflow and preserves its graph shape', () => {
    const graph = createCanvasElements(
      workflowFixture,
      nodeDefinitionFixture.node_definitions,
      workflowFixture.nodes[0].node_id,
      workflowFixture.nodes[1].node_id
    );

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes[0].data.label).toBe('Source Text');
    expect(graph.edges[0].sourceHandle).toBe('text');
    expect(graph.nodes[1].data.uiState.interaction.hovered).toBe(true);
  });
});
