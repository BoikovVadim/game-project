import assert from 'node:assert/strict';
import test from 'node:test';
import { generateQuestionCatalog, getQuestionGeneratorGroups } from './catalog';

test('question generator catalog exposes named groups', () => {
  const groups = getQuestionGeneratorGroups();
  assert.ok(groups.length >= 10);
  assert.equal(new Set(groups.map((group) => group.name)).size, groups.length);
});

test('question generator catalog produces a non-empty catalog', () => {
  const questions = generateQuestionCatalog();
  assert.ok(questions.length > 1000);
  assert.ok(questions.every((question) => question.question && question.options.length >= 2));
});
