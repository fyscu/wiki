import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveAnswerLink } from '../lib/answer-links.mjs'

test('Answer notification URLs resolve to the unified question and answer view', () => {
  for (const path of ['/questions/104/105', '/questions/104/title/105/']) {
    assert.equal(resolveAnswerLink(new URL(path, 'https://wiki.feiyang.ac.cn')), '/question/?id=104&answer=105')
  }
  for (const path of ['/questions/104', '/questions/104/title/']) {
    assert.equal(resolveAnswerLink(new URL(path, 'https://wiki.feiyang.ac.cn')), '/question/?id=104')
  }
})

test('notification redirects retain only a valid comment id and cannot replace the linked question', () => {
  assert.equal(resolveAnswerLink(new URL('https://wiki.feiyang.ac.cn/questions/104/105?commentId=106&id=999&next=//example.test')), '/question/?id=104&answer=105&commentId=106')
  assert.equal(resolveAnswerLink(new URL('https://wiki.feiyang.ac.cn/questions/104/105?commentId=bad')), '/question/?id=104&answer=105')
  for (const path of ['/questions/', '/questions/ask', '/questions/../admin', '/questions/104/extra/paths/105']) assert.equal(resolveAnswerLink(new URL(path, 'https://wiki.feiyang.ac.cn')), null)
})
