import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { connect } from 'node:net'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, projects, runMigrations, users } from '@solera/db'
import type { ProjectDto, ProjectPrototypesDto } from '@solera/protocol'
import { projectOverview } from '../src/agents/overview.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import type { CloneJobs } from '../src/clone-jobs.js'
import type { Config } from '../src/config.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerProjectRoutes } from '../src/http/routes/projects.js'
import { DESIGN_SYSTEM_LINE, StorybookSupervisor, type StorybookState } from '../src/design-system/storybooks.js'
import { registerDesignSystemRelay, rewriteHtml } from '../src/http/routes/design-system-relay.js'
import type { TerminalManager } from '../src/terminals/terminal-manager.js'

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-design-system-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  const ctx = { db, config: { paths: { data: dir } } as Config }
  registerProjectRoutes(app, ctx, {} as AttachmentStore, {} as CloneJobs, { aliveCount: () => 0 } as unknown as TerminalManager)
  t.after(() => app.close())

  const link = (designSystemPath: string | null) =>
    app.inject({ method: 'PATCH', url: '/api/projects/project', payload: { designSystemPath } })
  const listed = async () => (await app.inject({ url: '/api/projects' })).json<ProjectDto[]>()[0]!

  const prototypes = async () => (await app.inject({ url: '/api/projects/project/prototypes' })).json<ProjectPrototypesDto>()

  return { dir, link, listed, prototypes }
}

test('design system : un dossier qui porte un .storybook/ se lie, puis se délie', async (t) => {
  const { dir, link, listed } = await harness(t)
  const ds = join(dir, 'design-systems', 'ds-a')
  await mkdir(join(ds, '.storybook'), { recursive: true })

  assert.equal((await listed()).designSystemPath, null)

  // Un chemin qui ne se résout pas encore : `..` est normalisé avant d'être gardé.
  assert.equal((await link(join(ds, '..', 'ds-a'))).statusCode, 200)
  assert.equal((await listed()).designSystemPath, ds)

  assert.equal((await link(null)).statusCode, 200)
  assert.equal((await listed()).designSystemPath, null)
})

test('design system : un dossier sans .storybook/ est refusé, et le lien en place reste', async (t) => {
  const { dir, link, listed } = await harness(t)
  const ds = join(dir, 'ds')
  await mkdir(join(ds, '.storybook'), { recursive: true })
  await link(ds)

  const plain = join(dir, 'plain')
  await mkdir(plain)
  const file = join(dir, 'file.txt')
  await writeFile(file, '')

  const cases: [string, string][] = [
    ['relative/ds', 'design_system_not_absolute'],
    [join(dir, 'absent'), 'design_system_missing'],
    [file, 'design_system_not_a_directory'],
    [plain, 'design_system_no_storybook'],
  ]
  for (const [path, code] of cases) {
    const response = await link(path)
    assert.equal(response.statusCode, 400, path)
    assert.equal(response.json<{ error: { code: string } }>().error.code, code, path)
  }
  assert.equal((await listed()).designSystemPath, ds)
})

