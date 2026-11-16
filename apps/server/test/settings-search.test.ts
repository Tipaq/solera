import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SearchableSetting } from '../../web/src/components/settings-page/search.js'

const { searchSettings, groupsOf, SEARCH_LIMIT } = await import('../../web/src/components/settings-page/search.js')

/** La page des réglages d'un projet, réduite à ce que la recherche lit. */
const ITEMS: SearchableSetting[] = [
  { id: 'name', category: 'general', group: 'Identité', label: 'Nom', help: 'Affiché dans la bande, la sidebar et le portefeuille.' },
  { id: 'path', category: 'general', group: 'Identité', label: 'Dossier du workspace', keywords: ['chemin'] },
  { id: 'color', category: 'general', group: 'Apparence', label: 'Couleur', keywords: ['teinte', 'pastille'] },
  { id: 'environment', category: 'general', group: 'Exécution', label: 'Environnement', keywords: ['confinement', 'dev container'] },
  { id: 'autonomous', category: 'general', group: 'Exécution', label: 'Sessions autonomes confinées' },
  { id: 'remove', category: 'danger', group: 'Irréversible', label: 'Retirer le projet' },
]

const LABELS: Record<string, string> = { general: 'Général', danger: 'Zone de danger' }
const search = (query: string) => searchSettings(ITEMS, query, (key) => LABELS[key] ?? key).map((item) => item.id)

test('recherche : ni casse ni accents', () => {
  assert.deepEqual(search('COULEUR'), ['color'])
  assert.deepEqual(search('execution'), ['environment', 'autonomous'])
  assert.deepEqual(search('reglage'), [])
  assert.deepEqual(search('irreversible'), ['remove'])
})

test('recherche : libellé, aide, groupe, catégorie et mots-clés', () => {
  assert.deepEqual(search('portefeuille'), ['name'])
  assert.deepEqual(search('chemin'), ['path'])
  assert.deepEqual(search('identite'), ['name', 'path'])
  assert.deepEqual(search('danger'), ['remove'])
  // Un début de mot suffit : « confin » trouve le mot-clé et le libellé, dans l'ordre de la page.
  assert.deepEqual(search('confin'), ['environment', 'autonomous'])
})

test('recherche : tous les mots, dans n’importe quel ordre', () => {
  assert.deepEqual(search('sessions confin'), ['autonomous'])
  assert.deepEqual(search('confin sessions'), ['autonomous'])
  assert.deepEqual(search('couleur nom'), [])
})

test('recherche : une saisie vide ne rend rien, et dix résultats au plus', () => {
  assert.deepEqual(search(''), [])
  assert.deepEqual(search('   '), [])
  const many = Array.from({ length: 14 }, (_, index) => ({ id: `r${index}`, category: 'general', group: 'G', label: `Réglage ${index}` }))
  assert.equal(SEARCH_LIMIT, 10)
  assert.equal(searchSettings(many, 'reglage', () => 'Général').length, 10)
})

test('groupes : ceux d’une catégorie, dans l’ordre d’apparition', () => {
  const groups = groupsOf(ITEMS, 'general')
  assert.deepEqual(groups.map((group) => group.name), ['Identité', 'Apparence', 'Exécution'])
  assert.deepEqual(groups[2]!.items.map((item) => item.id), ['environment', 'autonomous'])
  assert.deepEqual(groupsOf(ITEMS, 'agents'), [])
})
