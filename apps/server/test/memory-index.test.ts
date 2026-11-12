import assert from 'node:assert/strict'
import { test } from 'node:test'

const {
  parseNote,
  indexEntries,
  memoryState,
  repairIndex,
  withIndexLine,
  isNoteFileName,
  filterNotes,
  typeCounts,
  resolveLink,
} = await import('../../web/src/lib/memory-index.js')

const NOTE = `---
name: port-du-dev
description: "Le serveur de dev écoute sur 7417"
metadata:
  type: project
---

Le dev tourne sur 7417, voir [[scripts-dev]] et [[inconnue]], puis [[scripts-dev]].
`

test('parseNote : en-tête, type imbriqué sous metadata, corps et liens', () => {
  const note = parseNote('port.md', NOTE, 10)
  assert.equal(note.slug, 'port')
  assert.equal(note.name, 'port-du-dev')
  assert.equal(note.description, 'Le serveur de dev écoute sur 7417')
  assert.equal(note.type, 'project')
  assert.match(note.body, /^\nLe dev tourne/)
  assert.deepEqual(note.links, ['scripts-dev', 'inconnue'])
  assert.equal(note.updatedAt, 10)
})

test('parseNote : type au premier niveau, type inconnu, pas d’en-tête', () => {
  assert.equal(parseNote('a.md', '---\ntype: feedback\n---\nx', 0).type, 'feedback')
  assert.equal(parseNote('a.md', '---\ntype: humeur\n---\nx', 0).type, 'none')
  const bare = parseNote('libre.md', 'Juste du texte.', 0)
  assert.equal(bare.name, 'libre')
  assert.equal(bare.description, null)
  assert.equal(bare.type, 'none')
  assert.equal(bare.body, 'Juste du texte.')
})

test('parseNote : fins de ligne Windows', () => {
  const note = parseNote('w.md', '---\r\nname: w\r\ndescription: d\r\ntype: user\r\n---\r\ncorps', 0)
  assert.equal(note.description, 'd')
  assert.equal(note.type, 'user')
  assert.equal(note.body, 'corps')
})

test('indexEntries : les lignes qui pointent vers une note, chemin relatif normalisé', () => {
  const index = '# Mémoire\n\n- [Port](port.md) — 7417\n- [Vieux](./vieux.md)\ntexte libre\n'
  assert.deepEqual(indexEntries(index), [
    { file: 'port.md', line: '- [Port](port.md) — 7417' },
    { file: 'vieux.md', line: '- [Vieux](./vieux.md)' },
  ])
})

const files = [
  { file: 'MEMORY.md', content: '- [Port](port.md) — 7417\n- [Disparue](disparue.md) — x\n', updatedAt: 1 },
  { file: 'port.md', content: NOTE, updatedAt: 5 },
  { file: 'hors.md', content: '---\nname: hors\ndescription: pas indexée\ntype: user\n---\nCorps.', updatedAt: 9 },
]

test('memoryState : notes récentes d’abord, indexées, absentes de l’index, orphelines', () => {
  const state = memoryState(files)
  assert.deepEqual(state.notes.map((note) => note.file), ['hors.md', 'port.md'])
  assert.deepEqual([...state.indexed], ['port.md'])
  assert.deepEqual(state.unindexed.map((note) => note.file), ['hors.md'])
  assert.deepEqual(state.orphans.map((entry) => entry.file), ['disparue.md'])
})

test('memoryState : sans index, toutes les notes sont hors index', () => {
  const state = memoryState(files.slice(1))
  assert.equal(state.index, '')
  assert.equal(state.unindexed.length, 2)
  assert.equal(state.orphans.length, 0)
})

test('repairIndex : retire les orphelines, ajoute les absentes, garde le reste', () => {
  const state = memoryState([{ ...files[0]!, content: `# Mémoire\n\n${files[0]!.content}` }, ...files.slice(1)])
  assert.equal(repairIndex(state), '# Mémoire\n\n- [Port](port.md) — 7417\n- [hors](hors.md) — pas indexée\n')
  const fixed = memoryState([{ file: 'MEMORY.md', content: repairIndex(state), updatedAt: 1 }, ...files.slice(1)])
  assert.equal(fixed.unindexed.length + fixed.orphans.length, 0)
})

test('repairIndex : un index vide, une note sans description', () => {
  const state = memoryState([{ file: 'nue.md', content: 'x', updatedAt: 0 }])
  assert.equal(repairIndex(state), '- [nue](nue.md)\n')
})

test('withIndexLine : la ligne de la note, à la suite de l’index', () => {
  const note = parseNote('port.md', NOTE, 0)
  assert.equal(withIndexLine('', note), '- [port-du-dev](port.md) — Le serveur de dev écoute sur 7417\n')
  assert.equal(withIndexLine('# M\n\n', note), '# M\n- [port-du-dev](port.md) — Le serveur de dev écoute sur 7417\n')
})

test('isNoteFileName : un .md à plat, pas l’index', () => {
  assert.ok(isNoteFileName('note-1.md'))
  assert.ok(!isNoteFileName('MEMORY.md'))
  assert.ok(!isNoteFileName('dossier/note.md'))
  assert.ok(!isNoteFileName('note.txt'))
  assert.ok(!isNoteFileName('.cachee.md'))
})

test('filterNotes et typeCounts : type, recherche sans casse ni accents dans nom, description et corps', () => {
  const { notes } = memoryState(files)
  assert.deepEqual(typeCounts(notes), { all: 2, user: 1, feedback: 0, project: 1, reference: 0, none: 0 })
  assert.deepEqual(filterNotes(notes, 'project', '').map((note) => note.file), ['port.md'])
  assert.deepEqual(filterNotes(notes, 'all', 'ECOUTE').map((note) => note.file), ['port.md'])
  assert.deepEqual(filterNotes(notes, 'all', 'corps').map((note) => note.file), ['hors.md'])
  assert.deepEqual(filterNotes(notes, 'user', '7417'), [])
})

test('resolveLink : par nom de fichier ou par nom de note', () => {
  const { notes } = memoryState(files)
  assert.equal(resolveLink('port', notes)?.file, 'port.md')
  assert.equal(resolveLink('port-du-dev', notes)?.file, 'port.md')
  assert.equal(resolveLink('inconnue', notes), null)
})