/** Ce que Storybook 10.6 publie, réduit à un composant, une entrée en erreur et une page. */
const manifests = (ds: string) => ({
  '/manifests/components.json': {
    v: 0,
    components: {
      // La forme de `react-docgen-typescript`, et des props qui nomment un type déclaré
      // dans un fichier voisin, lui-même en citant un autre.
      'primitives-choicelist': {
        id: 'primitives-choicelist',
        name: 'ChoiceList',
        path: './src/ChoiceList.stories.tsx',
        import: "import { ChoiceList } from '@acme/ui';",
        description: '',
        jsDocTags: {},
        reactDocgenTypescript: {
          description: 'Un choix parmi quelques-uns.',
          filePath: join(ds, 'src', 'ChoiceList.tsx'),
          props: {
            options: { name: 'options', required: true, type: { name: 'Choice<T>[]' }, description: '', defaultValue: null },
            dense: { name: 'dense', required: false, type: { name: 'boolean' }, description: 'Serré.', defaultValue: { value: 'false' } },
          },
        },
        stories: [],
      },
      'primitives-button': {
        id: 'primitives-button',
        name: 'Button',
        path: './src/Button.stories.tsx',
        // Dans l'ordre du fichier, sur plusieurs lignes : le DS n'est pas la première.
        import: "import { Send } from 'lucide-react';\nimport {\n  Button,\n} from '@acme/ui';",
        description: "L'action principale d'un écran.\nUne seule par écran.",
        jsDocTags: {},
        reactDocgen: {
          description: '',
          props: {
            variant: {
              required: false,
              tsType: { name: 'union', raw: "'primary' | 'ghost'" },
              description: 'Le poids visuel.',
              defaultValue: { value: "'primary'", computed: false },
            },
            label: { required: true, tsType: { name: 'string' }, description: '' },
          },
          composes: ['ButtonHTMLAttributes'],
        },
        stories: [
          { id: 'primitives-button--variantes', name: 'Variantes', snippet: '<Button variant="ghost" label="Plus tard" />', description: 'Côte à côte.' },
        ],
      },
      'motifs-non-alignes': {
        id: 'motifs-non-alignes',
        name: 'Non alignés',
        path: './src/motifs.stories.tsx',
        error: { name: 'No component found', message: 'We could not detect the component from your story file.' },
      },
    },
  },
  '/manifests/docs.json': {
    docs: {
      'principes--docs': { id: 'principes--docs', name: 'Docs', title: 'Principes', path: './src/Principes.mdx', content: '# Principes\n\nUne action principale par écran.' },
    },
  },
})

/**
 * Un faux paquet `storybook` : un serveur qui répond sur le port que Solera lui donne,
 * ce qui suffit à éprouver le lancement, l'état et l'arrêt sans le vrai Storybook.
 */
