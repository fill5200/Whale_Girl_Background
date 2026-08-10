// src/assets.mjs 单测（node:test）。归属：路径净化/MIME 改动跑本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeAssetPath, contentTypeFor } from '../.dsh-plugin/src/assets.mjs'

test('合法相对路径通过', () => {
  assert.equal(sanitizeAssetPath('/plugins/vlln/whale-girl/assets/idle.png'), 'idle.png')
  assert.equal(sanitizeAssetPath('/plugins/vlln/whale-girl/assets/sub/idle.svg'), 'sub/idle.svg')
})

test('目录穿越（..）拒绝', () => {
  assert.equal(sanitizeAssetPath('/plugins/vlln/whale-girl/assets/../secret.png'), null)
  assert.equal(sanitizeAssetPath('/plugins/vlln/whale-girl/assets/a/../../etc/passwd'), null)
})

test('前缀不匹配 / 空路径 / 点段拒绝', () => {
  assert.equal(sanitizeAssetPath('/plugins/other/client.js'), null)
  assert.equal(sanitizeAssetPath('/plugins/vlln/whale-girl/assets/'), null)
  assert.equal(sanitizeAssetPath('/plugins/vlln/whale-girl/assets/./x.png'), null)
})

test('空字节与 Windows 反斜杠段拒绝（注入面）', () => {
  assert.equal(sanitizeAssetPath('/plugins/vlln/whale-girl/assets/idle.png\u0000.jpg'), null)
  assert.equal(sanitizeAssetPath('/plugins/vlln/whale-girl/assets/a\\b.png'), null)
})

test('MIME 映射与未知扩展兜底', () => {
  assert.equal(contentTypeFor('idle.png'), 'image/png')
  assert.equal(contentTypeFor('idle.svg'), 'image/svg+xml')
  assert.equal(contentTypeFor('manifest.json'), 'application/json; charset=utf-8')
  assert.equal(contentTypeFor('weird.bin'), 'application/octet-stream')
})
