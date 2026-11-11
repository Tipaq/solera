import assert from 'node:assert/strict'
import { test } from 'node:test'

const { createEscapeStack } = await import('../../web/src/lib/escape-layers.js')

const escape = { key: 'Escape', defaultPrevented: false, isComposing: false }

function recorder() {
  const closed: string[] = []
  return { closed, close: (name: string) => () => closed.push(name) }
}

test('Échap ferme la dernière couche ouverte, et elle seule', () => {
  const stack = createEscapeStack()
  const { closed, close } = recorder()
  stack.push(close('tiroir'))
  stack.push(close('autocomplétion'))
  assert.equal(stack.handle(escape, false), true)
  assert.deepEqual(closed, ['autocomplétion'], 'Une seule couche par appui')
})

test('une couche retirée laisse la main à celle du dessous', () => {
  const stack = createEscapeStack()
  const { closed, close } = recorder()
  const removeDrawer = stack.push(close('tiroir'))
  const removeField = stack.push(close('champ'))
  removeField()
  stack.handle(escape, false)
  assert.deepEqual(closed, ['tiroir'])
  removeDrawer()
  assert.equal(stack.handle(escape, false), false, 'Pile vide : Échap reste à la page')
})

test('une couche retirée au milieu ne dérange pas les autres', () => {
  const stack = createEscapeStack()
  const closed: string[] = []
  // Comme en vrai : fermer une couche la démonte, et le démontage la retire.
  const layer = (name: string) => {
    const remove = stack.push(() => {
      closed.push(name)
      remove()
    })
    return remove
  }
  layer('tiroir')
  const removeMiddle = layer('confirmation')
  layer('menu en ligne')
  removeMiddle()
  removeMiddle()
  stack.handle(escape, false)
  stack.handle(escape, false)
  assert.equal(stack.handle(escape, false), false)
  assert.deepEqual(closed, ['menu en ligne', 'tiroir'])
})

test("un menu Radix ouvert garde son Échap : la pile s'efface", () => {
  const stack = createEscapeStack()
  const { closed, close } = recorder()
  stack.push(close('tiroir'))
  assert.equal(stack.handle(escape, true), false)
  assert.deepEqual(closed, [])
})

test('une touche déjà traitée, en composition ou autre ne ferme rien', () => {
  const stack = createEscapeStack()
  const { closed, close } = recorder()
  stack.push(close('tiroir'))
  assert.equal(stack.handle({ ...escape, defaultPrevented: true }, false), false)
  assert.equal(stack.handle({ ...escape, isComposing: true }, false), false)
  assert.equal(stack.handle({ ...escape, key: 'Enter' }, false), false)
  assert.deepEqual(closed, [])
})


test("une couche bornée ne prend Échap que si l'appui vient de chez elle", () => {
  const stack = createEscapeStack()
  const { closed, close } = recorder()
  stack.push(close('tiroir'))
  // Un détail en pile dans le panneau : Échap tapé dans le champ de la conversation
  // revient à son autocomplétion, pas au détail — ni au tiroir dessous.
  stack.push(close('détail'), (target) => target === 'panneau')
  assert.equal(stack.handle({ ...escape, target: 'composer' }, false), false)
  assert.deepEqual(closed, [])
  assert.equal(stack.handle({ ...escape, target: 'panneau' }, false), true)
  assert.deepEqual(closed, ['détail'])
})
