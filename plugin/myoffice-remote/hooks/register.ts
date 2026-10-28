import type { EngineInterface, Register } from 'claude-code'

// Receives the commands you send from the myoffice dashboard
// (http://localhost:4545, click a person) and carries them out in this session:
//   say  → submitted as your prompt (if a turn is running, after it ends)
//   stop → stops the turn that is running now
//
// The dashboard queues each command as
// ~/.cache/session-remote/<this session's id>/<13-digit time>-<8 hex>.json.
// Any local program can write that folder, so a file proves nothing on its
// own: a prompt-injected session could pose as you to a session with more
// rights. The dashboard only issues a command after you confirm with Touch ID
// (or your login password) and gives it a one-time token that lives in the
// dashboard server's memory. Before acting, this asks the server on
// 127.0.0.1:4545 whether it issued that token for this session and this text,
// and drops the command if not.
//
// A file is claimed with `mv -n` first, so if two processes poll the same
// session only one acts on it. Links are never followed, commands older than
// 10 minutes are dropped, and what was sent is prefixed with 〔myoffice〕 so the
// transcript and the model can tell it came from the dashboard. Every outcome
// is written to acks/<session id>/ for the dashboard to show.

const POLL_MS = 2_000
const STALE_MS = 10 * 60_000
const MAX_TEXT = 4_000
const PREFIX = '〔myoffice〕'
const FILE = /^\d{13}-[0-9a-f]{8}\.json$/
const VERIFY_URL = 'http://127.0.0.1:4545/api/hub/verify'

type Command = { kind?: unknown; text?: unknown; at?: unknown; token?: unknown }

let runningTurn: string | undefined
let busy = false

async function inboxRoot($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME').catch(() => undefined)

  return home ? `${home}/.cache/session-remote` : undefined
}

async function verified($: EngineInterface, cmd: Command, me: string): Promise<boolean> {
  try {
    const r = await $.http.fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'x-whatsmyagentdoing': 'verify', 'content-type': 'application/json' },
      body: JSON.stringify({ token: cmd.token, session: me, kind: cmd.kind, text: typeof cmd.text === 'string' ? cmd.text.trim() : '' }),
    })

    return r.ok && (JSON.parse(r.text) as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

async function run($: EngineInterface, cmd: Command | null, now: number, me: string): Promise<string> {
  if (!cmd || typeof cmd !== 'object') return 'skipped:bad'
  if (typeof cmd.at !== 'number' || now - cmd.at > STALE_MS || cmd.at - now > 60_000) return 'skipped:stale'
  if (cmd.kind !== 'say' && cmd.kind !== 'stop') return 'skipped:bad-kind'
  const text = typeof cmd.text === 'string' ? cmd.text.trim() : ''
  if (cmd.kind === 'say' && (!text || text.length > MAX_TEXT)) return 'skipped:bad-text'
  if (typeof cmd.token !== 'string' || !(await verified($, cmd, me))) return 'skipped:unverified'
  if (cmd.kind === 'say') {
    $.ui.toast(runningTurn ? 'myoffice: message received, sending when this turn ends' : 'myoffice: message received')
    // Not awaited: while the session is busy the submit only settles once it
    // is idle, and the inbox must keep moving.
    void $.prompt.submit({ text: `${PREFIX} ${text}`, asUser: true }).catch(err =>
      $.ui.toast(`myoffice: could not send the message: ${String(err).slice(0, 160)}`),
    )

    return runningTurn ? 'queued' : 'sent'
  }
  if (!runningTurn) return 'skipped:idle'
  await $.turn.abort({ turnId: runningTurn })
  $.ui.toast('myoffice: stopped this turn')

  return 'stopped'
}

async function drain($: EngineInterface) {
  const root = await inboxRoot($)
  if (!root) return
  const me = await $.session.id()
  const dir = `${root}/${me}`
  let names: string[]
  try {
    names = (await $.fs.list(dir))
      .filter(x => x.kind === 'file' && !x.isLink && FILE.test(x.name))
      .map(x => x.name)
      .sort()
  } catch {
    return // no inbox, nothing sent
  }
  for (const name of names) {
    const claimed = `${dir}/.claimed-${name}`
    if ((await $.process.run(['mv', '-n', `${dir}/${name}`, claimed])).exitCode !== 0) continue
    let cmd: Command | null = null
    try {
      cmd = JSON.parse(await $.fs.read(claimed)) as Command
    } catch {
      cmd = null
    }
    await $.process.run(['rm', '-f', claimed])
    const now = await $.clock.now()
    let outcome: string
    try {
      outcome = await run($, cmd, now, me)
    } catch (err) {
      outcome = `failed:${String(err).slice(0, 160)}`
    }
    // A fresh random name, never the inbox file's: a link planted under that
    // name cannot redirect this write.
    const ack = `${root}/acks/${me}/${now}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}.json`
    await $.fs.write(ack, JSON.stringify({ kind: cmd?.kind ?? null, outcome, at: now }))
  }
}

async function poll($: EngineInterface) {
  if (busy) return
  busy = true
  try {
    await drain($)
  } catch {
    // try again on the next tick
  } finally {
    busy = false
  }
}

export const register: Register = on => {
  // Only the main loop's turn is stopped, never a subagent's.
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) runningTurn = e.turnId

    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    if (e.turnId === runningTurn) runningTurn = undefined

    return next(e)
  })
  on('session.start', async ($, e, next) => {
    // Background sessions too: no surface is needed to receive.
    $.clock.every(POLL_MS, () => void poll($))

    return next(e)
  })
}
