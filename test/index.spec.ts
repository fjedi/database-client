import { redis } from '@fjedi/redis-client';
import { getTableName, getModelName } from '../src';

describe('Test database-client', function () {
  beforeAll(async () => {
    console.log('Emit beforeAll test-hook');
  });

  afterAll(async () => {
    console.log('Emit afterAll test-hook');
    redis.end(true);
  });

  it('Get valid snake-cased db-table name', async function () {
    const result = getTableName('UserSession');

    expect(result).toBe('user_session');
  });

  it('Get valid PascalCased db-model name', async function () {
    const result = getModelName('user-session');

    expect(result).toBe('UserSession');
  });
});
