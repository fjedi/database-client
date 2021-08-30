import { get, uniq, flatten, capitalize } from 'lodash';
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
  ModelCtor,
  Order,
  Association,
} from 'sequelize';
// @ts-ignore
import { createContext, EXPECTED_OPTIONS_KEY } from 'dataloader-sequelize';
import getQueryFields from 'graphql-list-fields';
import { stringify, parse } from 'json-buffer';
import shimmer from 'shimmer';
import { logger as rootLogger } from '@fjedi/logger';
import { redis, RedisClient } from '@fjedi/redis-client';
import { DefaultError } from '@fjedi/errors';
//
import runMigrations from './migrate';
//
import { getModelName, getTableName, filterByField, afterCommitHook } from './helpers';

export {
  Sequelize,
  Op,
  col,
  fn,
  literal,
  where,
  Transaction,
  QueryOptions,
  WhereOptions,
  IncludeOptions,
  Dialect,
  QueryTypes,
  Options,
  Optional,
  DataTypes,
  Model,
  ModelCtor,
  Order,
  //
  BelongsToGetAssociationMixin,
  BelongsToSetAssociationMixin,
  BelongsToSetAssociationMixinOptions,
  BelongsToCreateAssociationMixin,
  BelongsToCreateAssociationMixinOptions,
  HasOneCreateAssociationMixin,
  HasOneGetAssociationMixin,
  HasManyCreateAssociationMixin,
  HasManyCountAssociationsMixin,
  HasManyGetAssociationsMixin,
  BelongsToManySetAssociationsMixin,
  BelongsToManySetAssociationsMixinOptions,
  BelongsToManyAddAssociationMixin,
  BelongsToManyRemoveAssociationMixin,
  BelongsToManyAddAssociationMixinOptions,
  BelongsToManyRemoveAssociationMixinOptions,
  BelongsToManyCountAssociationsMixin,
  BelongsToManyCountAssociationsMixinOptions,
  //
  ValidationError,
  OptimisticLockError,
  DatabaseError,
  UniqueConstraintError,
} from 'sequelize';

export * from './helpers';

// export interface ModelInstance<T> extends Model {
//   publicFields: Set<string>;
//   privateFields: Set<string>;
//   associate: (models: DatabaseModels) => void;
//   new (values?: unknown, options?: BuildOptions): T;
// }

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

export type InitDatabaseOptions<TModels> = {
  models: TModels;
  migrationsPath?: string;
  sync?: boolean;
  tableNamePrefix?: string;
  maxRowsPerQuery?: number;
};

export type DatabaseTransaction = Transaction;
export type DatabaseTransactionProps = {
  transaction?: DatabaseTransaction;
  isolationLevel?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
  autocommit?: boolean;
};

export type SortDirection = 'ASC' | 'DESC';
export type DatabaseWhere = WhereOptions;
export type DatabaseInclude = IncludeOptions;
export type DatabaseModels = {
  [k: string]: ModelCtor<Model>;
};

export interface DatabaseQueryOptions extends QueryOptions {
  transaction?: DatabaseTransaction;
  attributes?: string[];
  where?: WhereOptions;
  include?: IncludeOptions[];
  raw?: boolean;
  paranoid?: boolean;
  context?: unknown;
  limit?: number;
  offset?: number;
  order?: Order;
}
export interface DatabaseTreeQueryOptions extends DatabaseQueryOptions {
  cachePolicy?: 'no-cache' | 'cache-first' | 'cache-only';
  cachePeriod?: number;
  cacheKey?: string;
  throwErrorIfNotFound?: boolean;
  resolveInfo?: any;
  relationKeysMap?: Map<string, string>;
}

export type GetQueryTreeParams<TModels extends DatabaseModels> = {
  fields?: string[];
  databaseModel: TModels[keyof TModels];
  includes?: IncludeOptions[];
  relationKeysMap?: Map<string, string>;
};

///
/// HOOKS
///
type DatabaseHookModelFields = {
  [key: string]: any;
};

export type DatabaseHookModel = Model & {
  changedFields: string[];
  oldValues: DatabaseHookModelFields;
  newValues: DatabaseHookModelFields;
  [field: string]: any;
};

