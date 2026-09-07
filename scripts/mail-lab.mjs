import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, open } from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import YAML from 'yaml'
import { serveStaticSite } from './static-site.mjs'
import { communityApi } from './community-api.mjs'
import { createQaMiddleware } from './qa-proxy.mjs'

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

export async function startMailLab() {
  await mkdir('runtime', { recursive: true })
  const directory = await mkdtemp(resolve('runtime/mail-lab-'))
  const binary = resolve(process.env.ANSWER_TEST_BINARY || (process.platform === 'win32' ? '.cache/answer-login-windows.exe' : '.cache/answer-login-linux'))
  const backendPort = await freePort(), frontPort = await freePort()
  const backend = `http://127.0.0.1:${backendPort}`, origin = `http://127.0.0.1:${frontPort}`
  const admin = { e_mail: 'admin@wiki-mail.test', pass: randomBytes(18).toString('base64url') }
  const messages = []
  const smtp = new SMTPServer({
    authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'], logger: false,
    onRcptTo(address, _session, callback) { callback(address.address.endsWith('@wiki-mail.test') ? undefined : new Error('Test recipients only')) },
    onData(stream, session, callback) {
      simpleParser(stream).then(mail => { messages.push({ ...mail, recipients: session.envelope.rcptTo.map(item => item.address) }); callback() }, callback)
    },
  })
  await new Promise((resolve, reject) => { smtp.once('error', reject); smtp.listen(0, '127.0.0.1', resolve) })
  const smtpPort = smtp.server.address().port
  const environment = { ...process.env, AUTO_INSTALL: '1', INSTALL_PORT: '0', DB_TYPE: 'sqlite3', DB_FILE: resolve(directory, 'answer.db'), LANGUAGE: 'zh_CN', SITE_NAME: '飞扬 Wiki', SITE_URL: origin, CONTACT_EMAIL: admin.e_mail, ADMIN_NAME: 'mail-lab-admin', ADMIN_EMAIL: admin.e_mail, ADMIN_PASSWORD: admin.pass, EXTERNAL_CONTENT_DISPLAY: 'ask_before_display' }
  let answer, front, log
  async function close() {
    if (front) { front.closeAllConnections(); await new Promise(resolve => front.close(resolve)) }
    if (answer && answer.exitCode === null) { const exited = once(answer, 'exit'); answer.kill(); await exited }
    await new Promise(resolve => smtp.close(resolve))
    await log?.close()
  }
  try {
    try {
      const result = await promisify(execFile)(binary, ['init', '-C', directory], { env: environment, windowsHide: true, timeout: 20000 })
      await writeFile(resolve(directory, 'init.log'), result.stdout + result.stderr, { mode: 0o600 })
    } catch (error) {
      await writeFile(resolve(directory, 'init.log'), String(error.stdout || '') + String(error.stderr || ''), { mode: 0o600 })
      throw new Error(`Isolated Answer initialization failed; see ${directory}/init.log`)
    }
    const configPath = resolve(directory, 'conf/config.yaml')
    const config = YAML.parse(await readFile(configPath, 'utf8'))
    config.server.http.addr = `127.0.0.1:${backendPort}`
    await writeFile(configPath, YAML.stringify(config), { mode: 0o600 })
    log = await open(resolve(directory, 'answer.log'), 'a', 0o600)
    answer = spawn(binary, ['run', '-C', directory], { env: environment, windowsHide: true, stdio: ['ignore', log.fd, log.fd] })
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (answer.exitCode !== null) throw new Error(`Isolated Answer stopped; see ${directory}/answer.log`)
      try { ready = (await fetch(backend + '/answer/api/v1/siteinfo')).ok } catch {}
      if (ready) break
      await delay(100)
    }
    if (!ready) throw new Error('Isolated Answer did not start')
    async function call(path, method = 'GET', data, token) {
      const response = await fetch(backend + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10000) })
      const body = await response.json()
      if (!response.ok || body.code !== 200) throw new Error(`${path}: ${response.status} ${body.msg}`)
      return body.data
    }
    const user = await call('/answer/api/v1/user/login/email', 'POST', admin)
    await call('/answer/admin/api/setting/smtp', 'PUT', { from_email: 'noreply@wiki-mail.test', from_name: '飞扬 Wiki', smtp_host: '127.0.0.1', smtp_port: smtpPort, encryption: '', smtp_username: '', smtp_password: '', smtp_authentication: false }, user.access_token)
    const login = await call('/answer/admin/api/siteinfo/login', 'GET', undefined, user.access_token)
    await call('/answer/admin/api/siteinfo/login', 'PUT', { ...login, allow_new_registrations: true, allow_email_registrations: true, require_email_verification: true }, user.access_token)
    const directoryOfSite = JSON.parse(await readFile('.cache/site-current.json', 'utf8')).directory
    const api = communityApi(backend), qa = createQaMiddleware(backend)
    front = createServer((req, res) => {
      if (new URL(req.url, origin).pathname === '/account-status.json') { res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end('{"mail_ready":true}'); return }
      api(req, res, () => qa(req, res, () => serveStaticSite(req, res, directoryOfSite)))
    })
    await new Promise(resolve => front.listen(frontPort, '127.0.0.1', resolve))
    return { origin, backend, directory, messages, close, adminCall: (path, method, data) => call(path, method, data, user.access_token) }
  } catch (error) { await close(); throw error }
}
