import { get, uniq, flatten } from 'lodash';
import { map as mapPromise } from 'bluebird';
import {
  Sequelize,
  Op,
  Transaction,
  QueryOptions,
  WhereOptions,
  IncludeOptions,
  Dialect,
  QueryTypes,
  Options,
  DataTypes,
  Model,
} from 'sequelize';
// @ts-ignore
import { createContext, EXPECTED_OPTIONS_KEY } from 'dataloader-sequelize';
import getQueryFields from 'graphql-list-fields';
import { stringify, parse } from 'json-buffer';
import shimmer from 'shimmer';
import { logger as rootLogger } from '@fjedi/logger';
import { RedisClient } from '@fjedi/redis-client';
import { DefaultError } from '@fjedi/errors';

//
import { getModelName, getTableName } from './helpers';

import runMigrations from './migrate';

export type DatabaseConnectionOptions = {
  engine?: Dialect;
  storage?: 'mysql' | 'postgres';
  host?: string;
  port?: number;
  name?: string;
  user?: string;
  password?: string;
  timezone?: string;
  /**
   * A function that gets executed while running the query to log the sql.
   */
  logging?: boolean | ((sql: string, timing?: number) => void);
  errorLogger?: typeof databaseQueryLogger | undefined;
  sync?: boolean;
  alter?: boolean;
  forceSync?: boolean;
  //
  processName?: string;
  maxConnections: number;
  minConnections?: number;
};
export type DatabaseTransaction = Transaction;
export type DatabaseTransactionProps = {
  transaction?: DatabaseTransaction;
  isolationLevel?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
  autocommit?: boolean;
};
export type DatabaseModels = {
  [k: string]: Model;
};

export type SortDirection = 'ASC' | 'DESC';
export type DatabaseWhere = WhereOptions;
export type DatabaseInclude = IncludeOptions;

export interface DatabaseQueryOptions extends QueryOptions {
  transaction?: DatabaseTransaction;
  attributes?: string[];
  where?: WhereOptions;
  include?: IncludeOptions[];
  raw?: boolean;
  context?: any;
}
export interface DatabaseTreeQueryOptions extends DatabaseQueryOptions {
  cachePolicy?: 'no-cache' | 'cache-first' | 'cache-only';
  cachePeriod?: number;
  cacheKey?: string;
  throwErrorIfNotFound?: boolean;
  resolveInfo?: any;
  relationKeysMap?: Map<string, string>;
}

export type GetQueryTreeParams = {
  fields?: string[];
  databaseModel: DatabaseModels[keyof DatabaseModels];
  includes?: IncludeOptions[];
  relationKeysMap?: Map<string, string>;
};

type PaginationOptions = unknown;

export type DatabaseHelpers = {
  wrapInTransaction: (
    action: (tx: DatabaseTransaction) => Promise<any>,
    opts?: DatabaseTransactionProps,
  ) => Promise<any>;
  afterCommitHook: (tx: DatabaseTransaction, hookFn: () => any) => void;
  getListQueryOptions(query: any, defaults?: any): PaginationOptions;
  getModelName: typeof getModelName;
  getTableName: typeof getTableName;
  getQueryTree: (p: GetQueryTreeParams) => any;
  createDatabaseContext: (p: any) => any;
  findAndCountAll: (
    modelName: keyof DatabaseModels,
    o?: DatabaseTreeQueryOptions,
  ) => Promise<{ rows: DatabaseModels[keyof DatabaseModels][]; count: number }>;
  findAll: (
    modelName: keyof DatabaseModels,
    o?: DatabaseTreeQueryOptions,
  ) => Promise<DatabaseModels[keyof DatabaseModels][]>;
  findOne: (
    modelName: keyof DatabaseModels,
    o?: DatabaseTreeQueryOptions,
  ) => Promise<DatabaseModels[keyof DatabaseModels] | null>;
  findOrCreate: (
    modelName: keyof DatabaseModels,
    where: any,
    defaults?: any,
    opts?: DatabaseTreeQueryOptions,
  ) => Promise<[DatabaseModels[keyof DatabaseModels], boolean]>;
  dbInstanceById: (
    modelName: keyof DatabaseModels,
    id: string,
    opts?: DatabaseTreeQueryOptions,
  ) => Promise<DatabaseModels[keyof DatabaseModels] | null>;
};

export type DatabaseConnection = Sequelize & {
  helpers: DatabaseHelpers;
  QueryTypes?: QueryTypes;
  fn?: (functionName: string, columnName: string, args?: string) => string;
  col?: (v: string) => string;
  literal?: (v: string) => string;
  models: DatabaseModels;
  redis: RedisClient;
};