export type DatabaseHookOptions = {
  beforeCommit?: (instance: DatabaseHookModel, options: DatabaseQueryOptions) => Promise<void>;
  afterCommit?: (instance: DatabaseHookModel, options: DatabaseQueryOptions) => Promise<void>;
};

export type DatabaseHookEvents =
  | 'beforeValidate'
  | 'afterValidate'
  | 'beforeCreate'
  | 'afterCreate'
  | 'beforeDestroy'
  | 'afterDestroy'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeSave'
  | 'afterSave'
  | 'beforeBulkCreate'
  | 'afterBulkCreate'
  | 'beforeBulkDestroy'
  | 'afterBulkDestroy'
  | 'beforeBulkUpdate'
  | 'afterBulkUpdate'
  | 'beforeFind'
  | 'beforeCount'
  | 'beforeFindAfterExpandIncludeAll'
  | 'beforeFindAfterOptions'
  | 'afterFind'
  | 'beforeSync'
  | 'afterSync'
  | 'beforeBulkSync'
  | 'afterBulkSync'
  | 'beforeDefine'
  | 'afterDefine'
  | 'beforeInit'
  | 'afterInit'
  | 'beforeConnect'
  | 'afterConnect'
  | 'beforeDisconnect'
  | 'afterDisconnect';

//
export type DatabaseHelpers<TModels extends DatabaseModels> = {
  wrapInTransaction: (
    action: (tx: DatabaseTransaction) => Promise<any>,
    opts?: DatabaseTransactionProps,
  ) => Promise<any>;
  initModelHook: (
    modelName: keyof TModels,
    event: DatabaseHookEvents,
    options: DatabaseHookOptions,
  ) => void;
  afterCommitHook: typeof afterCommitHook;
  getListQueryOptions(query: any, defaults?: any): PaginationOptions;
  getModelName: typeof getModelName;
  getTableName: typeof getTableName;
  filterByField: typeof filterByField;
  getQueryTree: (
    p: GetQueryTreeParams<TModels> & {
      query: 'findAndCountAll' | 'findAll' | 'findOne' | 'dbInstanceById';
    },
  ) => any;
  createDatabaseContext: (p: any) => any;
  findAndCountAll: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    o?: DatabaseTreeQueryOptions,
  ) => Promise<DatabaseListWithPagination<TModels, TModelName>>;
  findAll: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    o?: DatabaseTreeQueryOptions,
  ) => Promise<DatabaseList<TModels, TModelName>>;
  findOne: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    o?: DatabaseTreeQueryOptions,
  ) => Promise<TModels[TModelName] | null>;
  findOrCreate: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    where: DatabaseWhere,
    defaults: { [k: string]: any },
    opts?: DatabaseTreeQueryOptions,
  ) => Promise<[TModels[TModelName], boolean]>;
  dbInstanceById: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    id: unknown,
    opts?: DatabaseTreeQueryOptions,
  ) => Promise<TModels[TModelName] | null>;
};

type PaginationOptions = { [k: string]: any };

export type DatabaseConnection<TModels extends DatabaseModels> = Sequelize & {
  fieldValue: typeof Op;
  QueryTypes?: QueryTypes;
  fn: (functionName: string, columnName: string, args?: string) => string;
  col: (v: string) => string;
  literal: (v: string) => string;
  models: TModels;
  helpers: DatabaseHelpers<TModels>;
  redis: RedisClient;
};

export type DatabaseList<
  TModels extends DatabaseModels,
  TModelName extends keyof TModels,
> = TModels[TModelName][];

export type DatabaseListWithPagination<
  TModels extends DatabaseModels,
  TModelName extends keyof TModels,
