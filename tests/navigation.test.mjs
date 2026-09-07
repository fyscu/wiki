import test from 'node:test'
import assert from 'node:assert/strict'
import { safeReturnPath } from '../lib/navigation.mjs'

test('login returns only to this origin, including browser-normalized paths', () => {
  const origin = 'https://wiki.feiyang.ac.cn'
  for (const path of ['//evil.example', '/\\evil.example', '/\n/evil.example', 'https://evil.example', '/login/', '/a/../login/', null]) {
    assert.equal(safeReturnPath(path, origin), '/questions/')
  }
  assert.equal(safeReturnPath('/question/?id=123#answer', origin), '/question/?id=123#answer')
})