//
const logger = rootLogger.child({ module: 'DATABASE' });

export function databaseQueryLogger(query: string, params: any): void {
  const { bind } = params;
  return logger.info(query, { bind });
}

//
function shimCachedInstance(instance: any) {
  shimmer.wrap(
    instance,
    'update',
    (original: any) =>
      function shimmedInstance(updates: any, options = {}) {
        // @ts-ignore
        if (options.shimmed) {
          // @ts-ignore
          // eslint-disable-next-line prefer-rest-params
          return original.apply(this, arguments);
        }
        const {
          name: { singular: modelName },
          sequelize: { models },
        } = instance._modelOptions; // eslint-disable-line no-underscore-dangle
        //
        return models[modelName].findByPk(instance.id, options).then((reloadedInstance: any) =>
          reloadedInstance.update(updates, {
            ...options,
            shimmed: true,
          }),
        );
      },
  );
  shimmer.wrap(
    instance,
    'destroy',
    (original: any) =>
      function shimmedInstance(options = {}) {
        // @ts-ignore
        if (options.shimmed) {
          // @ts-ignore
          // eslint-disable-next-line prefer-rest-params
          return original.apply(this, arguments);
        }
        const {
          name: { singular: modelName },
          sequelize: { models },
        } = instance._modelOptions; // eslint-disable-line no-underscore-dangle
        //
        return models[modelName]
          .findByPk(instance.id, { ...options, paranoid: false })
          .then((reloadedInstance: any) =>
            reloadedInstance.destroy({
              ...options,
              shimmed: true,
            }),
          );
      },
  );
}

function queryBuilder(
  connection: DatabaseConnection,
  modelName: keyof DatabaseModels,
  opts?: DatabaseTreeQueryOptions,
) {
  const {
    context,
    cachePeriod = 30000,
    throwErrorIfNotFound = true,
    resolveInfo,
    relationKeysMap,
    attributes = [],
    ...bypassParams
  } = opts || {};
  //
  const model = connection.models[modelName];
  const dataloaderContext = get(context, 'state.dataloaderContext', {});

  const queryParams = {
    ...dataloaderContext,
    // logging: process.env.NODE_ENV === 'development' ? console.log : undefined,
    ...bypassParams,
  };
  //
  if (resolveInfo) {
    const fields: string[] = getQueryFields(resolveInfo);
    queryParams.include = connection.helpers.getQueryTree({
      fields,
      databaseModel: model,
      includes: bypassParams.include,
      relationKeysMap,
    });
    //
    const indexes: Array<{ fields: string[] }> = get(model, '_indexes', []);
    const indexFields: string[] = flatten(indexes.map((i) => i.fields));
    //
    attributes.push(
      ...model.primaryKeyAttributes,
      ...indexFields,
      ...(model.options.timestamps ? ['createdAt', 'updatedAt'] : []),
      ...(model.options.paranoid ? ['deletedAt'] : []),
      ...fields
        .map((rf) => {
          const f = rf.replace('rows.', '');
          const isNestedData = f.includes('.');
          const [field] = isNestedData ? f.split('.') : [f];
          //
          return field;
        })
        .filter((f) => {
          // @ts-ignore
          const isJSON = get(model, `rawAttributes.${f}.type`) instanceof DataTypes.JSON;
          const isRawAttribute = Object.keys(model.rawAttributes).includes(f);
          //
          return isJSON || isRawAttribute;
        }),
    );
  }
  //
  if (Array.isArray(attributes) && attributes.length > 0) {
    queryParams.attributes = uniq(attributes);

    if (Array.isArray(queryParams.order)) {
      queryParams.order.forEach((o: [any, SortDirection]) => {
        const [
          field,
          // direction,
        ] = o;
        if (typeof field === 'string') {
          queryParams.attributes.push(field);
        }
      });
    }
  }

  return queryParams;
}

function createConnection<TModels>(params: {
  user: string;
  name: string;
  password?: string;
  dbOptions: Options;
  models: TModels;
}) {
  const { name, user, password, dbOptions, models } = params;
  const connection = new Sequelize(name, user, password, dbOptions);
  // @ts-ignore
  connection.Op = Op;
  // @ts-ignore
  connection.models = models;

  return connection as DatabaseConnection & {
    models: TModels;
  };
}

