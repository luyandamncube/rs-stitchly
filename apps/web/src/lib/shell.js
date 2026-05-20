export const SHELL_SECTIONS = [
  {
    id: 'canvas',
    label: 'Canvas',
    icon: 'C',
    description: 'Workflow overview and viewport actions.',
    searchable: false
  },
  {
    id: 'nodes',
    label: 'Nodes',
    icon: 'N',
    description: 'Browse the node library and inspect the active node.',
    searchable: true,
    searchPlaceholder: 'Search nodes'
  },
  {
    id: 'runs',
    label: 'Runs',
    icon: 'R',
    description: 'Validate workflows, start runs, and inspect run state.',
    searchable: false
  },
  {
    id: 'problems',
    label: 'Problems',
    icon: '!',
    description: 'Review validation issues and jump to affected graph elements.',
    searchable: false
  },
  {
    id: 'search',
    label: 'Search',
    icon: '?',
    description: 'Jump across nodes, runs, issues, and settings.',
    searchable: true,
    searchPlaceholder: 'Search everything'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '=',
    description: 'Environment, shortcuts, and shell preferences.',
    searchable: false
  }
];

const CATEGORY_ORDER = ['input', 'compute', 'output', 'control', 'trigger', 'system'];

export function humanizeToken(value) {
  if (!value) {
    return 'Unknown';
  }

  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildProblemItems(validation) {
  if (!validation) {
    return [];
  }

  const errors = (validation.errors ?? []).map((issue, index) => ({
    ...issue,
    id: `error-${index}-${issue.code}`,
    severity: 'error',
    target: deriveProblemTarget(issue.path)
  }));
  const warnings = (validation.warnings ?? []).map((issue, index) => ({
    ...issue,
    id: `warning-${index}-${issue.code}`,
    severity: 'warning',
    target: deriveProblemTarget(issue.path)
  }));

  return [...errors, ...warnings];
}

export function groupNodeDefinitions(nodeDefinitions, query = '') {
  const normalized = query.trim().toLowerCase();
  const filtered = nodeDefinitions.filter((definition) => {
    if (!normalized) {
      return true;
    }

    return [
      definition.display_name,
      definition.type_id,
      definition.category,
      definition.description
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized));
  });

  const grouped = filtered.reduce((groups, definition) => {
    const bucket = groups.get(definition.category) ?? [];
    bucket.push(definition);
    groups.set(definition.category, bucket);
    return groups;
  }, new Map());

  const orderedCategories = [
    ...CATEGORY_ORDER.filter((category) => grouped.has(category)),
    ...Array.from(grouped.keys())
      .filter((category) => !CATEGORY_ORDER.includes(category))
      .sort()
  ];

  return orderedCategories.map((category) => ({
    category,
    label: humanizeToken(category),
    items: grouped
      .get(category)
      .slice()
      .sort((left, right) => left.display_name.localeCompare(right.display_name))
  }));
}

export function buildSearchResults({
  query,
  workflow,
  nodeDefinitions,
  connections,
  runHistory,
  validation
}) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const results = [];

  if (
    [workflow.name, workflow.workflow_id, workflow.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized))
  ) {
    results.push({
      id: `workflow-${workflow.workflow_id}`,
      kind: 'workflow',
      title: workflow.name,
      subtitle: workflow.workflow_id
    });
  }

  workflow.nodes.forEach((node) => {
    if (
      [node.label, node.node_id, node.type_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    ) {
      results.push({
        id: `workflow-node-${node.node_id}`,
        kind: 'workflow-node',
        title: node.label ?? node.node_id,
        subtitle: node.type_id,
        nodeId: node.node_id
      });
    }
  });

  nodeDefinitions.forEach((definition) => {
    if (
      [definition.display_name, definition.type_id, definition.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    ) {
      results.push({
        id: `node-definition-${definition.type_id}`,
        kind: 'node-definition',
        title: definition.display_name,
        subtitle: humanizeToken(definition.category),
        typeId: definition.type_id
      });
    }
  });

  buildProblemItems(validation).forEach((problem) => {
    if (
      [problem.code, problem.message, problem.path]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    ) {
      results.push({
        id: `problem-${problem.id}`,
        kind: 'problem',
        title: problem.code,
        subtitle: problem.message,
        problemId: problem.id
      });
    }
  });

  runHistory.forEach((run) => {
    if (
      [run.run_id, run.status, run.workflow_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    ) {
      results.push({
        id: `run-${run.run_id}`,
        kind: 'run',
        title: run.run_id,
        subtitle: humanizeToken(run.status),
        runId: run.run_id
      });
    }
  });

  connections.forEach((connection) => {
    if (
      [connection.display_name, connection.connection_id, connection.connection_kind]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    ) {
      results.push({
        id: `connection-${connection.connection_id}`,
        kind: 'connection',
        title: connection.display_name,
        subtitle: humanizeToken(connection.connection_kind),
        connectionId: connection.connection_id
      });
    }
  });

  return results.slice(0, 12);
}

function deriveProblemTarget(path) {
  if (!path) {
    return { kind: 'workflow', label: 'Workflow' };
  }

  const nodeMatch = path.match(/workflow\.nodes\.([^.]+)/);
  if (nodeMatch) {
    return {
      kind: 'node',
      nodeId: nodeMatch[1],
      label: nodeMatch[1]
    };
  }

  const edgeMatch = path.match(/workflow\.edges\.([^.]+)/);
  if (edgeMatch) {
    return {
      kind: 'edge',
      edgeId: edgeMatch[1],
      label: edgeMatch[1]
    };
  }

  return {
    kind: 'workflow',
    label: path
  };
}
