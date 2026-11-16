import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BUILTIN_MCP_SERVER_NAME, type McpServer } from '@solera/protocol'
import { BUILTIN_MCP_SERVER_ID, builtinMcpServer } from '../src/agents/mcp-builtin.js'
import { toCodexThreadConfig } from '../src/agents/codex/mcp.js'

test('Codex nomme sa session sans accord, et rien d’autre ne passe ainsi', () => {
  const builtin = builtinMcpServer({ baseUrl: 'http://127.0.0.1:7517', token: 'solera_mcp_x' })
  // C'est l'identifiant du serveur intégré qui compte : un serveur tiers n'en profite pas.
  const thirdParty: McpServer = { ...builtin, id: 'external', name: 'external' }
  const servers = toCodexThreadConfig([builtin, thirdParty]).mcp_servers as Record<string, Record<string, unknown>>
  assert.deepEqual(servers[BUILTIN_MCP_SERVER_NAME]!.tools, { rename_session: { approval_mode: 'approve' } })
  assert.equal(servers[BUILTIN_MCP_SERVER_NAME]!.default_tools_approval_mode, undefined)
  assert.equal(servers.external!.tools, undefined)
  // Le serveur intégré part en HTTP, jeton en en-tête.
  assert.equal(servers[BUILTIN_MCP_SERVER_NAME]!.url, 'http://127.0.0.1:7517/api/v1/mcp')
  assert.deepEqual(servers[BUILTIN_MCP_SERVER_NAME]!.http_headers, { Authorization: 'Bearer solera_mcp_x' })
  assert.equal(builtin.id, BUILTIN_MCP_SERVER_ID)
})