export default async function initDatabase<TModels>(
  models: TModels,
  options: DatabaseConnectionOptions,
): Promise<DatabaseConnection & { models: TModels }> {
  const {
    engine = 'mysql',
    host = '127.0.0.1',
    port = 3306,
    name,
    user,
    password,
    timezone = '+00:00',
    logging,
    sync = false,
    maxConnections,
    minConnections,
  } = options;
  //
  if (!name || typeof name !== 'string') {
    throw new Error("'name' is a required param to init database connection");
  }
  if (!user || typeof user !== 'string') {
    throw new Error("'user' is a required param to init database connection");
  }
  if (maxConnections <= 10) {
    throw new Error("'maxConnections' passed to 'initDatabase' function must be greater than 10");
  }

  // Creating database connection
  const minPoolConnections =
    typeof minConnections === 'number' ? minConnections : Math.ceil(maxConnections / 4);

  // Creating database connection
  const dbOptions: Options = {
    // @ts-ignore
    dialect: engine,
    host,
    port: parseInt(`${port}`, 10),
    timezone,
    define: {
      charset: 'utf8mb4',
      collate: 'utf8mb4_general_ci',
      underscored: false,
    },
    pool: {
      // this value couldn't be greater than "mysqlServer's 'max_connections' value / num of node instances"
      max: maxConnections,
      // We shouldn't has greater than 10 as "min" number of active db-connections
      min: minPoolConnections > 25 ? 25 : minPoolConnections,
      idle: 3000, // The maximum time, in milliseconds, that a connection can be idle before being released.
      evict: 1000, // The time interval, in milliseconds, after which sequelize-pool will remove idle connections.
      acquire: 30000, // The maximum time, in milliseconds, that pool will try to get connection before throwing error
    },
    logging,
  };
  // Create db connection instance
  const connection = createConnection({ name, user, password, dbOptions, models });

  // Checking DB connection
  await connection.authenticate();

  logger.info('DB Connection has been established successfully');

  // Used as an 'invisible' property on transaction objects,
  // used to stored "after*" hook functions that should only run if the transaction actually commits successfully
  const transHooks = Symbol('afterCommitHooks');
  connection.helpers = {
    //
    getModelName,
    getTableName,
    //
    getQueryTree(params: GetQueryTreeParams) {
      const { fields, databaseModel, includes = [], relationKeysMap } = params;
      (fields || []).forEach((i) => {
        const field = i.split('.');
        // Skip "rows" field
        const associationField = field[0] === 'rows' ? field[1] : field[0];
        const as = (relationKeysMap && relationKeysMap.get(associationField)) || associationField;
        const association = get(databaseModel, `associations[${as}]`);
        //
        if (association) {
          //
          const { target: model } = association;
          if (!includes.some((include) => include.as === as)) {
            includes.push({
              paranoid: false,
              model,
              as,
              include: connection.helpers.getQueryTree({
                relationKeysMap,
                fields: (fields || [])
                  .filter((f) => f.split('.').includes(as))
                  .map((f) => f.replace(`${as}.`, '')),
                databaseModel: model,
                includes: [],
                // @ts-ignore
                i,
              }),
            });
          }
        }
      });
      //
      return includes;
    },
    //
    createDatabaseContext() {
      //
      return {
        [EXPECTED_OPTIONS_KEY]: createContext(connection),
      };
    },
    afterCommitHook(transaction, hookFn) {
      if (typeof hookFn !== 'function') return;
      if (!transaction) {
        hookFn();
        return;
      }

      // @ts-ignore
      if (!transaction[transHooks]) {
        // @ts-ignore
        // eslint-disable-next-line no-param-reassign
        transaction[transHooks] = [];

        const origFn = transaction.commit;
        // eslint-disable-next-line no-param-reassign
        transaction.commit = function commitTransaction(...args) {
          const commitPromise = origFn.call(this, ...args);
          // @ts-ignore
          const runHooks = (v) => transaction[transHooks].forEach((fn) => fn()) && v;
          //
          return typeof (commitPromise && commitPromise.then) === 'function'
            ? commitPromise.then(runHooks)
            : runHooks(commitPromise);
        };
      }

      // @ts-ignore
      transaction[transHooks].push(hookFn);
    },
    //
    async wrapInTransaction(
      action: (transaction: Transaction) => Promise<any>,
      opts?: DatabaseTransactionProps,
    ): Promise<any> {
      const { isolationLevel, autocommit = false } = opts || {};
      // If no parent transaction has been passed inside "opts"
      // init new transaction
      const transaction =
        opts?.transaction ||
        (await connection.transaction({
          isolationLevel: isolationLevel ? Transaction.ISOLATION_LEVELS[isolationLevel] : undefined,
          autocommit,
        }));
      try {
        const result = await action(transaction);
        // If no parent transaction has been passed inside "opts"
        // commit inner transaction
        if (!opts?.transaction) {
          await transaction.commit();
        }
        return result;
      } catch (error) {
        // If no parent transaction has been passed inside "opts"
        // rollback inner transaction
        if (!opts?.transaction) {
          try {
            await transaction.rollback();
          } catch (err) {
            logger.error('Failed to rollback failed transaction', err);
          }
        }
        throw error;
      }
    },
    async findOrCreate(modelName, where, defaults = {}, opts) {
      const model = connection.models[modelName];
      const exist = await model.findOne({
        where,
        ...opts,
      });
      if (exist) {
        return [exist, false];
      }
      return [await model.create(defaults, opts), true];
    },
    //
    async findAndCountAll(modelName, opts) {
      //
      const {
        cachePolicy = 'no-cache',
        cachePeriod = 10000,
        throwErrorIfNotFound = true,
        context,
        resolveInfo,
        raw,
        relationKeysMap,
        ...queryOptions
      } = opts || {};
      //
      const model = connection.models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const cacheKey = `${modelName}_findAndCountAll_${stringify(queryOptions)}`;
      let cachedInstance;
      if (cachePolicy !== 'no-cache') {
        try {
          //
          const cached = await connection.redis.getAsync(cacheKey);
          //
          if (cached) {
            const { rows, count } = parse(cached);
            cachedInstance = {
              count,
              rows: await mapPromise(rows, (r: any) => model.build(r)),
            };
          } else {
            cachedInstance = null;
          }
          if (cachePolicy === 'cache-only') {
            return cachedInstance || { rows: [], count: 0 };
          }
        } catch (err) {
          cachedInstance = null;
          logger.error(err);
        }
      }
      //
      const p = queryBuilder(connection, modelName, opts);
      // if (cachedInstance && cachePolicy === 'cache-first') {
      //   model
      //     .findAndCountAll(p)
      //     .then(res => {
      //       connection.redis.set(cacheKey, stringify(res), 'PX', cachePeriod);
      //     })
      //     .catch(logger.error);
      // }
      //
      const res = cachedInstance || (await model.findAndCountAll(p));
      //
      const limitedFields = Array.isArray(p.attributes) && p.attributes.length > 0;
      if (!raw && !limitedFields && dataloaderContext) {
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(res.rows);
      }
      //
      if (cachePolicy !== 'no-cache') {
        connection.redis.set(cacheKey, stringify(res), 'PX', cachePeriod);
      }
      //
      return res;
    },
    //
    async findAll(modelName, opts) {
      //
      const {
        cachePolicy = 'no-cache',
        cachePeriod = 10000,
        throwErrorIfNotFound = true,
        context,
        raw,
        resolveInfo,
        relationKeysMap,
        ...queryOptions
      } = opts || {};
      //
      const model = connection.models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const cacheKey = `${modelName}_findAll_${stringify(queryOptions)}`;
      let cachedInstance;
      if (cachePolicy !== 'no-cache') {
        try {
          //
          const cached = await connection.redis.getAsync(cacheKey);
          //
          if (cached) {
            cachedInstance = await mapPromise(parse(cached), (r: any) => model.build(r));
          } else {
            cachedInstance = null;
          }
          if (cachePolicy === 'cache-only') {
            return cachedInstance || [];
          }
        } catch (err) {
          cachedInstance = null;
          logger.error(err);
        }
      }
      //
      const p = queryBuilder(connection, modelName, opts);
      //
      // if (cachedInstance && cachePolicy === 'cache-first') {
      //   model
      //     .findAll(p)
      //     .then(res => {
      //       connection.redis.set(cacheKey, stringify(res), 'PX', cachePeriod);
      //     })
      //     .catch(logger.error);
      // }
      //
      const rows = cachedInstance || (await model.findAll(p));
      //
      const limitedFields = Array.isArray(p.attributes) && p.attributes.length > 0;
      if (!raw && !limitedFields && dataloaderContext) {
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(rows);
      }
      //
      if (cachePolicy !== 'no-cache') {
        connection.redis.set(cacheKey, stringify(rows), 'PX', cachePeriod);
      }
      //
      return rows;
    },
    async findOne(modelName, opts) {
      const { cachePeriod = 30000, throwErrorIfNotFound = true, context, resolveInfo, raw } =
        opts || {};
      const cachePolicy =
        opts?.cacheKey && connection.redis && !resolveInfo
          ? get(opts, 'cachePolicy', 'cache-first')
          : 'no-cache';
      //
      const model = connection.models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const cacheKey = `${modelName}_findOne_${opts?.cacheKey}`;
      let cachedInstance;
      if (cachePolicy !== 'no-cache') {
        try {
          //
          const cached = await connection.redis.getAsync(cacheKey);
          cachedInstance = cached ? model.build(parse(cached)) : null;
          //
          if (cachedInstance) {
            shimCachedInstance(cachedInstance);
          }
          //
          if (cachePolicy === 'cache-only') {
            return cachedInstance;
          }
        } catch (err) {
          cachedInstance = null;
          logger.error(err);
        }
      }
      //
      if (cachedInstance && cachePolicy === 'cache-first') {
        //
        // model
        //   .findOne(queryOptions)
        //   .then(row => {
        //     connection.redis.set(cacheKey, stringify(row), 'PX', cachePeriod);
        //   })
        //   .catch(logger.error);
        //
        return cachedInstance;
      }
      //
      const p = queryBuilder(connection, modelName, opts);
      //
      const row = await model.findOne(p);
      if (!row) {
        if (throwErrorIfNotFound) {
          throw new DefaultError(`${model.name} couldn't be found in database`, { status: 404 });
        }
        return null;
      }
      //
      if (cachePolicy !== 'no-cache') {
        connection.redis.set(cacheKey, stringify(row), 'PX', cachePeriod);
      }
      //
      const limitedFields = Array.isArray(p.attributes) && p.attributes.length > 0;
      if (!raw && !limitedFields && dataloaderContext) {
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(row);
      }
      //
      return row;
    },
    //
    async dbInstanceById(modelName, id, opts) {
      const { cachePeriod = 30000, throwErrorIfNotFound = true, resolveInfo, context } = opts || {};
      if (!id) {
        if (throwErrorIfNotFound) {
          throw new DefaultError(`${modelName} with ID: ${id} couldn't be found in database`, {
            status: 404,
          });
        }
        return null;
      }
      const cachePolicy =
        opts?.cacheKey && connection.redis && !resolveInfo
          ? get(opts, 'cachePolicy', 'cache-first')
          : 'no-cache';
      //
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const model = connection.models[modelName];
      //
      const cacheKey = `${modelName}_findByPk_${id}`;
      let cachedInstance;
      if (cachePolicy !== 'no-cache') {
        try {
          //
          const cached = await connection.redis.getAsync(cacheKey);
          cachedInstance = cached ? model.build(parse(cached)) : null;
          //
          if (cachedInstance) {
            shimCachedInstance(cachedInstance);
          }
          //
          if (cachePolicy === 'cache-only') {
            return cachedInstance;
          }
        } catch (err) {
          cachedInstance = null;
          logger.error(err);
        }
      }
      //
      if (cachedInstance && cachePolicy === 'cache-first') {
        // model
        //   .findByPk(id, queryOptions)
        //   .then(row => {
        //     connection.redis.set(cacheKey, stringify(row), 'PX', cachePeriod);
        //   })
        //   .catch(logger.error);
        //
        return cachedInstance;
      }

      //
      const p = queryBuilder(connection, modelName, opts);
      const row = await model.findByPk(id, p);
      if (!row) {
        if (throwErrorIfNotFound) {
          throw new DefaultError(`${model.name} with ID: ${id} couldn't be found in database`, {
            status: 404,
          });
        }
        return null;
      }
      //
      if (cachePolicy !== 'no-cache') {
        connection.redis.set(cacheKey, stringify(row), 'PX', cachePeriod);
      }
      if (dataloaderContext && dataloaderContext[EXPECTED_OPTIONS_KEY]) {
        //
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(row);
      }
      //
      return row;
    },
    getListQueryOptions(props, defaults = {}) {
      //
      const pagination = get(props, 'pagination', get(defaults, 'pagination'));
      const limit = get(pagination, 'limit') || get(defaults, 'pagination.limit') || 150;
      const offset = get(pagination, 'offset') || get(defaults, 'pagination.offset') || 0;
      //
      const sort = get(props, 'sort', get(defaults, 'sort'));
      const fields: string[] = get(sort, 'fields', ['createdAt']);
      const direction = get(sort, 'direction', 'DESC');

      return {
        limit: limit > 150 ? 150 : limit,
        offset,
        order: fields.map((field) => [field, direction]),
      };
    },
  };

  if (sync) {
    // Run db-sync only on the first node in pm2's cluster
    if (
      typeof process.env.NODE_APP_INSTANCE === 'undefined' ||
      process.env.NODE_APP_INSTANCE === '0'
    ) {
      // Sync Sequelize models with Database
      await runMigrations(connection, 'up');
      //
      logger.info('Database migrations completed successfully');

      //
      await connection.sync();
    }
  }

  return connection;
}

export * from './helpers';
