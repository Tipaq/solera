import assert from 'node:assert/strict'
import { test } from 'node:test'

// Un fuseau qui change d'heure : le 25 octobre 2026, Paris repasse à l'heure d'hiver et
// ce jour-là dure 25 h. Node relit `TZ` à chaque calcul de date.
process.env.TZ = 'Europe/Paris'

const { anchorsOf, arrowPoints, barOf, chainOf, daysOf, isoWeek, labelPlacement, monthsOf, scaleOf, weekLabelStep } =
  await import('../../web/src/components/gantt/scale.js')

const DAY = 86_400_000
/** Minuit local, mois compté à partir de 1. */
const at = (year: number, month: number, day: number, hour = 0) => new Date(year, month - 1, day, hour).getTime()

const card = (id: string, createdAt: number, dueAt: number | null, blockedBy: string[] = []) => ({
  id,
  createdAt,
  dueAt,
  blockedBy: blockedBy.map((other) => ({ id: other })),
})

test('gantt : la fenêtre part du lundi avant la plus ancienne création et finit une semaine après le lundi de l’échéance', () => {
  // Mercredi 4 nov. 2026, une carte créée le mardi 27 oct., échéance le jeudi 19 nov.
  const now = at(2026, 11, 4, 15)
  const scale = scaleOf([card('a', at(2026, 10, 27, 9), at(2026, 11, 19))], 'week', now)
  assert.equal(scale.from, at(2026, 10, 26))
  // 19 nov. + 2 j = samedi 21 → lundi 16, + une semaine.
  assert.equal(scale.to, at(2026, 11, 23))
  assert.equal(new Date(scale.from).getDay(), 1)
  assert.equal(new Date(scale.to).getDay(), 1)
})

test('gantt : un jour de marge à gauche, et une création un lundi ouvre la semaine d’avant', () => {
  const now = at(2026, 11, 4)
  const scale = scaleOf([card('a', at(2026, 11, 2, 10), null)], 'week', now)
  assert.equal(scale.from, at(2026, 10, 26))
})

test('gantt : aujourd’hui reste dans la fenêtre, même sans carte ni échéance', () => {
  const now = at(2026, 11, 11, 12)
  const scale = scaleOf([], 'week', now)
  assert.ok(scale.from <= now && now < scale.to)
  assert.equal(scale.from, at(2026, 11, 9))
  // 11 nov. + 2 j = vendredi 13 → lundi 9, + une semaine.
  assert.equal(scale.to, at(2026, 11, 16))
})

test('gantt : le zoom mois laisse quatre jours de marge à l’échéance au lieu de deux', () => {
  const now = at(2026, 11, 4)
  // Échéance le samedi 21 : +2 j = lundi 23 en semaine, +4 j = mercredi 25 en mois.
  const due = at(2026, 11, 21)
  assert.equal(scaleOf([card('a', now, due)], 'week', now).to, at(2026, 11, 30))
  assert.equal(scaleOf([card('a', now, due)], 'month', now).to, at(2026, 11, 30))
  // Échéance le vendredi 20 : la marge de quatre jours franchit le lundi, pas celle de deux.
  const friday = at(2026, 11, 20)
  assert.equal(scaleOf([card('a', now, friday)], 'week', now).to, at(2026, 11, 23))
  assert.equal(scaleOf([card('a', now, friday)], 'month', now).to, at(2026, 11, 30))
})

test('gantt : en semaine, 30 px par jour, et la fenêtre défile quand elle dépasse la largeur', () => {
  const now = at(2026, 11, 4)
  const scale = scaleOf([card('a', at(2026, 9, 1), at(2026, 12, 20))], 'week', now, 600)
  assert.equal(scale.ppd, 30)
  assert.equal(scale.width, daysOf(scale).length * 30)
  assert.ok(scale.width > 600)
})

