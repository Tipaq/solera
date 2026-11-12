import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConversationDto } from '@solera/protocol'

const {
  MIN_SESSIONS,
  activityFold,
  cutToBudget,
  fitStep,
  mustShow,
  parseSessionLimit,
} = await import('../../web/src/lib/sidebar-budget.js')

function session(id: string, status: ConversationDto['status'] = 'idle'): ConversationDto {
  return { id, status } as ConversationDto
}

const ids = (entries: ConversationDto[]) => entries.map((entry) => entry.id)

test('le réglage lu dans le stockage : ajuster par défaut, une valeur abîmée aussi', () => {
  assert.equal(parseSessionLimit(null), 'fit')
  assert.equal(parseSessionLimit('fit'), 'fit')
  assert.equal(parseSessionLimit('10'), 10)
  assert.equal(parseSessionLimit('20'), 20)
  assert.equal(parseSessionLimit('50'), 50)
  assert.equal(parseSessionLimit('30'), 'fit')
  assert.equal(parseSessionLimit('abc'), 'fit')
})

test('mustShow : la session ouverte et celles qui attendent ne se cachent jamais', () => {
  assert.equal(mustShow(session('a'), 'a'), true)
  assert.equal(mustShow(session('a', 'awaiting_input'), null), true)
  assert.equal(mustShow(session('a', 'error'), undefined), true)
  assert.equal(mustShow(session('a', 'running'), 'b'), false)
  assert.equal(mustShow(session('a'), null), false)
})

test('cutToBudget : sans session à garder, les premières dans l’ordre', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => session(id))
  assert.deepEqual(ids(cutToBudget(list, 2, null)), ['a', 'b'])
  assert.deepEqual(ids(cutToBudget(list, 10, null)), ['a', 'b', 'c', 'd'])
  assert.deepEqual(ids(cutToBudget(list, 0, null)), [])
})

test('cutToBudget : les sessions à garder comptent dans le budget, l’ordre est conservé', () => {
  const list = [session('a'), session('b'), session('c'), session('d', 'awaiting_input'), session('e')]
  // « d » attend et « e » est ouverte : elles prennent deux places, « a » la troisième.
  assert.deepEqual(ids(cutToBudget(list, 3, 'e')), ['a', 'd', 'e'])
})

test('cutToBudget : un budget plus petit que les sessions à garder les garde toutes', () => {
  const list = [session('a'), session('b', 'error'), session('c', 'awaiting_input')]
  assert.deepEqual(ids(cutToBudget(list, 1, 'a')), ['a', 'b', 'c'])
})

test('fitStep : un débord retire autant de lignes qu’il en couvre', () => {
  assert.equal(fitStep({ budget: 10, overflow: 1, rowHeight: 36, lists: 1, cutLists: 1 }), 9)
  assert.equal(fitStep({ budget: 10, overflow: 80, rowHeight: 36, lists: 2, cutLists: 0 }), 7)
  assert.equal(fitStep({ budget: 2, overflow: 400, rowHeight: 36, lists: 1, cutLists: 1 }), 0)
})

test('fitStep : de la place n’en rajoute que si une liste est coupée, partagée entre elles', () => {
  assert.equal(fitStep({ budget: 5, overflow: -110, rowHeight: 36, lists: 1, cutLists: 1 }), 8)
  assert.equal(fitStep({ budget: 5, overflow: -150, rowHeight: 36, lists: 3, cutLists: 2 }), 7)
  assert.equal(fitStep({ budget: 5, overflow: -150, rowHeight: 36, lists: 2, cutLists: 0 }), 5)
  // Moins d'une ligne de place : rien ne bouge.
  assert.equal(fitStep({ budget: 5, overflow: -20, rowHeight: 36, lists: 1, cutLists: 1 }), 5)
})

test('fitStep : sans liste de sessions, le débord ne regarde pas le budget', () => {
  assert.equal(fitStep({ budget: 10, overflow: 300, rowHeight: 36, lists: 0, cutLists: 0 }), 10)
})

/** Une colonne simulée : `rows` lignes de session tiennent, `want` en demanderaient. */
function settle(room: number, want: number, rowHeight = 36) {
  let budget = 10
  const seen: number[] = []
  for (let pass = 0; pass < 20; pass += 1) {
    const shown = Math.min(budget, want)
    const overflow = (shown - room) * rowHeight
    const next = fitStep({ budget, overflow, rowHeight, lists: 1, cutLists: shown < want ? 1 : 0 })
    seen.push(next)
    if (next === budget) return { budget, passes: pass + 1, seen }
    budget = next
  }
  return { budget, passes: Infinity, seen }
}

test('fitStep : la mesure converge en quelques passes, sans osciller', () => {
  assert.deepEqual(settle(14, 40).budget, 14)
  assert.deepEqual(settle(4, 40).budget, 4)
  assert.ok(settle(14, 40).passes <= 3)
  // Tout tient : le budget reste là où il est, la liste n'est pas coupée.
  assert.equal(settle(30, 6).budget, 10)
})

test('activityFold : dépliée, elle se replie quand moins de 5 sessions tiennent', () => {
  assert.equal(MIN_SESSIONS, 5)
  const base = { rowHeight: 36, overflow: 0, gain: 0 }
  assert.equal(activityFold({ ...base, collapsed: false, budget: 4, cutLists: 1 }), true)
  assert.equal(activityFold({ ...base, collapsed: false, budget: 5, cutLists: 1 }), false)
  // Rien de coupé : les sessions tiennent toutes, la place ne manque pas.
  assert.equal(activityFold({ ...base, collapsed: false, budget: 2, cutLists: 0 }), false)
})

test('activityFold : repliée, elle se redéplie seulement si 5 sessions tiendraient encore', () => {
  // Repliée, elle a rendu 144 px, soit 4 lignes.
  const base = { rowHeight: 36, overflow: 0, gain: 144, collapsed: true, cutLists: 1 }
  assert.equal(activityFold({ ...base, budget: 8 }), true)
  assert.equal(activityFold({ ...base, budget: 9 }), false)
  // Rien de coupé : il suffit que la place libre couvre l'Activité dépliée.
  assert.equal(activityFold({ ...base, budget: 3, cutLists: 0, overflow: -100 }), true)
  assert.equal(activityFold({ ...base, budget: 3, cutLists: 0, overflow: -150 }), false)
})

test('activityFold : pas de clignotement sur une suite de mesures', () => {
  // Une colonne où 7 sessions tiennent l'Activité repliée, 3 dépliée (elle prend 4 lignes).
  const rowHeight = 36
  const gain = 4 * rowHeight
  let collapsed = false
  const states: boolean[] = []
  for (let pass = 0; pass < 6; pass += 1) {
    const budget = collapsed ? 7 : 3
    collapsed = activityFold({ collapsed, budget, cutLists: 1, overflow: 0, rowHeight, gain: collapsed ? gain : 0 })
    states.push(collapsed)
  }
  assert.deepEqual(states, [true, true, true, true, true, true])
})
