import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSMTP } from '../lib/smtp.mjs'
import { serveStaticSite } from '../scripts/static-site.mjs'

test('SMTP validation rejects header injection, plaintext transport, masked passwords and implicit recipients', () => {
  const config = { from_email: 'wiki@example.test', from_name: 'Wiki', smtp_host: 'smtp.feishu.cn', smtp_port: 465, encryption: 'SSL', smtp_username: 'wiki@example.test', smtp_password: 'example-client-password', smtp_authentication: true }
  assert.equal(validateSMTP(config).smtp_port, 465)
  for (const extra of [{ from_name: 'Wiki\r\nBcc: hidden@example.test' }, { encryption: '' }, { smtp_password: '********' }, { smtp_port: '465' }, { test_email_recipient: 'unexpected@example.test' }]) assert.throws(() => validateSMTP({ ...config, ...extra }))
})

test('directory redirects retain verification codes and login return paths', () => {
  let result
  serveStaticSite({ url: '/users/account-activation?code=test-code&next=%2Fask%2F' }, { writeHead(status, headers) { result = { status, headers } }, end() {} }, '.')
  assert.equal(result.status, 308)
  assert.equal(result.headers.Location, '/users/account-activation/?code=test-code&next=%2Fask%2F')
})
