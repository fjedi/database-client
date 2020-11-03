import { getTableName } from '../src';

describe('Test database-client', function () {
  it('Get valid snake-cased db-table name', async function () {
    const result = getTableName('UserSession');

    expect(result).toBe('user_session');
  });
});
