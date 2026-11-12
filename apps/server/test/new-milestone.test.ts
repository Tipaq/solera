import assert from 'node:assert/strict'
import { test } from 'node:test'

// Le tiroir « Nouveau jalon » (carte #193, spec jalons CMP) : ce que les gestes permettent,
// ce que la création écrit, et où mène l'affinage.
const milestoneModule = await import('../../web/src/lib/new-milestone.js')
const { ENTRY_STAGE, gestureBlock, milestoneDescription, milestoneHref, primaryIntent } = milestoneModule
const { readBrief } = await import('../../web/src/lib/brief.js')

const PROJECT = 'p1'
const BRIEF = `# Mode hors-ligne complet

## Objectif
Pouvoir relire et répondre aux sessions sans réseau.
## Étapes
- Cache local des fils
- File d'envoi des réponses
`

test("l'étape d'arrivée : une idée notée attend, un affinage ou un découpage part à l'affinage (CMP-6, CMP-9)", () => {
  assert.deepEqual(ENTRY_STAGE, { note: 'idea', refine: 'refine', split: 'refine' })
})

test('le geste principal : découper si le brief suffit, sinon affiner (CMP-7)', () => {
  assert.equal(primaryIntent(readBrief(BRIEF)), 'split')
  assert.equal(primaryIntent(readBrief('Un mode hors-ligne')), 'refine')
  assert.equal(primaryIntent(readBrief('')), 'refine')
})

test('les désactivations disent pourquoi (CMP-8)', () => {
  const empty = readBrief('  \n')
  for (const intent of ['note', 'refine', 'split'] as const) assert.equal(gestureBlock(intent, empty), 'milestones.composer.why.empty')
  const phrase = readBrief('Un mode hors-ligne')
  assert.equal(gestureBlock('note', phrase), null)
  assert.equal(gestureBlock('refine', phrase), null)
  assert.equal(gestureBlock('split', phrase), 'milestones.composer.why.insufficient')
  assert.equal(gestureBlock('split', readBrief(BRIEF)), null)
})

test('la description : le texte sans son titre `#`, puis ses liens (CMP-15)', () => {
  assert.equal(
    milestoneDescription(BRIEF, ['https://github.com/o/r/pull/212', 'https://exemple.fr/doc'], 'Liens'),
    `## Objectif
Pouvoir relire et répondre aux sessions sans réseau.
## Étapes
- Cache local des fils
- File d'envoi des réponses

**Liens**
- https://github.com/o/r/pull/212
- https://exemple.fr/doc`,
  )
  // Une phrase reste entière ; un sous-titre `##` en tête n'est pas le titre du jalon.
  assert.equal(milestoneDescription('Un mode hors-ligne.\nAvec la file.', [], 'Liens'), 'Un mode hors-ligne.\nAvec la file.')
  assert.equal(milestoneDescription('\n## Objectif\nRelire.', [], 'Liens'), '## Objectif\nRelire.')
  assert.equal(milestoneDescription('# Seul titre', [], 'Liens'), '')
  assert.equal(milestoneDescription('# Seul titre', ['https://a.fr'], 'Links'), '**Links**\n- https://a.fr')
})

test("« Affiner » mène au brouillon de découpage du jalon, le brief et ses pièces en premier message (CMP-14)", () => {
  const card = { id: 'c42', number: 42, refinement: null }
  const url = new URL(
    milestoneHref(PROJECT, card, 'refine', { brief: BRIEF, cards: [{ number: 7, include: true }, { number: 9, include: false }], links: ['https://a.fr'] }),
    'http://solera',
  )
  assert.equal(url.pathname, `/p/${PROJECT}/c/new`)
  assert.equal(url.searchParams.get('split'), 'c42')
  assert.equal(url.searchParams.get('mode'), null)
  assert.equal(
    url.searchParams.get('prompt'),
    `/affiner-un-jalon #42\n\n${BRIEF.trim()}\n\nCartes jointes : #7 (à inclure dans le jalon), #9 (référence)\n\nLiens :\n- https://a.fr`,
  )
})

test('« Découper directement » demande le mode direct', () => {
  const url = new URL(milestoneHref(PROJECT, { id: 'c42', number: 42, refinement: null }, 'split', { brief: 'Brief' }), 'http://solera')
  assert.equal(url.searchParams.get('mode'), 'direct')
  assert.equal(url.searchParams.get('prompt'), '/affiner-un-jalon #42 --decouper\n\nBrief')
})

test("une session d'affinage qui existe déjà s'ouvre à la place du brouillon", () => {
  const card = { id: 'c42', number: 42, refinement: { conversationId: 'conv-1' } }
  assert.equal(milestoneHref(PROJECT, card, 'split', { brief: 'Brief' }), `/p/${PROJECT}/c/conv-1`)
})

test("la phrase de l'agent dans le pied, selon le geste et le brief (CMP-9, CMP-10)", () => {
  const { agentLine } = milestoneModule
  assert.equal(agentLine('refine', readBrief('')), 'brief.announce.empty')
  assert.equal(agentLine('note', readBrief('')), 'brief.announce.empty')
  assert.equal(agentLine('note', readBrief('Un mode hors-ligne')), 'milestones.composer.agent.note')
  assert.equal(agentLine('refine', readBrief('Un mode hors-ligne')), 'milestones.composer.agent.phrase')
  assert.equal(agentLine('split', readBrief(BRIEF)), 'milestones.composer.agent.brief')
  assert.equal(agentLine('refine', readBrief(`${BRIEF}\n- Garder les brouillons, à décider`)), 'milestones.composer.agent.briefOpen')
})
