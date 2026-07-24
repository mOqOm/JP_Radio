import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginAccount } from '@/logic/auth';

test('createLoginAccount: user/passが両方有効ならLoginAccountを返す', () => {
  assert.deepEqual(createLoginAccount('user@example.com', 'pass1234'), {
    mail: 'user@example.com',
    pass: 'pass1234',
  });
});

test('createLoginAccount: radikoUserが未指定ならnull', () => {
  assert.equal(createLoginAccount(undefined, 'pass1234'), null);
});

test('createLoginAccount: radikoPassが未指定ならnull', () => {
  assert.equal(createLoginAccount('user@example.com', undefined), null);
});

test('createLoginAccount: radikoUserが空文字ならnull', () => {
  assert.equal(createLoginAccount('', 'pass1234'), null);
});

test('createLoginAccount: radikoPassが空文字ならnull', () => {
  assert.equal(createLoginAccount('user@example.com', ''), null);
});

test('createLoginAccount: 両方未指定ならnull', () => {
  assert.equal(createLoginAccount(undefined, undefined), null);
});
