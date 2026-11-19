// W1 PoC: connect to a `dsh --profile sdk` runtime subprocess over stdio
// JSON-RPC using @deepseek-ai/dsh-sdk-client from the harness source checkout,
// run one harmless prompt, and print every notification / server request.
//
// The SDK client is imported directly from the harness checkout's built lib
// (its internal bare-specifier imports resolve against the checkout's pnpm
// node_modules, and its launch resolver finds the same-version built dsh bin
// at apps/cli/lib/bin.js). No npm install is needed for this PoC.
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessClient } from '/home/rowan/Projects/deepseek-harness/packages/sdk/client/lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const dshHome = resolve(here, '.dsh-home')
rmSync(dshHome, { recursive: true, force: true })
mkdirSync(dshHome, { recursive: true })

const log = (tag, value) => console.log(`[${new Date().toISOString()}] ${tag} ${JSON.stringify(value)}`)

const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)
if (!hasKey) {
  log('skip', { reason: 'DEEPSEEK_API_KEY not set; the turn below will run and fail closed with MISSING_CREDENTIAL (recorded honestly). TODO: rerun with a key for the approval/user-question chain.' })
}

const client = new HarnessClient({
  dshHome,
  cwd: here,
  approvalRequests: true,
  env: process.env,
  // onUserQuestion must be set so initialize declares capabilities.userQuestions.
  onUserQuestion: async (request) => {
    log('user-question/ask', request)
    const answers = request.questions.map((q) => ({
      id: q.id,
      selected: q.options?.[0] ? [q.options[0].label] : [],
    }))
    log('user-question/answer', { answers })
    return { answers }
  },
})

client.subscribe((notification) => {
  log(`notify ${notification.method}`, notification.params ?? {})
})

client.start()

// Server-to-client requests other than user-question/ask land here.
client.onRequest(async (method, params) => {
  log(`request ${method}`, params)
  if (method === 'approval/request') {
    const outcome = { outcome: 'allowed-once' }
    log('approval/answer', outcome)
    return outcome
  }
  throw new Error(`demo has no answer for ${method}`)
})

let exitCode = 0
try {
  const init = await client.initialize({
    cwd: here,
    provider: 'deepseek-official',
    model: 'deepseek-official',
    approvalRequests: true,
  })
  log('initialize.result', init)

  // Harmless task: no shell/file tools expected; auto-answer any approval.
  // Without a key the turn still runs and fails closed with MISSING_CREDENTIAL,
  // which honestly exercises session.status running/idle + session.event.
  const queued = await client.request('session/prompt', {
    sessionId: 'w1-poc',
    contentBlocks: [{ type: 'text', text: '用一句话介绍你自己。' }],
  })
  log('session/prompt.result', queued)
  await client.request('session/wait', { sessionId: 'w1-poc' })
  log('session/wait.result', { sessionId: 'w1-poc' })
  if (!hasKey) {
    log('note', { llm: 'turn failed closed with MISSING_CREDENTIAL (expected without DEEPSEEK_API_KEY); approval/request + user-question/ask TODO with a key' })
  }
} catch (error) {
  exitCode = 1
  log('error', { name: error?.name, message: String(error?.message ?? error) })
} finally {
  await client.close()
  log('closed', { exitCode })
  process.exit(exitCode)
}
