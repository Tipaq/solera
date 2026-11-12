import assert from 'node:assert/strict'
import { join } from 'node:path'

/*
 * Les demandes des jalons dans « Ce qui t'attend » (#255, coque INB-8..10), sur le jeu
 * d'essai : la page lit de vraies cartes et de vraies sessions, auxquelles on ajoute ce
 * que le jeu n'a pas — une question d'affinage sur le jalon v1.2, un jalon dont le
 * brouillon attend, un jalon dont la PR finale est prête.
 *
 * Tout passe par des doublures de la page : la question, le brouillon, la PR et chaque
 * geste (répondre, valider, fusionner) s'arrêtent à `page.route`. Aucune session ne
 * reçoit de réponse, aucune carte ne naît, aucune PR n'est fusionnée.
 */

const NAME = 'Ce qui t’attend'
const DRAFT = {
  parent: null,
  cards: [
    { key: 'compte', title: 'Compte des actions', description: '', subtasks: [], after: [], blockedBy: [], related: [] },
    { key: 'onglet', title: 'Onglet Actions', description: '', subtasks: [], after: ['compte'], blockedBy: [], related: [] },
  ],
}

const link = (card) => ({ id: card.id, number: card.number, title: card.title, column: card.column })

/**
 * Pose les doublures. Rend l'état qu'elles servent, ce que les gestes y ont envoyé, et
 * de quoi les retirer.
 */
export async function installMilestoneAsks({ page, base, project }) {
  const realCards = await (await page.request.get(`${base}/api/projects/${project.id}/cards`)).json()
  const conversations = await (await page.request.get(`${base}/api/conversations`)).json()
  const { prompts: realPrompts } = await (await page.request.get(`${base}/api/projects/${project.id}/prompts`)).json()
  const milestone = realCards.find((card) => card.title.startsWith('v1.2'))
  assert.ok(milestone, 'Le jeu d’essai porte le jalon v1.2')
  // Deux sessions à soi, d'aucun jalon et qui n'attendent rien : seule la doublure les fait demander.
  const [refining, drafting] = conversations.filter(
    (entry) => entry.projectId === project.id && entry.isOwner && !entry.archivedAt && entry.milestone === null
      && !['awaiting_input', 'error', 'interrupted'].includes(entry.status)
      && !realPrompts.some((prompt) => prompt.conversationId === entry.id),
  )
  assert.ok(refining && drafting, 'Deux sessions du projet à prêter à l’affinage')

  const now = Date.now()
  const session = (conversation, extra = {}) => ({
    conversationId: conversation.id, title: conversation.title, status: 'idle', mode: 'questions', createdAt: now - 864e5,
    draft: null, change: null, ...extra,
  })
  const fake = (number, title, extra = {}) => ({
    ...milestone, id: `fake-255-${number}`, number, title, column: 'todo', dueAt: null, parent: null, milestone: true,
    children: [], branch: null, branchPr: null, refinement: null, conversations: [], blocks: [], blockedBy: [], ...extra,
  })
  const drafted = fake(9257, 'Actions et Planifiées', { refinement: session(drafting, { draft: { requestId: 'd-255', count: 2 } }) })
  const shipped = fake(9255, 'Socle commun', { branch: 'jalon/9255-socle-commun' })
  const child = fake(9256, 'Socle : migrations', { milestone: false, column: 'done', parent: link(shipped) })
  shipped.children = [link(child)]

  const state = {
    milestone: { ...milestone, refinement: session(refining) },
    drafted,
    shipped: { ...shipped, branchPr: { number: 4255, url: 'https://forge.test/pull/4255', base: 'main', mergedAt: null, closedAt: null } },
    child,
    question: {
      conversationId: refining.id, requestId: 'q-255', requestedAt: now - 5 * 60_000,
      event: {
        type: 'question.requested', requestId: 'q-255',
        questions: [
          { id: 'cible', header: 'Cible', question: 'Le phare montre-t-il le jalon courant ?', options: [], multiSelect: false, allowOther: true, secret: false },
          { id: 'heritage', header: 'Échéance', question: 'Une carte hérite-t-elle de l’échéance du jalon ?', options: [], multiSelect: false, allowOther: true, secret: false },
        ],
      },
    },
    mergeRefusal: 'la PR a des conflits avec main',
  }
  const sent = { answers: [], drafts: [], merges: [] }
  const pullRequest = (number, title, branch) => ({
    number, url: `https://forge.test/pull/${number}`, title, branch, base: 'main', state: 'ready',
    checks: { passed: 1, pending: 0, failed: [] }, review: null, updatedAt: now - 3_600_000,
  })

  const routes = {
    [`**/api/projects/${project.id}/cards`]: (route) =>
      route.fulfill({
        json: [
          ...realCards.map((card) => (card.id === milestone.id ? state.milestone : card)),
          state.drafted, state.shipped, state.child,
        ],
      }),
    [`**/api/projects/${project.id}/prompts`]: (route) =>
      route.fulfill({ json: { prompts: [...realPrompts, ...(state.question ? [state.question] : [])] } }),
    [`**/api/projects/${project.id}/pull-requests`]: (route) =>
      route.fulfill({
        json: {
          available: true, fetchedAt: now,
          // La PR du jalon, que sa ligne de fusion remplace, et une autre, qui reste.
          pullRequests: [pullRequest(4255, 'Jalon : Socle commun', state.shipped.branch), pullRequest(4256, 'Une PR sans jalon', 'feat/autre')],
        },
      }),
    [`**/api/cards/${drafted.id}/refinement`]: (route) =>
      route.fulfill({
        json: {
          session: state.drafted.refinement, activity: null, prompt: null, change: null,
          draft: state.drafted.refinement.draft ? { requestId: 'd-255', conversationId: drafting.id, draft: DRAFT } : null,
        },
      }),
    [`**/api/conversations/${refining.id}/questions/*`]: (route) => {
      sent.answers.push(route.request().postDataJSON())
      state.question = null
      return route.fulfill({ json: { ok: true } })
    },
    [`**/api/conversations/${drafting.id}/card-drafts/*`]: (route) => {
      sent.drafts.push(route.request().postDataJSON())
      state.drafted = { ...state.drafted, refinement: { ...state.drafted.refinement, draft: null } }
      return route.fulfill({ json: { created: [] } })
    },
    [`**/api/cards/${shipped.id}/branch-pr/merge`]: (route) => {
      sent.merges.push(shipped.id)
      // La première est refusée par la forge, la seconde passe.
      if (sent.merges.length === 1) return route.fulfill({ status: 409, json: { error: { code: 'suite_conflict', message: state.mergeRefusal } } })
      state.shipped = { ...state.shipped, branchPr: { ...state.shipped.branchPr, mergedAt: Date.now() } }
      return route.fulfill({ json: state.shipped.branchPr })
    },
  }
  for (const [url, handler] of Object.entries(routes)) await page.route(url, handler)
  return {
    state,
    sent,
    refining,
    drafting,
    uninstall: async () => {
      for (const url of Object.keys(routes)) await page.unroute(url)
    },
  }
}

