import assert from 'node:assert/strict'
import { test } from 'node:test'

const { resolveView, viewStorageKey } = await import('../../web/src/lib/view-pref.js')

const KEYS = ['kanban', 'liste', 'geste'] as const

test("l'adresse l'emporte : un lien partage la vue", () => {
  assert.equal(resolveView('liste', 'geste', KEYS), 'liste')
})

test('sans adresse, la dernière vue retenue dans ce projet', () => {
  assert.equal(resolveView(null, 'geste', KEYS), 'geste')
})

test('ni adresse ni mémoire : la première vue', () => {
  assert.equal(resolveView(null, null, KEYS), 'kanban')
})

test('une valeur inconnue est ignorée, à chaque étage', () => {
  assert.equal(resolveView('gantt', 'geste', KEYS), 'geste')
  assert.equal(resolveView('gantt', 'calendrier', KEYS), 'kanban')
  assert.equal(resolveView('', null, KEYS), 'kanban')
})

test('la mémoire est rangée par page et par projet', () => {
  assert.equal(viewStorageKey('tableau', 'p1'), 'solera.view.tableau.p1')
  assert.notEqual(viewStorageKey('tableau', 'p1'), viewStorageKey('tableau', 'p2'))
  assert.notEqual(viewStorageKey('tableau', 'p1'), viewStorageKey('jalons', 'p1'))
  // Une page hors projet (portefeuille, /sessions) a sa propre mémoire.
  assert.equal(viewStorageKey('sessions', null), 'solera.view.sessions')
})