async function fakeDesignSystem(root: string, behaviour: 'serve' | 'crash'): Promise<string> {
  const ds = join(root, 'packages', 'ds')
  await mkdir(join(ds, '.storybook'), { recursive: true })
  await writeFile(join(ds, '.storybook', 'main.ts'), `const config = {}\n${DESIGN_SYSTEM_LINE}\n`)
  // Les dépendances à la racine, au-dessus du DS : le cas du monorepo.
  const pkg = join(root, 'node_modules', 'storybook')
  await mkdir(join(pkg, 'bin'), { recursive: true })
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'storybook', bin: { storybook: './bin/index.js' } }))
  await writeFile(
    join(pkg, 'bin', 'index.js'),
    behaviour === 'crash'
      ? "console.error('cannot find module vite'); process.exit(3)\n"
      : [
          "const { join, relative } = require('node:path')",
          "const port = Number(process.argv[process.argv.indexOf('-p') + 1])",
          `const manifests = ${JSON.stringify(manifests(ds))}`,
          // Les prototypes de deux projets, rangés comme Solera les range : un candidat et
          // un écran pour `project`, un candidat pour `other`.
          "const protos = process.env.SOLERA_PROTOTYPES",
          "const at = (project, file) => './' + relative(process.cwd(), join(protos, project, file))",
          "if (protos) Object.assign(manifests['/manifests/components.json'].components, {",
          "  'prototypes-project-profil': { id: 'prototypes-project-profil', name: 'ProfileCard', path: at('project', 'Profil.stories.tsx'), import: '', stories: [] },",
          "  'prototypes-project-ecran': { id: 'prototypes-project-ecran', name: 'Ecran', path: at('project', 'Ecran.stories.tsx'), import: '', stories: [] },",
          "  'prototypes-other-carte': { id: 'prototypes-other-carte', name: 'OtherCard', path: at('other', 'Carte.stories.tsx'), import: '', stories: [] },",
          "})",
          "const story = (id, name, exportName, importPath, tags) => ({ type: 'story', id, title: 'Prototypes/' + id.split('--')[0], name, exportName, importPath, tags })",
          "const index = { v: 5, entries: protos ? Object.fromEntries([",
          "  story('prototypes-project-profil--defaut', 'Défaut', 'Defaut', at('project', 'Profil.stories.tsx'), ['dev', 'candidate']),",
          "  story('prototypes-project-profil--compact', 'Compact', 'Compact', at('project', 'Profil.stories.tsx'), ['dev', 'candidate']),",
          "  story('prototypes-project-ecran--defaut', 'Défaut', 'Defaut', at('project', 'Ecran.stories.tsx'), ['dev']),",
          "  story('prototypes-other-carte--defaut', 'Défaut', 'Defaut', at('other', 'Carte.stories.tsx'), ['dev', 'candidate']),",
          "].map((entry) => [entry.id, entry])) : {} }",
          "require('node:http').createServer((req, res) => {",
          "  if (req.url.startsWith('/iframe.html')) {",
          "    res.setHeader('content-type', 'text/html')",
          "    res.setHeader('x-frame-options', 'DENY')",
          "    return res.end('<html><head><script type=\"module\" src=\"/vite-inject-mocker-entry.js\"></script></head><body><script src=\"' + process.env.SOLERA_STORYBOOK_BASE + '@vite/client\"></script><a href=\"//cdn.example/x\"></a></body></html>')",
          "  }",
          "  res.setHeader('content-type', 'application/json')",
          "  if (req.url === '/index.json') return res.end(JSON.stringify(index))",
          "  const manifest = manifests[req.url]",
          "  if (req.url.startsWith('/manifests/') && !manifest) { res.statusCode = 404; return res.end('{}') }",
          "  const env = Object.fromEntries(['SOLERA_STORYBOOK', 'SOLERA_PROTOTYPES', 'SOLERA_STORYBOOK_BASE'].map((name) => [name, process.env[name]]))",
          "  res.end(JSON.stringify(manifest ?? { url: req.url, cwd: process.cwd(), env }))",
          "}).on('upgrade', (req, socket) => {",
          "  socket.end('HTTP/1.1 101 Switching Protocols\\r\\nx-path: ' + req.url + '\\r\\nx-origin: ' + req.headers.origin + '\\r\\n\\r\\n')",
          "}).listen(port, '127.0.0.1')",
        ].join('\n'),
  )
  await mkdir(join(ds, 'src'), { recursive: true })
  await writeFile(
    join(ds, 'src', 'ChoiceList.tsx'),
    "import type { Choice } from './types'\nexport function ChoiceList<T extends string>(props: { options: Choice<T>[] }) { return null }\n",
  )
  await writeFile(
    join(ds, 'src', 'types.ts'),
    [
      '/** Le module des types. */',
      '',
      "export type Tone = 'neutral' | 'critical'",
      '',
      '/** Une option, avec sa ligne d\'aide. */',
      'export interface Choice<T extends string> {',
      '  value: T',
      '  onPick?: (value: T) => void',
      '  tone?: Tone',
      '}',
      '',
    ].join('\n'),
  )
  return ds
}

/** Un superviseur dont le relais connaît ce DS, sous les données de `root`. */
function supervisorIn(root: string, ds: string, options: { directory?: string } = {}) {
  return new StorybookSupervisor({
    directory: options.directory ?? join(root, 'state'),
    prototypesDirectory: join(root, 'prototypes'),
    inUse: () => false,
    linked: () => [ds],
  })
}

async function waitFor<T>(read: () => T | null, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== null) return value
    if (Date.now() > deadline) throw new Error('timeout')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const readState = (path: string): StorybookState | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StorybookState
  } catch {
    return null
  }
}

