import assert from 'node:assert/strict';
import test from 'node:test';
import { UsersController } from './users.controller';

test('UsersController export stays available for route wiring', () => {
  assert.equal(typeof UsersController, 'function');
});
