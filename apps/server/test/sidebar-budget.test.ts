import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConversationDto } from '@solera/protocol'

const {
  FIT_MEMORY,
  MIN_SESSIONS,
  activityFold,
  cutToBudget,
  fitNext,
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

/**
 * Une colonne simulée comme la rend le lieu *Fils* : chaque tranche de jour montrée
 * ajoute son en-tête (28 px) au-dessus de ses lignes (36 px). `buckets` dit la tranche
 * de chaque session, dans l'ordre ; `kept` sessions attendent une réponse et restent
 * affichées quel que soit le budget. L'Activité prend 144 px dépliée, 36 repliée.
 * Quand le budget a tout coupé, une liste vide reste là, marquée coupée.
 */
function threadsColumn({ height, buckets, kept = 0 }: { height: number; buckets: number[]; kept?: number }) {
  return (budget: number, collapsed: boolean) => {
    const shown = buckets.slice(0, Math.max(0, budget - kept))
    const headers = new Set(kept > 0 ? [0, ...shown] : shown).size
    const content = (collapsed ? 36 : 144) + headers * 28 + (kept + shown.length) * 36 + 40
    return {
      budget,
      collapsed,
      overflow: content - height,
      rowHeight: 36,
      // Tout coupé, une liste vide reste, marquée coupée.
      lists: Math.max(headers, 1),
      cutLists: shown.length < buckets.length ? 1 : 0,
      column: height,
      activity: collapsed ? 36 : 144,
    }
  }
}

/** Rejoue le hook : mesurer, décider, rendre, jusqu'à ce que rien ne change. */
function settleColumn(
  measure: ReturnType<typeof threadsColumn>,
  start = { budget: 10, collapsed: false, memory: FIT_MEMORY },
) {
  let { budget, collapsed, memory } = start
  for (let pass = 1; pass <= 50; pass += 1) {
    const next = fitNext(memory, measure(budget, collapsed))
    memory = next.memory
    if (next.budget === budget && next.collapsed === collapsed) return { budget, collapsed, memory, passes: pass }
    budget = next.budget
    collapsed = next.collapsed
  }
  return { budget, collapsed, memory, passes: Infinity }
}

// Cinq sessions aujourd'hui, puis hier : la sixième ouvre la tranche « Hier » et coûte
// 64 px au lieu de 36. À 432 px, cinq tiennent avec 40 px de reste, six débordent de 24.
const yesterdayOpens = { height: 432, buckets: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }

test('fitStep seul oscille quand un cran ouvre une tranche de jour (#262)', () => {
  const measure = threadsColumn(yesterdayOpens)
  let budget = 5
  const seen: number[] = []
  for (let pass = 0; pass < 6; pass += 1) {
    budget = fitStep(measure(budget, false))
    seen.push(budget)
  }
  assert.deepEqual(seen, [6, 5, 6, 5, 6, 5])
})

test('fitNext : un cran qui ouvre une tranche ne fait pas osciller le budget (#262)', () => {
  const settled = settleColumn(threadsColumn(yesterdayOpens))
  assert.equal(settled.budget, 5)
  assert.equal(settled.collapsed, false)
  assert.ok(settled.passes <= 4, `${settled.passes} passes`)
})

test('fitNext : la colonne redimensionnée relance la recherche, dans les deux sens', () => {
  const first = settleColumn(threadsColumn(yesterdayOpens))
  // Plus haute de 200 px : la recherche oublie que 6 débordait.
  const taller = settleColumn(threadsColumn({ ...yesterdayOpens, height: 632 }), first)
  assert.equal(taller.budget, 10)
  assert.ok(taller.passes < Infinity)
  // Puis plus basse : elle redescend.
  const shorter = settleColumn(threadsColumn({ ...yesterdayOpens, height: 400 }), taller)
  assert.ok(shorter.passes < Infinity)
  assert.ok(threadsColumn({ ...yesterdayOpens, height: 400 })(shorter.budget, shorter.collapsed).overflow <= 0)
})

test('fitNext : un budget stable qui ne mesure plus pareil relance la recherche', () => {
  const first = settleColumn(threadsColumn(yesterdayOpens))
  // Des sessions d'autres jours arrivent en tête : à 5, quatre tranches débordent.
  const measure = threadsColumn({ ...yesterdayOpens, buckets: [0, 1, 2, ...Array(12).fill(3)] })
  const settled = settleColumn(measure, first)
  assert.ok(settled.passes < Infinity)
  assert.ok(measure(settled.budget, settled.collapsed).overflow <= 0)
  assert.ok(measure(settled.budget + 1, settled.collapsed).overflow > 0)
})

test('fitNext : l’Activité redépliée qui doit se replier aussitôt reste repliée à cette hauteur', () => {
  // Huit sessions attendent : baisser le budget ne retire aucune ligne, et l'Activité
  // dépliée ne tient jamais. Repliée, le budget monte à 9, et 9 − 3 lignes d'Activité
  // laisseraient 6 sessions : sans mémoire, elle se redéplierait, puis se replierait.
  const measure = threadsColumn({ height: 480, buckets: Array(20).fill(1), kept: 8 })
  const settled = settleColumn(measure)
  assert.ok(settled.passes < Infinity, 'la colonne ne converge pas')
  assert.equal(settled.collapsed, true)
  assert.ok(measure(settled.budget, true).overflow <= 0)
  // Une autre hauteur la laisse réessayer.
  const taller = settleColumn(threadsColumn({ height: 700, buckets: Array(20).fill(1), kept: 8 }), settled)
  assert.equal(taller.collapsed, false)
})

test('fitNext : l’Activité coincée réessaie quand les sessions changent, à hauteur égale', () => {
  const stuck = settleColumn(threadsColumn({ height: 480, buckets: Array(20).fill(1), kept: 8 }))
  assert.equal(stuck.collapsed, true)
  assert.equal(stuck.memory.stuckAt, 480)
  // Les huit ont eu leur réponse : sessions ordinaires de la même tranche, elles se
  // coupent, et la colonne perd un en-tête au budget où elle s'était arrêtée.
  const answered = threadsColumn({ height: 480, buckets: Array(28).fill(1) })
  const settled = settleColumn(answered, stuck)
  assert.ok(settled.passes < Infinity)
  assert.equal(settled.collapsed, false)
  assert.equal(settled.budget, 7)
  assert.ok(answered(settled.budget, false).overflow <= 0)
})

test('fitNext : converge à toute hauteur, sur le plus grand budget qui tient', () => {
  const shapes = [
    yesterdayOpens.buckets,
    [0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    [0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    Array(30).fill(3),
  ]
  for (const buckets of shapes) {
    for (const kept of [0, 3]) {
      for (let height = 200; height <= 1100; height += 1) {
        const measure = threadsColumn({ height, buckets, kept })
        const settled = settleColumn(measure)
        const where = `hauteur ${height}, ${kept} gardées, tranches ${buckets.join('')}`
        assert.ok(settled.passes < Infinity, `boucle : ${where}`)
        const { overflow } = measure(settled.budget, settled.collapsed)
        assert.ok(overflow <= 0 || settled.budget === 0, `déborde de ${overflow} px : ${where}`)
        // Sans session gardée, chaque cran ajoute une ligne : un de plus déborderait.
        const more = measure(settled.budget + 1, settled.collapsed)
        if (kept === 0) assert.ok(more.overflow > 0 || settled.budget >= buckets.length, `en laisse : ${where}`)
      }
    }
  }
})
