#!/usr/bin/env node
// Serveur de protocole déterministe : aucun modèle, réseau ou accès au vrai compte.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

let initialized = false
let turn = null
let nextTurn = 1
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const notify = (method, params) => {
  if (method === 'turn/completed' && params.threadId === 'root') turn = null
  send({ method, params })
}
const emit = (scenario) => {
  for (const entry of scenario.notifications ?? []) notify(entry.method, entry.params)
  for (const entry of scenario.requests ?? []) send(entry)
  for (const line of scenario.lines ?? []) process.stdout.write(`${line}\n`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  appendFileSync('rpc.jsonl', `${line}\n`)
  const { method, id, params } = message
  if (!method) return
  if (method === 'initialize') {
    send({ id, result: { userAgent: 'fixture' } })
    return
  }
  if (method === 'initialized') { initialized = true; return }
  if (!initialized) { send({ id, error: { code: -32002, message: 'Not initialized' } }); return }
  switch (method) {
    case 'thread/start':
    case 'thread/resume':
      send({ id, result: { thread: { id: 'root' }, model: 'fixture', cwd: process.cwd() } })
      break
    case 'skills/list': send({ id, result: { data: [] } }); break
    case 'mcpServerStatus/list': send({ id, result: { data: [], nextCursor: null } }); break
    case 'turn/start': {
      const text = params.input.find((input) => input.type === 'text')?.text ?? ''
      const scenario = text.startsWith('fixture:') ? JSON.parse(text.slice(8)) : {}
      if (!turn) {
        turn = { id: `turn-${nextTurn++}`, status: 'inProgress', items: [], error: null }
        if (!scenario.silentStart) notify('turn/started', { threadId: 'root', turn })
      }
      const response = { id, result: { turn } }
      emit(scenario)
      // Le CLI peut clore le tour AVANT d'accuser réception de turn/start.
      send(response)
      break
    }
    case 'turn/steer': {
      if (!turn || params.expectedTurnId !== turn.id) {
        send({ id, error: { code: -32600, message: 'expected turn mismatch' } })
        break
      }
      const text = params.input.find((input) => input.type === 'text')?.text ?? ''
      const turnId = turn.id
      // `fixture-late:` rejoue le pire cas : les notifications lues avant l'accusé,
      // comme lorsqu'elles arrivent dans le même bloc de stdout.
      if (text.startsWith('fixture-late:')) emit(JSON.parse(text.slice(13)))
      // Ordre relevé sur 0.163.0 : l'accusé du steer précède la fin des deltas coupés.
      send({ id, result: { turnId } })
      if (text.startsWith('fixture:')) emit(JSON.parse(text.slice(8)))
      break
    }
    case 'turn/interrupt':
      if (turn) notify('turn/completed', { threadId: 'root', turn: { ...turn, status: 'interrupted' } })
      send({ id, result: {} })
      break
    // Le code d'appareil tel que sondé sur 0.162.1 : l'URL et le code au retour, puis
    // `auth.json` dans `$CODEX_HOME` (à défaut le cwd) et `account/login/completed`.
    case 'account/login/start': {
      if (params.type !== 'chatgptDeviceCode') { send({ id, result: { type: params.type } }); break }
      send({ id, result: { type: 'chatgptDeviceCode', loginId: 'fixture', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'FIXT-CODE' } })
      setTimeout(() => {
        writeFileSync(`${process.env.CODEX_HOME ?? process.cwd()}/auth.json`, '{"fixture":true}')
        notify('account/login/completed', { loginId: 'fixture', success: true, error: null, onboardingEntrypoint: null })
      }, 50)
      break
    }
    case 'account/read': {
      const connected = existsSync(`${process.env.CODEX_HOME ?? process.cwd()}/auth.json`)
      send({ id, result: { account: connected ? { type: 'chatgpt', email: 'fixture@example.com', planType: 'plus' } : null, requiresOpenaiAuth: true } })
      break
    }
    case 'fixture/emit': emit(params); send({ id, result: {} }); break
    case 'fixture/error': send({ id, error: { code: -32602, message: 'Invalid fixture input', data: { retry: false } } }); break
    default: send({ id, result: {} })
  }
})
