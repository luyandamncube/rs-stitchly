import connectionFixture from '../../../../tests/fixtures/api/connections.json';
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import {
  buildProblemItems,
  buildSearchResults,
  groupNodeDefinitions,
  humanizeToken
} from './shell';

describe('shell helpers', () => {
  it('groups node definitions by category in a stable order', () => {
    const groups = groupNodeDefinitions(nodeDefinitionFixture.node_definitions);

    expect(groups.map((group) => group.category)).toEqual(['input', 'compute', 'output']);
    expect(groups[0].items[0].type_id).toBe('table_input');
  });

  it('derives problem metadata from validation payloads', () => {
    const problems = buildProblemItems({
      valid: false,
      errors: [
        {
          code: 'missing_required_input',
          message: 'Node `preview_text` is missing required input `text`.',
          path: 'workflow.nodes.preview_text.text'
        }
      ],
      warnings: []
    });

    expect(problems[0].severity).toBe('error');
    expect(problems[0].target.nodeId).toBe('preview_text');
  });

  it('searches across workflow, run, and connection entities', () => {
    const results = buildSearchResults({
      query: 'clickhouse',
      workflow: workflowFixture,
      nodeDefinitions: nodeDefinitionFixture.node_definitions,
      connections: connectionFixture.connections,
      runHistory: [
        {
          run_id: 'run_demo',
          workflow_id: 'ScJUvQ7dgxHqu7tXtsekiL',
          status: 'running'
        }
      ],
      validation: null
    });

    expect(results.some((result) => result.kind === 'connection')).toBe(true);
  });

  it('humanizes status tokens for drawer and card labels', () => {
    expect(humanizeToken('stream-error')).toBe('Stream Error');
    expect(humanizeToken('preview_output')).toBe('Preview Output');
  });
});