> = {
  rows: DatabaseList<TModels, TModelName>;
  count: number;
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

function queryBuilder<TModels extends DatabaseModels>(
  connection: DatabaseConnection<TModels>,
  modelName: keyof TModels,
  opts: DatabaseTreeQueryOptions & {
    query: 'findAndCountAll' | 'findAll' | 'findOne' | 'dbInstanceById';
  },
) {
  const {
    context,
    cachePeriod = 30000,
    throwErrorIfNotFound = true,
    resolveInfo,
    relationKeysMap,
    attributes = [],
    query,
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
      query,
      fields,
      databaseModel: model,
      includes: bypassParams.include,
      relationKeysMap,
    });
    // @ts-ignore
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

export function createConnection(options: DatabaseConnectionOptions): Sequelize {
  const {
    engine = 'mysql',
    host = '127.0.0.1',
    port = 3306,
    name,
    user,
    password,
    timezone = '+00:00',
    logging,
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
  const connection = new Sequelize(name, user, password, dbOptions);
  // @ts-ignore
  connection.fieldValue = Op;

  return connection as Sequelize;
}

export async function initDatabase<TModels extends DatabaseModels>(
  c: Sequelize,
  options: InitDatabaseOptions<TModels>,
): Promise<DatabaseConnection<TModels>> {
  const { sync, migrationsPath, models, tableNamePrefix, maxRowsPerQuery = 500 } = options || {};

  //
  const connection = c as DatabaseConnection<TModels>;
  if (!models) {
    throw new Error('Invalid "models" passed to "initDatabase" function');
  }
  //
  Object.keys(models).forEach((modelName: string) => {
    // @ts-ignore
    if (models[modelName].initModel) {
      // @ts-ignore
      models[modelName].initModel(connection, getTableName(modelName, tableNamePrefix));
    }
  });
  Object.keys(models).forEach((modelName: string) => {
    // @ts-ignore
    if (models[modelName].associate) {
      // @ts-ignore
      models[modelName].associate(models);
    }
  });
  // @ts-ignore
  connection.models = models;

  // Checking DB connection
  await connection.authenticate();

  logger.info('DB Connection has been established successfully');
  //
  connection.helpers = {
    //
    getModelName,
    getTableName,
    filterByField,
    //
    getQueryTree(
      params: GetQueryTreeParams<TModels> & {
        query: 'findAndCountAll' | 'findAll' | 'findOne' | 'dbInstanceById';
      },
    ) {
      const { query, fields, databaseModel, includes = [], relationKeysMap } = params;
      (fields || []).forEach((i) => {
        const field = i.split('.');
        // Skip "rows" field
        const associationField = field[0] === 'rows' ? field[1] : field[0];
        const as = (relationKeysMap && relationKeysMap.get(associationField)) || associationField;
        const association = get(databaseModel, `associations[${as}]`);
        //
        if (association) {
          //
          const { target: model, associationType } = association as Association;

          // Disable recursive db-query as model.findAndCountAll works improperly with pagination
          const disabledNestedInclude =
            query === 'findAndCountAll' &&
            (associationType === 'HasMany' || associationType === 'BelongsToMany');

          if (!disabledNestedInclude && !includes.some((include) => include.as === as)) {
            includes.push({
              paranoid: false,
              model,
              as,
              include: connection.helpers.getQueryTree({
                query,
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
    //
    afterCommitHook,
    //
    initModelHook(
      modelName: keyof TModels,
      event: DatabaseHookEvents,
      o: DatabaseHookOptions,
    ): void {
      const { beforeCommit, afterCommit } = o;
      //
      const model = models[modelName];
      //
      model.addHook(
        event,
        `${modelName}${capitalize(event)}`,
        async (instance: DatabaseHookModel, queryProps: any) => {
          if (typeof afterCommit === 'function' && instance.constructor.name !== modelName) {
            const w = `Constructor's name (${instance.constructor.name}) differs from "modelName" value (${modelName})`;
            logger.warn(w);
            //
            afterCommit(instance, queryProps);
            return;
          }
          const { transaction } = queryProps || {};
          if (!event.includes('Bulk') && !event.includes('Create') && !event.includes('Destroy')) {
            //
            if (!instance.isNewRecord) {
              //
              const {
                _changed: changedFields,
                _previousDataValues: prevValues,
                dataValues,
              } = instance;
              // const noChanges = Object.keys(changedFields).every((field) => !changedFields[field]);
              const noChanges = changedFields.size === 0;
              if (noChanges && dataValues.deletedAt === null) {
                logger.warn('Emit db-hook event without any changes', {
                  dataValues,
                  changedFields,
                });
                return;
              }
              // eslint-disable-next-line no-param-reassign
              instance.changedFields = instance.changed() || [];
              // eslint-disable-next-line no-param-reassign
              instance.oldValues = { ...prevValues };
              // eslint-disable-next-line no-param-reassign
              instance.newValues = { ...dataValues };
            }
          }
          if (event.includes('Destroy') || event.includes('Update')) {
            // Remove instance from cache
            // @ts-ignore
            await redis.delAsync(`${modelName}_findByPk_${instance.id}`);
          }

          //
          if (typeof beforeCommit === 'function') {
            await beforeCommit(instance, queryProps);
          }
          //
          if (typeof afterCommit === 'function') {
            afterCommitHook(transaction, () => afterCommit(instance, queryProps));
          }
        },
      );
    },
    //
    async wrapInTransaction(
      action: (transaction: Transaction) => Promise<any>,
      opts?: DatabaseTransactionProps,
    ): Promise<void> {
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
    async findOrCreate<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      where: DatabaseWhere,
      defaults: { [k: string]: any },
      opts?: DatabaseQueryOptions,
    ) {
      //
      const model = models[modelName];
      const exist = (await model.findOne({
        where,
        ...opts,
      })) as TModels[TModelName] | null;
      if (exist) {
        return [exist, false];
      }
      // @ts-ignore
      const res = (await model.create(defaults, opts)) as TModels[TModelName];
      return [res, true];
    },
    //
    async findAndCountAll<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      opts?: DatabaseTreeQueryOptions,
    ) {
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
      const model = models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const cacheKey = `${modelName}_findAndCountAll_${stringify(queryOptions)}`;
      let cachedInstance: DatabaseListWithPagination<TModels, TModelName> | null = null;
      if (cachePolicy !== 'no-cache') {
        try {
          //
          const cached = await redis.getAsync(cacheKey);
          //
          if (cached) {
            const { rows, count } = parse(cached);
            // @ts-ignore
            cachedInstance = {
              count,
              rows: await mapPromise(rows, (r: any) => model.build(r)),
            } as DatabaseListWithPagination<TModels, TModelName>;
          } else {
            cachedInstance = null;
          }
          if (cachePolicy === 'cache-only') {
            return cachedInstance || { rows: [], count: 0 };
          }
        } catch (err) {
          cachedInstance = null;
          logger.error(err as Error);
        }
      }
      //
      const p = queryBuilder(connection, modelName, { ...opts, query: 'findAndCountAll' });
      // if (cachedInstance && cachePolicy === 'cache-first') {
      //   model
      //     .findAndCountAll(p)
      //     .then(res => {
      //       redis.set(cacheKey, stringify(res), 'PX', cachePeriod);
      //     })
      //     .catch(logger.error);
      // }

      const res = cachedInstance || (await model.findAndCountAll(p));
      //
      const limitedFields = Array.isArray(p.attributes) && p.attributes.length > 0;
      if (!raw && !limitedFields && dataloaderContext) {
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(res.rows);
      }
      //
      if (cachePolicy !== 'no-cache') {
        redis.set(cacheKey, stringify(res), 'PX', cachePeriod);
      }
      //
      return res as DatabaseListWithPagination<TModels, TModelName>;
    },
    //
    async findAll<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      opts?: DatabaseTreeQueryOptions,
    ) {
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
      const model = models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const cacheKey = `${modelName}_findAll_${stringify(queryOptions)}`;
      let cachedInstance: DatabaseList<TModels, TModelName> | null = null;
      if (cachePolicy !== 'no-cache') {
        try {
          //
          const cached = await redis.getAsync(cacheKey);
          //
          if (cached) {
            // @ts-ignore
            cachedInstance = (await mapPromise(parse(cached), (r: any) =>
              model.build(r),
            )) as DatabaseList<TModels, TModelName>;
          } else {
            cachedInstance = null;
          }
          if (cachePolicy === 'cache-only') {
            return cachedInstance || [];
          }
        } catch (err) {
          cachedInstance = null;
          logger.error(err as Error);
        }
      }
      //
      const p = queryBuilder(connection, modelName, { ...opts, query: 'findAll' });
      //
      // if (cachedInstance && cachePolicy === 'cache-first') {
      //   model
      //     .findAll(p)
      //     .then(res => {
      //       redis.set(cacheKey, stringify(res), 'PX', cachePeriod);
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
        redis.set(cacheKey, stringify(rows), 'PX', cachePeriod);
      }
      //
      return rows as DatabaseList<TModels, TModelName>;
    },
    async findOne<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      opts?: DatabaseTreeQueryOptions,
    ) {
      const {
        cachePeriod = 30000,
        throwErrorIfNotFound = true,
        context,
        resolveInfo,
        raw,
      } = opts || {};
      const cachePolicy =
        opts?.cacheKey && redis && !resolveInfo
          ? get(opts, 'cachePolicy', 'cache-first')
          : 'no-cache';
      //
      const model = models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const cacheKey = `${modelName}_findOne_${opts?.cacheKey}`;
      let cachedInstance: TModels[TModelName] | null = null;
      if (cachePolicy !== 'no-cache') {
        try {
          //
          const cached = await redis.getAsync(cacheKey);
          // @ts-ignore
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
          logger.error(err as Error);
        }
      }
      //
      if (cachedInstance && cachePolicy === 'cache-first') {
        //
        // model
        //   .findOne(queryOptions)
        //   .then(row => {
        //     redis.set(cacheKey, stringify(row), 'PX', cachePeriod);
        //   })
        //   .catch(logger.error);
        //
        return cachedInstance;
      }
      //
      const p = queryBuilder(connection, modelName, { ...opts, query: 'findOne' });
      // @ts-ignore
      const row = (await model.findOne(p)) as TModels[TModelName];
      if (!row) {
        if (throwErrorIfNotFound) {
          throw new DefaultError(`${model.name} couldn't be found in database`, { status: 404 });
        }
        return null;
      }
      //
      if (cachePolicy !== 'no-cache') {
        redis.set(cacheKey, stringify(row), 'PX', cachePeriod);
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
    async dbInstanceById<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      id: unknown,
      opts?: DatabaseTreeQueryOptions,
    ) {
      const { cachePeriod = 30000, throwErrorIfNotFound = true, resolveInfo, context } = opts || {};
      if (!id) {
        if (throwErrorIfNotFound) {
          throw new DefaultError(`${modelName} with ID: "${id}" couldn't be found in database`, {
            status: 404,
          });
        }
        return null;
      }
      const cachePolicy =
        opts?.cacheKey && redis && !resolveInfo
          ? get(opts, 'cachePolicy', 'cache-first')
          : 'no-cache';
      //
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const model = models[modelName];
      //
      const cacheKey = `${modelName}_findByPk_${id}`;
      let cachedInstance: TModels[TModelName] | null = null;
      if (cachePolicy !== 'no-cache') {
        try {
          //
          const cached = await redis.getAsync(cacheKey);
          // @ts-ignore
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
          logger.error(err as Error);
        }
      }
      //
      if (cachedInstance && cachePolicy === 'cache-first') {
        // model
        //   .findByPk(id, queryOptions)
        //   .then(row => {
        //     redis.set(cacheKey, stringify(row), 'PX', cachePeriod);
        //   })
        //   .catch(logger.error);
        //
        return cachedInstance;
      }

      //
      const p = queryBuilder(connection, modelName, { ...opts, query: 'dbInstanceById' });
      // @ts-ignore
      const row = (await model.findByPk(id, p)) as TModels[TModelName];
      if (!row) {
        if (throwErrorIfNotFound) {
          throw new DefaultError(`${model.name} with ID: "${id}" couldn't be found in database`, {
            status: 404,
          });
        }
        return null;
      }
      //
      if (cachePolicy !== 'no-cache') {
        redis.set(cacheKey, stringify(row), 'PX', cachePeriod);
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
        limit: limit > maxRowsPerQuery ? maxRowsPerQuery : limit,
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
      if (migrationsPath) {
        await runMigrations(connection, 'up', migrationsPath);
      }
      //
      logger.info('Database migrations completed successfully');

      //
      await connection.sync();
    }
  }

  // @ts-ignore
  return connection;
}