test('storybook : lancé depuis le node_modules du dessus, joignable, puis arrêté', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solera-storybook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ds = await fakeDesignSystem(root, 'serve')
  const supervisor = supervisorIn(root, ds)
  t.after(() => supervisor.shutdown())

  supervisor.ensure(ds)
  supervisor.ensure(ds)
  const statePath = supervisor.statePath(ds)
  const ready = await waitFor(() => {
    const state = readState(statePath)
    return state?.status === 'ready' ? state : null
  })
  const answer = (await (await fetch(`${ready.url}/cwd`)).json()) as { cwd: string; env: Record<string, string> }
  assert.equal(answer.cwd, ds)
  // Ce que la ligne du DS et le module qu'elle charge lisent.
  assert.match(answer.env.SOLERA_STORYBOOK!, /storybook\/solera-storybook\.mjs$/)
  assert.equal(answer.env.SOLERA_PROTOTYPES, supervisor.prototypesOf(ds))
  assert.equal(answer.env.SOLERA_STORYBOOK_BASE, ready.base)
  assert.match(ready.base, /^\/ds\/[0-9a-f]{32}\/$/)
  assert.equal(ready.prototypes, supervisor.prototypesOf(ds))
  assert.equal(ready.hooked, true)

  supervisor.shutdown()
  assert.equal(existsSync(statePath), false)
})

test('storybook : un process qui meurt au démarrage laisse un échec lisible', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solera-storybook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ds = await fakeDesignSystem(root, 'crash')
  const supervisor = supervisorIn(root, ds)
  t.after(() => supervisor.shutdown())

  supervisor.ensure(ds)
  const failed = await waitFor(() => {
    const state = readState(supervisor.statePath(ds))
    return state?.status === 'failed' ? state : null
  })
  assert.match(failed.error ?? '', /code 3/)
  assert.match(failed.error ?? '', /cannot find module vite/)
})

test('storybook : sans paquet storybook au-dessus du DS, l\'échec le dit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solera-storybook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ds = join(root, 'ds')
  await mkdir(join(ds, '.storybook'), { recursive: true })
  const supervisor = supervisorIn(root, ds)
  t.after(() => supervisor.shutdown())

  supervisor.ensure(ds)
  const failed = await waitFor(() => readState(supervisor.statePath(ds)))
  assert.equal(failed.status, 'failed')
  assert.match(failed.error ?? '', /node_modules/)
})

