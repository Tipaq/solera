import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardRefinementDto } from '@solera/protocol'

const { collectAnswer, refineHref, refinePanelState } = await import('../../web/src/lib/refinement.js')

/**
 * Le résumé d'affinage sur la page d'un jalon (#195, spec jalons AFF-1..6) : où mène son
 * geste, l'état qu'il affiche, et les réponses qu'il garde avant de les envoyer.
 */

const PROJECT = 'p1'

const session: CardRefinementDto = {
  conversationId: 'refine',
  title: 'Affiner : Mode hors ligne',
  status: 'idle',
  mode: 'questions',
  createdAt: 0,
  draft: null,
  change: null,
}

const idea = { id: 'card-320', number: 320, title: 'Mode hors ligne', description: 'Lire et écrire sans réseau.', refinement: null }

/* ------------------------------------------------------------------ le geste */

test('sans session, « Affiner » ouvre un brouillon de découpage pré-rempli', () => {
  const href = refineHref(PROJECT, idea, 'questions')
  const url = new URL(href, 'http://solera')
  assert.equal(url.pathname, `/p/${PROJECT}/c/new`)
  assert.equal(url.searchParams.get('split'), 'card-320')
  // Le mode par défaut ne s'écrit pas : `questions` est celui du serveur.
  assert.equal(url.searchParams.get('mode'), null)
  assert.equal(url.searchParams.get('prompt'), '/affiner-un-jalon #320\n\nMode hors ligne\n\nLire et écrire sans réseau.')
})

test('« Découper directement » le demande au skill et au serveur', () => {
  const url = new URL(refineHref(PROJECT, { ...idea, description: '' }, 'direct'), 'http://solera')
  assert.equal(url.searchParams.get('mode'), 'direct')
  assert.equal(url.searchParams.get('prompt'), '/affiner-un-jalon #320 --decouper\n\nMode hors ligne')
})

test('une session d’affinage déjà là s’ouvre au lieu d’en créer une', () => {
  assert.equal(refineHref(PROJECT, { ...idea, refinement: session }, 'direct'), `/p/${PROJECT}/c/refine`)
})

/* ------------------------------------------------------------------ l'état */

test('l’état suit celui de la carte, sauf une question ouverte qui l’emporte', () => {
  assert.equal(refinePanelState(null, false, undefined, false), 'none')
  // Sans session, un jalon qui a déjà ses cartes est découpé : rien à lancer ici.
  assert.equal(refinePanelState(null, true, undefined, false), 'done')
  assert.equal(refinePanelState({ ...session, status: 'running' }, false, undefined, false), 'working')
  assert.equal(refinePanelState(session, true, undefined, false), 'done')
  // Au repos, sans cartes ni rien en attente : la suite se dit dans la session.
  assert.equal(refinePanelState(session, false, undefined, false), 'waiting')
  // La question asynchrone de Codex : la session tourne encore, mais elle t'attend.
  assert.equal(refinePanelState({ ...session, status: 'running' }, false, undefined, true), 'waiting')
  // Le statut vivant a le dernier mot.
  assert.equal(refinePanelState(session, true, 'running', false), 'working')
})

/* ------------------------------------------------------------------ les réponses */

const questions = [{ id: 'cible' }, { id: 'date' }]

test('une réponse se garde jusqu’à la dernière question, qui envoie tout', () => {
  const first = collectAnswer({}, questions, 'cible', '  La page  ')
  assert.deepEqual(first, { answers: { cible: ['La page'] }, complete: false })
  const second = collectAnswer(first.answers, questions, 'date', 'Vendredi')
  assert.deepEqual(second, { answers: { cible: ['La page'], date: ['Vendredi'] }, complete: true })
})

test('répondre de nouveau remplace la réponse gardée ; une réponse vide ne compte pas', () => {
  const kept = collectAnswer({}, questions, 'cible', 'La page').answers
  assert.deepEqual(collectAnswer(kept, questions, 'cible', 'Le panneau').answers, { cible: ['Le panneau'] })
  assert.deepEqual(collectAnswer(kept, questions, 'date', '   '), { answers: kept, complete: false })
})

test('une réponse à une question qui n’est plus ouverte est écartée', () => {
  // La demande a changé entre-temps : ce qu'on gardait pour l'ancienne ne part pas.
  const stale = { ancienne: ['Oui'] }
  assert.deepEqual(collectAnswer(stale, [{ id: 'cible' }], 'cible', 'La page'), { answers: { cible: ['La page'] }, complete: true })
})
