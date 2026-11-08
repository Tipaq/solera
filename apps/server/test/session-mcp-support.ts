import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import cookie from '@fastify/cookie'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Db } from '@solera/db'
import type { McpSessionScope } from '../src/agents/mcp-builtin.js'
import { McpSessionTokens } from '../src/agents/mcp-session-tokens.js'
import type { Config } from '../src/config.js'
import { registerAuthHooks } from '../src/http/auth-hooks.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerMcpRoutes } from '../src/http/v1/mcp.js'

/**
 * Le chemin qu'emprunte le CLI d'une session pour joindre le serveur MCP de Solera :
 * un jeton de session, le garde d'authentification du serveur, le pont HTTP, et le vrai
 * process derrière lui. Les tests de portée passent par là plutôt que de lancer le
 * `.mjs` avec ses variables, pour éprouver aussi ce qui les pose.
 */

export interface ToolResult {
  content: { text: string }[]
  isError?: boolean
}

export interface ListedTool {
  name: string
  description: string
  inputSchema: { properties: Record<string, { description?: string }>; required?: string[] }
}

/** L'application minimale : le garde et le pont, sans le reste du serveur. */
export async function mcpApp(t: TestContext, db: Db, databasePath: string, tokens = new McpSessionTokens()) {
  const app = Fastify()
  await app.register(cookie)
  const config = {
    paths: { database: databasePath, memory: '' },
    mcp: { agentMemory: true },
    sessionCookie: 'solera_session_test',
  } as unknown as Config
  registerAuthHooks(app, { db, config }, tokens)
  registerErrorHandler(app)
  const bridge = registerMcpRoutes(app, { db, config }, tokens)
  t.after(() => app.close())
  return { app, tokens, bridge }
}

/** Un client MCP qui présente un jeton, comme le fait un CLI. */
export function mcpClient(app: FastifyInstance, token: string) {
  let counter = 0
  let session: string | undefined
  const post = (message: object, sessionId = session) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { authorization: `Bearer ${token}`, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      payload: { jsonrpc: '2.0', ...message },
    })
  const initialize = async () => {
    const response = await post({
      id: ++counter,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    })
    assert.equal(response.statusCode, 200, response.body)
    session = response.headers['mcp-session-id'] as string
    return session
  }
  const rpc = async (method: string, params?: object) => {
    if (!session) await initialize()
    const response = await post({ id: ++counter, method, ...(params ? { params } : {}) })
    assert.equal(response.statusCode, 200, response.body)
    return response.json().result
  }
  return {
    post,
    initialize,
    rpc,
    tools: async () => ((await rpc('tools/list')) as { tools: ListedTool[] }).tools,
    toolNames: async () => ((await rpc('tools/list')) as { tools: ListedTool[] }).tools.map((tool) => tool.name),
    call: async (name: string, args: object = {}) => {
      const result = (await rpc('tools/call', { name, arguments: args })) as ToolResult
      return { ...result, text: result.content[0]?.text ?? '' }
    },
  }
}

/** La portée d'une session ordinaire, à ajuster par ce que le test éprouve. */
export function sessionScope(overrides: Partial<McpSessionScope> & { conversationId: string }): McpSessionScope {
  return {
    projectId: null,
    memoryDir: '',
    projectFiling: false,
    cardFiling: false,
    decisions: false,
    proposeCards: false,
    designSystemState: '',
    ...overrides,
  }
}

/** Un jeton émis pour cette portée, et le client qui le présente. */
export async function sessionMcp(t: TestContext, db: Db, databasePath: string, scope: McpSessionScope) {
  const { app, tokens, bridge } = await mcpApp(t, db, databasePath)
  const token = tokens.issue(scope.conversationId, scope)
  return { app, tokens, bridge, token, ...mcpClient(app, token) }
}