/** Montre toutes les lignes : les nôtres viennent après les sessions du jeu d'essai. */
async function showAll(inbox) {
  const more = inbox.getByRole('button', { name: /de plus$/ })
  if (await more.count()) await more.click()
}

/** Les trois lignes, chacune à un seul endroit. */
export async function assertMilestoneRows({ page, fakes }) {
  const inbox = page.getByRole('region', { name: NAME, exact: true })
  await inbox.waitFor()
  await inbox.getByRole('button', { name: /^2 questions d’affinage/ }).waitFor()
  await showAll(inbox)
  const rows = inbox.getByRole('listitem')
  // Par la clé de la ligne : son titre change à mesure qu'on répond.
  const row = (key) => inbox.locator(`[id="inbox-${key}"]`)
  const refine = row(`refine-${fakes.state.milestone.id}`)
  const draft = row(`draft-${fakes.state.drafted.id}`)
  const merge = row(`merge-${fakes.state.shipped.id}`)
  await Promise.all([refine.waitFor(), draft.waitFor(), merge.waitFor()])
  await refine.getByText('2 questions d’affinage', { exact: true }).waitFor()
  await draft.getByText('Découpage proposé : 2 cartes', { exact: true }).waitFor()
  await merge.getByText('PR du jalon prête', { exact: true }).waitFor()
  // Le lien du jalon, sur chacune ; l'étiquette ne paraît qu'à partir de `sm` (INB-5).
  const wide = page.viewportSize().width >= 640
  for (const [row, card] of wide ? [[refine, fakes.state.milestone], [draft, fakes.state.drafted], [merge, fakes.state.shipped]] : []) {
    assert.equal(
      await row.getByRole('link', { name: `Jalon #${card.number}`, exact: true }).getAttribute('href'),
      new URL(`/p/${card.projectId}/timeline/${card.number}`, page.url()).pathname,
      `La ligne mène au jalon #${card.number}`,
    )
  }
  // Une demande à un seul endroit : ni la session d'affinage, ni la PR finale en « à relire ».
  for (const title of [fakes.refining.title, fakes.drafting.title]) {
    assert.equal(await rows.filter({ hasText: title }).count(), 0, `La session « ${title} » est remplacée par sa demande de jalon`)
  }
  assert.equal(await rows.filter({ hasText: 'Jalon : Socle commun' }).count(), 0, 'La PR du jalon n’est pas redite en « à relire »')
  await rows.filter({ hasText: 'Une PR sans jalon' }).waitFor()
  return { inbox, refine, draft, merge }
}

