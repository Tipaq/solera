import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { cardMoves, cardNotes, cards, conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type CardColumn, type WorktreeStatusDto, type WorktreeStatusListDto } from '@solera/protocol'
import { recordCardMove } from '../src/cards/moves.js'
import { closeMergedCards } from '../src/worktrees/merged-cards.js'

/** La fusion d'un worktree termine la carte des sessions qui y vivaient (#86). */
async function harness(t: TestContext, column: CardColumn = 'review') {
  const dir = await mkdtemp(join(tmpdir(), 'solera-merged-cards-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()
  const project = db.select().from(projects).where(eq(projects.id, 'project')).get()!
  db.insert(cards)
    .values({
      id: 'card', projectId: 'project', number: 1, title: 'Carte', description: '', column,
      position: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1,
    })
    .run()
  db.insert(conversations)
    .values({
      id: 'resident', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude',
      config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle', cardId: 'card', createdAt: 1, updatedAt: 1,
    })
    .run()

  const list = (tree: Partial<WorktreeStatusDto> = {}): WorktreeStatusListDto => ({
    base: 'main',
    computedAt: Date.now(),
    fresh: true,
    worktrees: [
      {
        id: null, name: 'feat', path: '/tmp/feat', branch: 'feat', external: false, state: 'merged',
        ahead: 0, behind: 0, modified: 0, untracked: 0, conflicts: false, unmergedCommits: false,
        head: 'abc', lastCommitAt: 1000, lastEditAt: null,
        conversations: [{ id: 'resident', link: 'worktree' }],
        ...tree,
      },
    ],
  })
  const columnOf = () => db.select({ column: cards.column }).from(cards).where(eq(cards.id, 'card')).get()?.column

  return { db, project, list, columnOf }
}

test('la fusion passe la carte en Terminé, tracée et notée, une seule fois par livraison', async (t) => {
  const { db, project, list, columnOf } = await harness(t)

  // Ni avant la fusion, ni pendant qu'une session y travaille encore.
  assert.equal(closeMergedCards(db, project, list({ state: 'unmerged', ahead: 2 })), 0)
  db.update(conversations).set({ status: 'running' }).where(eq(conversations.id, 'resident')).run()
  assert.equal(closeMergedCards(db, project, list()), 0)
  db.update(conversations).set({ status: 'idle' }).where(eq(conversations.id, 'resident')).run()

  assert.equal(closeMergedCards(db, project, list()), 1)
  assert.equal(columnOf(), 'done')
  const [move] = db.select().from(cardMoves).all()
  assert.equal(move?.toColumn, 'done')
  assert.equal(move?.userId, null)
  assert.equal(move?.conversationId, null)
  assert.match(db.select().from(cardNotes).get()?.body ?? '', /`feat` est fusionnée dans `main`/)

  // Ramenée à la main : elle y reste tant que l'arbre ne livre rien de neuf.
  db.update(cards).set({ column: 'in_progress' }).where(eq(cards.id, 'card')).run()
  recordCardMove(db, { cardId: 'card', from: 'done', to: 'in_progress', userId: 'owner' })
  assert.equal(closeMergedCards(db, project, list()), 0)
  assert.equal(columnOf(), 'in_progress')

  // Un nouveau commit fusionné est une nouvelle livraison.
  assert.equal(closeMergedCards(db, project, list({ lastCommitAt: Date.now() + 60_000 })), 1)
  assert.equal(columnOf(), 'done')
})

test('ni une carte à faire, ni celle d’une session qui n’a fait qu’écrire dans l’arbre', async (t) => {
  const todo = await harness(t, 'todo')
  assert.equal(closeMergedCards(todo.db, todo.project, todo.list()), 0)
  assert.equal(todo.columnOf(), 'todo')

  const visited = await harness(t, 'in_progress')
  assert.equal(
    closeMergedCards(visited.db, visited.project, visited.list({ conversations: [{ id: 'resident', link: 'edited' }] })),
    0,
  )
  assert.equal(visited.columnOf(), 'in_progress')

  // Ni un arbre neuf, sans commit à lui, ni la branche par défaut.
  assert.equal(closeMergedCards(visited.db, visited.project, visited.list({ state: 'empty' })), 0)
  assert.equal(closeMergedCards(visited.db, visited.project, visited.list({ branch: 'main' })), 0)
  assert.equal(visited.columnOf(), 'in_progress')
})