test('MCP : les outils du design system lisent le manifeste du Storybook lancé', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solera-storybook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ds = await fakeDesignSystem(root, 'serve')
  const supervisor = supervisorIn(root, ds)
  t.after(() => supervisor.shutdown())

  const dbPath = join(root, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  sqlite.close()

  // Attendu ici et non par le MCP : `spawnSync` bloque la boucle de ce process, où le
  // superviseur n'aurait alors jamais lancé le Storybook.
  supervisor.ensure(ds)
  await waitFor(() => (readState(supervisor.statePath(ds))?.status === 'ready' ? true : null))
  const mcp = (state: string, ...calls: [string, object][]) => {
    const input = [
      { jsonrpc: '2.0', id: 0, method: 'tools/list' },
      ...calls.map(([name, args], index) => ({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name, arguments: args } })),
    ]
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project', SOLERA_MCP_CONVERSATION: 'c', SOLERA_MCP_DESIGN_SYSTEM: state },
      encoding: 'utf8',
      timeout: 30_000,
      input: input.map((line) => JSON.stringify(line)).join('\n') + '\n',
    })
    assert.equal(run.status, 0, run.stderr)
    const replies = run.stdout.trim().split('\n').map((line) => JSON.parse(line) as { id: number; result: any })
    const byId = new Map(replies.map((reply) => [reply.id, reply.result]))
    return {
      tools: (byId.get(0).tools as { name: string }[]).map((tool) => tool.name),
      results: calls.map((_, index) => byId.get(index + 1) as { content: { text: string }[]; isError?: boolean }),
    }
  }

  const own = supervisor.projectPrototypes(ds, 'project')
  await writeFile(join(own, 'Profil.stories.tsx'), '')
  await writeFile(join(own, 'Vide.stories.tsx'), '')

  const linked = mcp(
    supervisor.statePath(ds),
    ['list_components', {}],
    ['read_component', { id: 'button' }],
    ['read_ds_page', { id: 'principes--docs' }],
    ['read_component', { id: 'Card' }],
    ['read_component', { id: 'primitives-choicelist' }],
    ['read_component', { id: 'OtherCard' }],
    ['show_prototype', { file: 'Profil.stories.tsx', story: 'Compact' }],
    ['show_prototype', { file: join(supervisor.projectPrototypes(ds, 'other'), 'Carte.stories.tsx') }],
    ['show_prototype', { file: 'Profil.stories.tsx', story: 'Absente' }],
  )
  assert.ok(linked.tools.includes('list_components'))
  assert.ok(linked.tools.includes('show_prototype'))
  const [list, button, page, missing, choices, foreign, shown, outside, absent] = linked.results.map(
    (result) => result.content[0]!.text,
  )

  // Les prototypes : le candidat de ce projet à part, ni son écran ni ceux d'un autre.
  assert.match(list, /## Candidats de ce projet\n.*\n- `prototypes-project-profil` \*\*ProfileCard\*\*/)
  assert.doesNotMatch(list, /Ecran|OtherCard/)
  assert.match(list.split('## Candidats')[0]!, /^Design system : 2 composant\(s\)\./)
  assert.equal(linked.results[5]!.isError, true)
  assert.match(foreign, /Aucun composant « OtherCard »/)

  // Un DS sans la ligne : le Storybook tourne, mais l'agent apprend quoi demander.
  const unhooked = join(root, 'unhooked.json')
  await writeFile(unhooked, JSON.stringify({ ...readState(supervisor.statePath(ds)), hooked: false }))
  const missingLine = mcp(unhooked, ['show_prototype', { file: 'Profil.stories.tsx' }]).results[0]!
  assert.equal(missingLine.isError, true)
  assert.ok(missingLine.content[0]!.text.includes(DESIGN_SYSTEM_LINE))

  const base = readState(supervisor.statePath(ds))!.base
  assert.match(shown, new RegExp(`^URL: ${base}iframe\\.html\\?id=prototypes-project-profil--compact&viewMode=story$`, 'm'))
  assert.match(shown, /taguée `candidate`/)
  assert.match(shown, /Autres stories du fichier : Defaut\./)
  assert.equal(linked.results[7]!.isError, true)
  assert.match(outside, /vit dans/)
  assert.equal(linked.results[8]!.isError, true)
  assert.match(absent, /Elles sont : Defaut, Compact\./)

  assert.match(list, /`primitives-button` \*\*Button\*\* — L'action principale d'un écran\./)
  assert.match(list, /`primitives-choicelist` \*\*ChoiceList\*\* — Un choix parmi quelques-uns\./)
  assert.match(list, /`import \{ Button \} from '@acme\/ui'`/)
  assert.doesNotMatch(list, /lucide-react/)
  assert.match(list, /`motifs-non-alignes` \(We could not detect the component/)
  assert.match(list, /`principes--docs` \*\*Principes\*\*/)

  assert.match(button, /- `variant\?: 'primary' \| 'ghost'` = 'primary' — Le poids visuel\./)
  assert.match(button, /- `label: string`/)
  assert.match(button, /ButtonHTMLAttributes/)
  assert.match(button, /### Variantes\nCôte à côte\.\n```tsx\n<Button variant="ghost"/)

  assert.match(choices, /Un choix parmi quelques-uns\./)
  assert.match(choices, /- `options: Choice<T>\[\]`/)
  assert.match(choices, /- `dense\?: boolean` = false — Serré\./)
  assert.match(
    choices,
    /## Types cités par les props\n```ts\n\/\*\* Une option, avec sa ligne d'aide\. \*\/\nexport interface Choice<T extends string> \{\n  value: T\n  onPick\?: \(value: T\) => void\n  tone\?: Tone\n\}\n\nexport type Tone = 'neutral' \| 'critical'\n```/,
  )
  assert.doesNotMatch(choices, /Le module des types/)

  assert.match(page, /# Principes\n\nSource : \.\/src\/Principes\.mdx/)
  assert.equal(linked.results[3]!.isError, true)
  assert.match(missing, /Aucun composant « Card »/)

  // Sans DS lié, les outils du design system ne sont pas annoncés du tout.
  const unlinked = mcp('')
  assert.equal(
    unlinked.tools.some((name) => ['list_components', 'read_component', 'read_ds_page', 'show_prototype'].includes(name)),
    false,
  )
})

test('aperçu : le rappel du design system suit le lien et le serveur MCP', async (t) => {
  const { dir, link } = await harness(t)
  const ds = join(dir, 'ds')
  await mkdir(join(ds, '.storybook'), { recursive: true })
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  t.after(() => sqlite.close())
  const overview = (soleraMcp: boolean) =>
    projectOverview(db, { projectId: 'project', conversationId: 'c', soleraMcp }) ?? ''

  assert.doesNotMatch(overview(true), /design system/)
  await link(ds)
  assert.match(overview(true), new RegExp(`lié à un design system \\(\`${ds}\`\\)[^]*\`list_components\``))
  assert.doesNotMatch(overview(true), /show_prototype/)
  // Avec un dossier de prototypes, la manière de prototyper et les trois paliers.
  const prototyping = projectOverview(db, { projectId: 'project', conversationId: 'c', soleraMcp: true, prototypesDir: '/p/project' }) ?? ''
  assert.match(prototyping, /story du DS dans `\/p\/project`/)
  assert.match(prototyping, /`show_prototype`/)
  assert.match(prototyping, /tags: \['candidate'\]/)
  // Sans le serveur, le rappel nommerait des outils absents.
  assert.doesNotMatch(overview(false), /design system/)
})

test('storybook : le jeton du relais est stable, propre à chaque DS, et seul à ouvrir le relais', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solera-storybook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = supervisorIn(root, '/ds/a')
  const token = first.token('/ds/a')
  first.shutdown()

  // Un daemon redémarré garde la clé : un aperçu ouvert depuis le fil reste valable.
  const again = supervisorIn(root, '/ds/a')
  t.after(() => again.shutdown())
  assert.equal(again.token('/ds/a'), token)
  assert.notEqual(again.token('/ds/b'), token)
  assert.equal(again.base('/ds/a'), `/ds/${token}/`)
  assert.equal(again.resolve('0'.repeat(32)), null)

  // Une autre instance, une autre clé.
  const other = supervisorIn(root, '/ds/a', { directory: join(root, 'other') })
  t.after(() => other.shutdown())
  assert.notEqual(other.token('/ds/a'), token)
})

test('relais : la page de Storybook servie sous /ds/<jeton>/, opaque et ramenée sous le préfixe', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solera-storybook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ds = await fakeDesignSystem(root, 'serve')
  const supervisor = supervisorIn(root, ds)
  t.after(() => supervisor.shutdown())
  const app = Fastify()
  registerDesignSystemRelay(app, supervisor)
  t.after(() => app.close())
  const base = supervisor.base(ds)

  // Pas encore lancé : il démarre, et la page le dit en se rechargeant.
  const starting = await app.inject({ url: `${base}iframe.html?id=x`, headers: { accept: 'text/html' } })
  assert.equal(starting.statusCode, 503)
  assert.match(starting.headers['content-security-policy'] as string, /^sandbox /)
  await waitFor(() => (readState(supervisor.statePath(ds))?.status === 'ready' ? true : null))

  const page = await app.inject({ url: `${base}iframe.html?id=x` })
  assert.equal(page.statusCode, 200)
  const policy = page.headers['content-security-policy'] as string
  assert.match(policy, /^sandbox allow-scripts/)
  assert.doesNotMatch(policy, /allow-same-origin/)
  assert.match(policy, /frame-ancestors 'self'/)
  assert.equal(page.headers['x-frame-options'], undefined)
  assert.equal(page.headers['access-control-allow-origin'], '*')
  assert.match(page.body, /<head><script>[^<]*localStorage[^<]*<\/script>/)
  assert.match(page.body, new RegExp(`src="${base}vite-inject-mocker-entry\\.js"`))
  assert.ok(page.body.includes(`src="${base}@vite/client"`))
  assert.ok(page.body.includes('href="//cdn.example/x"'))

  // Les routes de Storybook perdent le préfixe, celles de Vite le gardent.
  const echo = async (path: string) => (await app.inject({ url: `${base}${path}` })).json<{ url: string }>().url
  assert.equal(await echo('sb-manager/runtime.js'), '/sb-manager/runtime.js')
  assert.equal(await echo('@vite/client'), `${base}@vite/client`)
  assert.equal(await echo('@fs/x.tsx?v=1'), `${base}@fs/x.tsx?v=1`)

  assert.equal((await app.inject({ url: `/ds/${'0'.repeat(32)}/iframe.html` })).statusCode, 404)
})

