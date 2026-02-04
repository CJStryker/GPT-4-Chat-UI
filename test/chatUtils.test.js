import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMessage,
  messageRole,
  computeHistoryPairs,
} from '../lib/chatUtils.js';

test('createMessage builds expected payload', () => {
  assert.deepEqual(createMessage('user', 'Hello'), {
    role: 'user',
    type: 'userMessage',
    content: 'Hello',
  });

  assert.deepEqual(createMessage('assistant'), {
    role: 'assistant',
    type: 'apiMessage',
    content: '',
  });
});

test('messageRole prefers explicit role then falls back to type', () => {
  assert.equal(messageRole({ role: 'assistant' }), 'assistant');
  assert.equal(messageRole({ type: 'userMessage' }), 'user');
  assert.equal(messageRole({ type: 'apiMessage' }), 'assistant');
});

test('computeHistoryPairs aggregates user/assistant turns', () => {
  const conversation = [
    createMessage('assistant', 'Hi there!'),
    createMessage('user', 'What is Ollama?'),
    createMessage('assistant', 'It runs local models.'),
    createMessage('user', 'Thanks!'),
    createMessage('assistant', 'Anytime.'),
  ];

  assert.deepEqual(computeHistoryPairs(conversation), [
    ['What is Ollama?', 'It runs local models.'],
    ['Thanks!', 'Anytime.'],
  ]);
});

