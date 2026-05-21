import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import { createCanvasElements } from './workflow';

describe('createCanvasElements', () => {
  it('consumes the shared fixture workflow and preserves its graph shape', () => {
    const graph = createCanvasElements(
      workflowFixture,
      nodeDefinitionFixture.node_definitions,
      workflowFixture.nodes[0].node_id,
      workflowFixture.nodes[0].node_id
    );

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0].type).toBe('send_email');
    expect(graph.nodes[0].data.label).toBe('Send Email');
    expect(graph.nodes[0].data.uiState.interaction.hovered).toBe(true);
  });
});