test('relais : une page sans <head> reçoit quand même le stockage', () => {
  const html = rewriteHtml('<script src="/a.js"></script>', '/ds/t/')
  assert.match(html, /^<script>/)
  assert.ok(html.includes('src="/ds/t/a.js"'))
})

test('candidats : les stories taguées `candidate` des prototypes du projet, lues sur le disque', async (t) => {
  const { dir, link, prototypes } = await harness(t)
  assert.deepEqual(await prototypes(), { directory: null, candidates: [] })

  const ds = join(dir, 'ds')
  await mkdir(join(ds, '.storybook'), { recursive: true })
  await link(ds)
  const { directory } = await prototypes()
  assert.ok(directory?.startsWith(join(dir, 'prototypes')))
  assert.ok(directory?.endsWith('/project'))

  await mkdir(join(directory!, 'ecrans'), { recursive: true })
  await writeFile(join(directory!, 'Profil.stories.tsx'), "const meta = { component: Profil, tags: ['autodocs', 'candidate'] }")
  await writeFile(join(directory!, 'ecrans', 'Badge.stories.tsx'), 'const meta = { tags: ["candidate"] }')
  await writeFile(join(directory!, 'Ecran.stories.tsx'), "const meta = { tags: ['autodocs'] } // candidate plus tard")
  await writeFile(join(directory!, 'notes.md'), "tags: ['candidate']")

  const names = (await prototypes()).candidates.map((candidate) => candidate.name).sort()
  assert.deepEqual(names, ['Badge', 'Profil'])
})