test('gantt : une fenêtre courte s’étire pour remplir la largeur mesurée', () => {
  const now = at(2026, 11, 4)
  const scale = scaleOf([card('a', now, at(2026, 11, 6))], 'week', now, 2000)
  const days = daysOf(scale).length
  assert.equal(scale.ppd, 2000 / days)
  assert.equal(scale.width, 2000)
})

test('gantt : le zoom mois tient dans la largeur, sans descendre sous 3 px par jour', () => {
  const now = at(2026, 11, 4)
  const short = scaleOf([card('a', at(2026, 10, 1), at(2026, 12, 20))], 'month', now, 900)
  assert.equal(short.width, 900)
  const long = scaleOf([card('a', at(2025, 1, 1), at(2027, 6, 1))], 'month', now, 900)
  assert.equal(long.ppd, 3)
  assert.ok(long.width > 900)
  // Pas encore mesuré : 8 px par jour.
  assert.equal(scaleOf([card('a', now, null)], 'month', now).ppd, 8)
})

test('gantt : le passage à l’heure d’hiver ne compte pas de jour en trop', () => {
  // Du lundi 19 oct. au lundi 2 nov. : quatorze jours de calendrier, dont un de 25 h.
  const now = at(2026, 10, 21)
  const scale = scaleOf([card('a', at(2026, 10, 20), at(2026, 10, 24))], 'week', now)
  assert.equal(scale.from, at(2026, 10, 19))
  assert.equal(scale.to, at(2026, 11, 2))
  const days = daysOf(scale)
  assert.equal(days.length, 14)
  assert.equal(scale.width, 14 * 30)
  for (const [index, day] of days.entries()) {
    assert.equal(new Date(day).getHours(), 0)
    // Chaque minuit tombe sur une frontière de colonne, avant comme après le changement.
    assert.equal(scale.x(day), index * 30)
  }
  assert.equal(scale.x(scale.to), scale.width)
})

test('gantt : les mois de l’axe, chacun de son premier jour visible au lendemain de son dernier', () => {
  const now = at(2026, 10, 28)
  const scale = scaleOf([card('a', at(2026, 10, 27), at(2026, 11, 3))], 'week', now)
  const months = monthsOf(daysOf(scale))
  assert.deepEqual(
    months.map(({ at: start, end }) => [new Date(start).getDate(), new Date(end).getMonth() + 1, new Date(end).getDate()]),
    [
      [26, 11, 1],
      [1, 11, 9],
    ],
  )
})

test('gantt : numéro de semaine ISO, aux bords de l’année', () => {
  assert.equal(isoWeek(at(2026, 1, 1)), 1)
  assert.equal(isoWeek(at(2026, 11, 9)), 46)
  assert.equal(isoWeek(at(2026, 12, 31)), 53)
  assert.equal(isoWeek(at(2027, 1, 1)), 53)
  assert.equal(isoWeek(at(2027, 1, 4)), 1)
})

test('gantt : une barre va de la création à l’échéance, et au moins un jour', () => {
  const due = at(2026, 11, 20)
  assert.deepEqual(barOf(card('a', at(2026, 11, 2), due), at(2026, 11, 4)), { start: at(2026, 11, 2), end: due, loose: false })
  // Créée la veille de l'échéance, ou après : la barre recule d'un jour.
  assert.deepEqual(barOf(card('a', due + 3 * 3_600_000, due), due), { start: due - DAY, end: due, loose: false })
})

test('gantt : sans échéance, la barre court jusqu’à aujourd’hui, en pointillé', () => {
  const created = at(2026, 11, 2)
  assert.deepEqual(barOf(card('a', created, null), at(2026, 11, 9)), { start: created, end: at(2026, 11, 9), loose: true })
  // Créée à l'instant : un jour au moins, pour rester visible.
  assert.deepEqual(barOf(card('a', created, null), created), { start: created, end: created + DAY, loose: true })
})

