import starterWorkflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json'

const WORKFLOW_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const WORKFLOW_ID_LENGTH = 22

export function buildBlankWorkflowDefinition(name = 'Blank Workflow') {
  return {
    ...structuredClone(starterWorkflowFixture),
    workflow_id: nextWorkflowId(),
    version: 1,
    name,
    description: 'A blank workflow ready for new nodes and connections.',
    nodes: [],
    edges: [],
    metadata: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  }
}

export function buildStarterWorkflowDefinition(name = 'Starter Workflow') {
  return {
    ...structuredClone(starterWorkflowFixture),
    workflow_id: nextWorkflowId(),
    version: 1,
    name,
    description: 'A starter workflow with text input feeding the send email node.'
  }
}

export function nextWorkflowId() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(WORKFLOW_ID_LENGTH)
    globalThis.crypto.getRandomValues(bytes)

    return Array.from(
      bytes,
      (value) => WORKFLOW_ID_ALPHABET[value % WORKFLOW_ID_ALPHABET.length]
    ).join('')
  }

  let fallbackId = ''
  while (fallbackId.length < WORKFLOW_ID_LENGTH) {
    const nextIndex = Math.floor(Math.random() * WORKFLOW_ID_ALPHABET.length)
    fallbackId += WORKFLOW_ID_ALPHABET[nextIndex]
  }

  return fallbackId
}