test('relais : les websockets de Vite gardent le préfixe, le canal de Storybook le perd', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solera-storybook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ds = await fakeDesignSystem(root, 'serve')
  const supervisor = supervisorIn(root, ds)
  t.after(() => supervisor.shutdown())
  const app = Fastify()
  registerDesignSystemRelay(app, supervisor)
  t.after(() => app.close())
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as AddressInfo).port
  const base = supervisor.base(ds)
  supervisor.ensure(ds)
  await waitFor(() => (readState(supervisor.statePath(ds))?.status === 'ready' ? true : null))

  const upgrade = (path: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () =>
        socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: null\r\n\r\n`),
      )
      let answer = ''
      socket.on('data', (chunk) => (answer += chunk.toString()))
      socket.on('end', () => resolve(answer))
      socket.on('error', reject)
    })

  const hmr = await upgrade(`${base}?token=abc`)
  assert.match(hmr, /^HTTP\/1\.1 101/)
  assert.ok(hmr.includes(`x-path: ${base}?token=abc`))
  const channel = await upgrade(`${base}storybook-server-channel?token=abc`)
  assert.ok(channel.includes('x-path: /storybook-server-channel?token=abc'))
  // Storybook n'accepte son canal que de sa propre origine.
  assert.match(channel, /x-origin: http:\/\/127\.0\.0\.1:\d+/)
  assert.match(await upgrade(`/ds/${'0'.repeat(32)}/`), /^HTTP\/1\.1 404/)
})

test('catalogue : le DS de Solera porte la ligne que Solera attend, mot pour mot', () => {
  const main = readFileSync(fileURLToPath(new URL('../../catalog/.storybook/main.ts', import.meta.url)), 'utf8')
  assert.ok(main.includes(DESIGN_SYSTEM_LINE))
  // Et le serveur MCP en garde la même copie.
  const mcp = readFileSync(fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url)), 'utf8')
  assert.ok(mcp.includes(`'${DESIGN_SYSTEM_LINE}'`))
})