/**
 * L'Aperçu : les trois lignes, le repère du phare qui les compte, les gestes en doublure,
 * et une capture par bloc à 1280 et 390 px.
 */
export async function checkMilestoneAsks({ page, base, project, shots }) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${base}/p/${project.id}`)
  const beacon = page.getByRole('region', { name: 'Jalons', exact: true })
  const fakes = await installMilestoneAsks({ page, base, project })
  await page.reload()
  const { inbox, refine, draft, merge } = await assertMilestoneRows({ page, fakes })
  await inbox.screenshot({ animations: 'disabled', path: join(shots, 'apercu-ce-qui-t-attend-jalons.png') })

  /* Le phare lit `waitingByMilestone` : le jalon lancé passe en tête, et sa PR finale,
     qui n'y comptait pas, y est le repère « 1 t'attend » — qui déplie sa ligne (A-3.8). */
  await beacon.getByRole('link', { name: 'Socle commun', exact: true }).waitFor()
  await beacon.getByRole('button', { name: '1 t’attend', exact: true }).click()
  await merge.getByText('Toutes les cartes sont fusionnées dans', { exact: false }).waitFor()

  // INB-10 : la fusion refusée dit pourquoi, la ligne reste ; la seconde passe et l'emporte.
  await merge.getByRole('button', { name: 'Fusionner dans main', exact: true }).click()
  await merge.getByText(`Pas fusionnée : ${fakes.state.mergeRefusal}`, { exact: true }).waitFor()
  await merge.getByRole('button', { name: 'Fusionner', exact: true }).click()
  await merge.getByRole('alert').waitFor()
  await merge.screenshot({ animations: 'disabled', path: join(shots, 'apercu-pr-de-jalon-refusee.png') })
  await merge.getByRole('button', { name: 'Fusionner dans main', exact: true }).click()
  await merge.waitFor({ state: 'detached' })
  assert.deepEqual(fakes.sent.merges, [fakes.state.shipped.id, fakes.state.shipped.id])
  // Fusionnée, elle est livrée : le phare revient à v1.2, que sa question fait attendre.
  await beacon.getByRole('link', { name: fakes.state.milestone.title, exact: true }).waitFor()
  await beacon.getByRole('button', { name: /^\d+ t’attend(ent)?$/ }).waitFor()

  // INB-9 : le découpage déplié, numéroté, « après 1 » ; « Valider » l'envoie sous le jalon.
  await draft.getByRole('button', { name: 'Examiner', exact: true }).click()
  await draft.getByText('après 1', { exact: true }).waitFor()
  await draft.screenshot({ animations: 'disabled', path: join(shots, 'apercu-decoupage-de-jalon.png') })
  await draft.getByRole('button', { name: 'Valider', exact: true }).click()
  await draft.waitFor({ state: 'detached' })
  assert.equal(fakes.sent.drafts.length, 1)
  assert.equal(fakes.sent.drafts[0].decision, 'created')
  assert.deepEqual(
    fakes.sent.drafts[0].draft.parent,
    { kind: 'existing', card: { cardId: fakes.state.drafted.id, number: 9257, title: 'Actions et Planifiées' } },
    'Les cartes du brouillon naissent enfants du jalon',
  )

  // INB-8 : une question répondue sort de la ligne ; la dernière envoie le tout.
  await refine.getByRole('button', { name: 'Répondre', exact: true }).click()
  const first = refine.getByRole('textbox', { name: 'Le phare montre-t-il le jalon courant ?', exact: true })
  await first.fill('Le courant')
  await first.press('Enter')
  await inbox.getByRole('button', { name: /^1 question d’affinage/ }).waitFor()
  assert.equal(fakes.sent.answers.length, 0, 'Une demande du CLI se répond en une fois')
  const second = refine.getByRole('textbox', { name: 'Une carte hérite-t-elle de l’échéance du jalon ?', exact: true })
  await second.fill('Non')
  await second.press('Enter')
  await refine.waitFor({ state: 'detached' })
  assert.deepEqual(fakes.sent.answers, [{ status: 'answered', answers: { cible: ['Le courant'], heritage: ['Non'] } }])
  // La question levée, la session n'est pas revenue en dire autant.
  assert.equal(await inbox.getByRole('listitem').filter({ hasText: fakes.refining.title }).count(), 0)

  // Au téléphone : les trois lignes tiennent sans déborder.
  await fakes.uninstall()
  const again = await installMilestoneAsks({ page, base, project })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  const narrow = await assertMilestoneRows({ page, fakes: again })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Rien ne déborde à 390 px')
  await narrow.inbox.screenshot({ animations: 'disabled', path: join(shots, 'apercu-ce-qui-t-attend-jalons-mobile.png') })
  await again.uninstall()
  assert.deepEqual(again.sent, { answers: [], drafts: [], merges: [] })
  await page.setViewportSize({ width: 1440, height: 900 })
}