test('gantt : une flèche va de la fin de la bloquante au début de la bloquée', () => {
  const now = at(2026, 11, 4)
  const blocker = card('a', at(2026, 11, 2), at(2026, 11, 6))
  const blocked = card('b', at(2026, 11, 9), at(2026, 11, 13), ['a'])
  const outside = card('c', at(2026, 11, 2), null, ['hors-vue'])
  const scale = scaleOf([blocker, blocked, outside], 'week', now)
  const anchors = anchorsOf([blocker, blocked, outside], new Map([['a', 10], ['b', 42], ['c', 74]]), scale, now)
  assert.deepEqual(anchors, [{ x1: scale.x(at(2026, 11, 6)), y1: 10, x2: scale.x(at(2026, 11, 9)), y2: 42, from: 'a', to: 'b' }])
})

test('gantt : une carte sans ligne n’a pas de flèche', () => {
  const now = at(2026, 11, 4)
  const cards = [card('a', now, null), card('b', now, null, ['a'])]
  assert.deepEqual(anchorsOf(cards, new Map([['b', 10]]), scaleOf(cards, 'week', now), now), [])
})

test('gantt : la flèche coude droit quand la place suffit, et contourne par l’interligne sinon', () => {
  assert.deepEqual(arrowPoints({ x1: 100, y1: 10, x2: 160, y2: 42 }), [[100, 10], [108, 10], [108, 42], [159, 42]])
  // La bloquée commence avant la fin de sa bloquante : on ne traverse pas les barres.
  assert.deepEqual(arrowPoints({ x1: 100, y1: 10, x2: 60, y2: 42 }), [
    [100, 10], [108, 10], [108, 26], [50, 26], [50, 42], [59, 42],
  ])
})

test('gantt : la chaîne d’une carte remonte ses bloqueurs et descend ce qu’elle bloque', () => {
  const cards = [
    card('a', 0, null),
    card('b', 0, null, ['a']),
    card('c', 0, null, ['b']),
    card('d', 0, null, ['a']),
    card('e', 0, null, ['hors-vue']),
  ]
  assert.deepEqual([...(chainOf(cards, 'b') ?? [])].sort(), ['a', 'b', 'c'])
  assert.deepEqual([...(chainOf(cards, 'a') ?? [])].sort(), ['a', 'b', 'c', 'd'])
  assert.deepEqual([...(chainOf(cards, 'e') ?? [])], ['e'])
  assert.equal(chainOf(cards, null), null)
})

test('gantt : la chaîne s’arrête sur un cycle', () => {
  const cards = [card('a', 0, null, ['b']), card('b', 0, null, ['a'])]
  assert.deepEqual([...(chainOf(cards, 'a') ?? [])].sort(), ['a', 'b'])
})

test('gantt : le titre se loge dans la barre s’il y tient en entier, sinon à droite, sinon à gauche', () => {
  const base = { left: 100, width: 200, overdue: 0, labelWidth: 120, marker: 0, axisWidth: 1000 }
  assert.equal(labelPlacement(base), 'inside')
  // 120 + 2 × 8 de marge intérieure + le point d'une session vivante = 146.
  assert.equal(labelPlacement({ ...base, width: 145, marker: 10 }), 'right')
  assert.equal(labelPlacement({ ...base, width: 146, marker: 10 }), 'inside')
  // À droite, il sortirait de l'axe : il passe à gauche.
  assert.equal(labelPlacement({ ...base, left: 800, width: 60 }), 'right')
  assert.equal(labelPlacement({ ...base, left: 800, width: 60, overdue: 20 }), 'left')
})

test('gantt : en zoom mois, une étiquette de semaine sur n quand une semaine est trop étroite pour la sienne', () => {
  // « S45 23 » demande 44 px.
  assert.equal(weekLabelStep(8), 1, '56 px par semaine : toutes')
  assert.equal(weekLabelStep(44 / 7), 1)
  assert.equal(weekLabelStep(6), 2, '42 px : une sur deux')
  assert.equal(weekLabelStep(4), 2)
  assert.equal(weekLabelStep(3), 3, '21 px, le plancher du zoom mois : une sur trois')
})
