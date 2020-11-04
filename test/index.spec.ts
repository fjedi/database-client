import { redis } from '@fjedi/redis-client';
import {
  getTableName,
  getModelName,
  createConnection,
  initDatabase,
  DatabaseConnectionOptions,
} from '../src';
import { User } from '../src/schemas/user';

const NODE_INSTANCES_NUMBER = parseInt(process.env.NODE_INSTANCES_NUMBER || '', 10) || 1;
const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || '', 10) || 150;

const options: DatabaseConnectionOptions = {
  sync: false,
  maxConnections: Math.floor(DB_MAX_CONNECTIONS / NODE_INSTANCES_NUMBER),
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(`${process.env.DB_PORT}`, 10) || 3306,
  engine: 'mysql',
  name: process.env.DB_NAME || process.env.DB_USER,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || undefined,
};

const models = { User };

type Models = {
  User: User;
};

describe('Test database-client', function () {
  beforeAll(async () => {
    console.log('Emit beforeAll test-hook');

    // const connection = createConnection(options);
    // // @ts-ignore
    // const db = await initDatabase<Models>(connection, {
    //   models,
    // });

    // const modelName: 'User' = 'User';
    // const userById = await db.helpers.dbInstanceById<typeof modelName>(modelName, 'test-user-id');
    // const userOne = await db.helpers.findOne<typeof modelName>(modelName, {
    //   where: { id: 'test-user-id' },
    // });
    // const userAll = await db.helpers.findAll<typeof modelName>(modelName, {
    //   where: { name: 'test-user-id' },
    // });
    // userAll.forEach((user) => {
    //   console.log(user.firstName);
    // });

    // console.log(userById?.firstName);
    // console.log(userOne?.firstName);
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
