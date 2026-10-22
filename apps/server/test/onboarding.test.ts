import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import cookie from '@fastify/cookie'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, runMigrations, users } from '@solera/db'
import type { InstanceInfo, UserSettingsDto } from '@solera/protocol'
import type { Config } from '../src/config.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerAuthRoutes } from '../src/http/routes/auth.js'
import { registerSystemRoutes } from '../src/http/routes/system.js'
import { registerUserSettingsRoutes } from '../src/http/routes/user-settings.js'
import { registerUserRoutes } from '../src/http/routes/users.js'
import { insertProject } from '../src/projects/create.js'
import { readUserSettings, writeProjectDefaults } from '../src/settings/user-settings.js'

/** Une base vide, comme à la première ouverture, et les routes que la visite emploie. */
async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-onboarding-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const config = { paths: { data: dir }, sessionCookie: 'solera_session' } as unknown as Config
  const ctx = { db, config }

  const app = Fastify()
  await app.register(cookie)
  // Le compte courant est posé par le test, par l'en-tête `x-user` : c'est la création
  // qui est exercée, pas le hook de session.
  app.addHook('preHandler', async (request) => {
    const id = request.headers['x-user']
    if (typeof id === 'string') request.user = db.select().from(users).where(eq(users.id, id)).get()
  })
  registerErrorHandler(app)
  registerAuthRoutes(app, ctx)
  registerSystemRoutes(app, ctx)
  registerUserSettingsRoutes(app, ctx)
  registerUserRoutes(app, ctx)
  t.after(() => app.close())

  return { dir, db, ctx, app }
}

const setup = (app: Awaited<ReturnType<typeof harness>>['app'], username = 'tim') =>
  app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username, displayName: username, password: 'correct horse battery' },
  })

test('premier compte : créé une seule fois, administrateur, visite armée, session ouverte', async (t) => {
  const { db, app } = await harness(t)

  const before = await app.inject({ url: '/api/system/instance' })
  assert.equal(before.json<InstanceInfo>().needsSetup, true)

  const created = await setup(app)
  assert.equal(created.statusCode, 201, created.body)
  assert.equal(created.json().isAdmin, true)
  assert.match(created.headers['set-cookie'] as string, /solera_session=/)

  const row = db.select().from(users).where(eq(users.username, 'tim')).get()
  assert.ok(row)
  assert.equal(row.isAdmin, true)
  const settings = readUserSettings(db, row.id)
  assert.equal(settings.onboarding.pending, true)
  assert.equal(settings.onboarding.step, 0)

  const after = await app.inject({ url: '/api/system/instance' })
  assert.equal(after.json<InstanceInfo>().needsSetup, false)

  // Un second appel n'a plus de raison d'exister : la base a un compte.
  const again = await setup(app, 'intrus')
  assert.equal(again.statusCode, 409)
  assert.equal(again.json().error.code, 'setup_done')
})

test('premier compte : mot de passe trop court et identifiant invalide refusés', async (t) => {
  const { app } = await harness(t)
  const short = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'a', displayName: 'A', password: 'court' } })
  assert.equal(short.statusCode, 400)
  const bad = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'pas bon', displayName: 'A', password: 'assez long pourtant' } })
  assert.equal(bad.statusCode, 400)
})

test('un compte d’avant la visite ne la voit pas surgir', async (t) => {
  const { db } = await harness(t)
  db.insert(users).values({ id: 'ancien', username: 'ancien', displayName: 'ancien', passwordHash: '', isAdmin: true, createdAt: 1 }).run()
  assert.equal(readUserSettings(db, 'ancien').onboarding.pending, false)
})

test('la visite se mémorise au compte, et un membre créé par un administrateur l’a due', async (t) => {
  const { db, app } = await harness(t)
  await setup(app, 'admin')
  const admin = db.select().from(users).where(eq(users.username, 'admin')).get()!

  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/me/settings',
    headers: { 'x-user': admin.id },
    payload: {
      onboarding: {
        pending: true,
        step: 3,
        answers: { agents: ['claude', 'grok'], agentsChosen: true, permission: 'acceptEdits' },
        skipped: ['appearance'],
        visited: ['welcome', 'appearance'],
      },
    },
  })
  assert.equal(patched.statusCode, 200, patched.body)
  const read = await app.inject({ url: '/api/me/settings', headers: { 'x-user': admin.id } })
  const onboarding = read.json<UserSettingsDto>().onboarding
  assert.equal(onboarding.step, 3)
  assert.deepEqual(onboarding.answers.agents, ['claude', 'grok'])
  assert.equal(onboarding.answers.permission, 'acceptEdits')
  assert.deepEqual(onboarding.skipped, ['appearance'])

  // Terminée : plus due.
  await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: { 'x-user': admin.id }, payload: { onboarding: { ...onboarding, pending: false } } })
  assert.equal(readUserSettings(db, admin.id).onboarding.pending, false)

  const member = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { 'x-user': admin.id },
    payload: { username: 'bob', displayName: 'Bob', password: 'provisoire-123', isAdmin: false },
  })
  assert.equal(member.statusCode, 201, member.body)
  const bob = db.select().from(users).where(eq(users.username, 'bob')).get()!
  assert.equal(readUserSettings(db, bob.id).onboarding.pending, true)
})

test('mode de consignes par défaut : appliqué à la création qui ne dit rien', async (t) => {
  const { dir, db, ctx } = await harness(t)
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', isAdmin: true, createdAt: 1 }).run()
  const withAgents = join(dir, 'avec-agents')
  await mkdir(withAgents)
  await writeFile(join(withAgents, 'AGENTS.md'), '# consignes\n')
  const bare = join(dir, 'nu')
  await mkdir(bare)
  const fields = (workspacePath: string) =>
    ({ name: 'p', workspacePath, visibility: 'private', color: null, instructionsMode: undefined }) as const

  // `auto`, le défaut : d'après ce que le dossier porte.
  assert.equal((await insertProject(ctx, 'owner', fields(withAgents))).instructionsMode, 'repo')
  assert.equal((await insertProject(ctx, 'owner', fields(bare))).instructionsMode, 'solera')

  writeProjectDefaults(db, 'owner', { instructionsMode: 'solera' })
  assert.equal((await insertProject(ctx, 'owner', fields(withAgents))).instructionsMode, 'solera')

  // Un choix du formulaire l'emporte sur le défaut, `auto` compris.
  const chosen = await insertProject(ctx, 'owner', { ...fields(bare), instructionsMode: 'repo' })
  assert.equal(chosen.instructionsMode, 'repo')
  const detected = await insertProject(ctx, 'owner', { ...fields(withAgents), instructionsMode: 'auto' })
  assert.equal(detected.instructionsMode, 'repo')
})
