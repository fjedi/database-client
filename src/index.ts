import { get, uniq, flatten, capitalize, pick } from 'lodash';
import {
  Sequelize,
  Op,
  Transaction,
  ProjectionAlias,
  WhereOptions,
  where as whereFn,
  Dialect,
  QueryTypes,
  Options,
  DataTypes,
  Model,
  ModelStatic,
  Association,
  fn,
  col,
  literal,
  and,
  cast,
  or,
  json,
  IncludeOptions,
  FindOptions,
  Attributes,
} from 'sequelize';
import { MakeNullishOptional } from 'sequelize/types/utils';
// @ts-ignore
import { createContext, EXPECTED_OPTIONS_KEY } from 'dataloader-sequelize';
import getQueryFields from 'graphql-list-fields';
import type { GraphQLResolveInfo } from 'graphql';
import { RedisClient } from '@fjedi/redis-client';
import { DefaultError } from '@fjedi/errors';
import runMigrations from './migrate';
import { getModelName, getTableName, filterByField, logger } from './helpers';

export type {
  Transaction,
  QueryOptions,
  WhereOptions,
  WhereAttributeHash,
  WhereOperators,
  IncludeOptions,
  Dialect,
  QueryTypes,
  Options,
  Optional,
  Order,
  OrderItem,
  FindOptions,
  OrOperator,
  AndOperator,
  FindAndCountOptions,
  FindOrCreateOptions,
  CreateOptions,
  BulkCreateOptions,
  UpdateOptions,
  UpsertOptions,
  DestroyOptions,
  IncrementDecrementOptions,
  ModelAttributes,
  ModelOptions,
  ModelStatic,
  Attributes,
} from 'sequelize';

export {
  Sequelize,
  Op,
  col,
  fn,
  literal,
  where,
  DataTypes,
  Model,
  //
  BelongsToGetAssociationMixin,
  BelongsToSetAssociationMixin,
  BelongsToSetAssociationMixinOptions,
  BelongsToCreateAssociationMixin,
  BelongsToCreateAssociationMixinOptions,
  HasOneCreateAssociationMixin,
  HasOneGetAssociationMixin,
  HasOneSetAssociationMixin,
  HasOneSetAssociationMixinOptions,
  HasManyCreateAssociationMixin,
  HasManyCountAssociationsMixin,
  HasManyGetAssociationsMixin,
  HasManyRemoveAssociationMixin,
  HasManyRemoveAssociationMixinOptions,
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

export type DatabaseConnectionOptions = {
  engine?: Dialect;
  storage?: 'mysql' | 'postgres';
  host?: string;
  port?: number;
  name: string;
  user: string;
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

export type InitDatabaseOptions<TModels extends DatabaseModels> = {
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
  [k: string]: ModelStatic<Model> & {
    initModel: (db: Sequelize, tableName: string) => ModelStatic<Model>;
    associate: () => ModelStatic<Model>;
  };
};
export interface DatabaseQueryOptions<T extends Attributes<Model> = Attributes<Model>>
  extends FindOptions<T> {
  where?: WhereOptions<T>; // -> A hash with conditions (e.g. {name: 'foo'}) OR an ID as integer
  include?: IncludeOptions[];
  paranoid?: boolean;
  raw?: boolean;
  context?: unknown;
  attributes?: (string | ProjectionAlias)[];
}
export interface DatabaseTreeQueryOptions<T extends Attributes<Model> = Attributes<Model>>
  extends DatabaseQueryOptions<T> {
  resolveInfo?: GraphQLResolveInfo;
  relationKeysMap?: Map<string, string>;
}

export type GetQueryTreeParams<TModels extends DatabaseModels> = {
  fields?: string[];
  databaseModel: TModels[keyof TModels];
  includes?: IncludeOptions[];
  relationKeysMap?: Map<string, string>;
};

export type ListQueryOptions = {
  limit: number;
  offset: number;
  order: [string, SortDirection][];
};

export type PaginationOptions = Pick<ListQueryOptions, 'limit' | 'offset'>;

export type SortOptions = {
  direction: SortDirection;
  fields: string[];
};

///
/// HOOKS
///
type DatabaseHookModelFields = {
  [key: string]: unknown;
};

export type DatabaseHookModel<T extends Model = Model> = T & {
  changedFields: string[];
  oldValues: DatabaseHookModelFields;
  newValues: DatabaseHookModelFields;
  _changed: Set<string>;
  _previousDataValues: Record<string, unknown>;
  dataValues: Record<string, unknown>;
};

export type DatabaseHookOptions<T extends Model = Model> = {
  beforeCommit?: (
    instance: DatabaseHookModel<T>,
    options: DatabaseQueryOptions<Attributes<T>> & { transaction: DatabaseTransaction },
  ) => Promise<void>;
  afterCommit?: (
    instance: DatabaseHookModel<T>,
    options: Omit<DatabaseQueryOptions<Attributes<T>>, 'transaction'>,
  ) => Promise<void>;
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

export type DatabaseRowID = string | number;

//
export type DatabaseHelpers<TModels extends DatabaseModels> = {
  wrapInTransaction: (
    action: (tx: DatabaseTransaction) => Promise<unknown>,
    opts?: DatabaseTransactionProps,
  ) => Promise<unknown>;
  initModelHook: (
    modelName: keyof TModels,
    event: DatabaseHookEvents,
    options: DatabaseHookOptions,
  ) => void;
  getListQueryOptions(
    options: {
      pagination?: Partial<PaginationOptions>;
      sort?: Partial<SortOptions>;
    },
    defaults?: {
      pagination?: Partial<PaginationOptions>;
      sort?: Partial<SortOptions>;
    },
  ): ListQueryOptions;
  getListWithPageInfo<TModelName extends keyof TModels>(
    list: DatabaseListWithCounter<TModels, TModelName> | null,
    pagination: Pick<Partial<ListQueryOptions>, 'limit' | 'offset'>,
  ): DatabaseListWithPagination<TModels, TModelName>;
  getModelName: typeof getModelName;
  getTableName: typeof getTableName;
  filterByField: typeof filterByField;
  getQueryTree: (
    p: GetQueryTreeParams<TModels> & {
      query: 'findAndCountAll' | 'findAll' | 'findOne' | 'dbInstanceById';
    },
  ) => IncludeOptions[];
  createDatabaseContext: (p: unknown) => unknown;
  findAndCountAll: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    o: DatabaseTreeQueryOptions<TModels[TModelName]>,
  ) => Promise<DatabaseListWithPagination<TModels, TModelName>>;
  findAll: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    o: DatabaseTreeQueryOptions<TModels[TModelName]>,
  ) => Promise<DatabaseList<TModels, TModelName>>;
  findOne: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    o: DatabaseTreeQueryOptions<TModels[TModelName]> & { rejectOnEmpty?: boolean },
  ) => Promise<Model<TModels[TModelName]> | null>;
  findOrCreate: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    where: DatabaseWhere,
    defaults: MakeNullishOptional<TModels[TModelName]>,
    opts?: DatabaseTreeQueryOptions<TModels[TModelName]>,
  ) => Promise<[Model<TModels[TModelName]>, boolean]>;
  dbInstanceById: <TModelName extends keyof TModels>(
    modelName: keyof TModels,
    id: DatabaseRowID | null | undefined,
    opts?: DatabaseTreeQueryOptions<TModels[TModelName]> & { rejectOnEmpty?: boolean },
  ) => Promise<Model<TModels[TModelName]> | null>;
};

export type DatabaseConnection<TModels extends DatabaseModels> = Sequelize & {
  fieldValue: typeof Op;
  QueryTypes?: QueryTypes;
  fn: typeof fn;
  col: typeof col;
  literal: typeof literal;
  where: typeof whereFn;
  and: typeof and;
  cast: typeof cast;
  or: typeof or;
  json: typeof json;
  models: TModels;
  helpers: DatabaseHelpers<TModels>;
  redis?: RedisClient;
};

export type DatabaseList<TModels extends DatabaseModels, TModelName extends keyof TModels> = Model<
  TModels[TModelName]
>[];

export type DatabaseListPageInfo = {
  current: number;
  total: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type DatabaseListWithCounter<
  TModels extends DatabaseModels,
  TModelName extends keyof TModels,
> = {
  rows: DatabaseList<TModels, TModelName>;
  count: number;
};
export type DatabaseListWithPagination<
  TModels extends DatabaseModels,
  TModelName extends keyof TModels,
> = DatabaseListWithCounter<TModels, TModelName> & {
  pageInfo: DatabaseListPageInfo;
};

export function databaseQueryLogger(query: string, params: unknown): void {
  const {
    type,
    bind,
    limit,
    offset,
    hooks,
    rejectOnEmpty,
    attributes,
    originalAttributes,
    where,
    order,
    raw,
    plain,
  } = params as DatabaseQueryOptions & {
    model?: Model;
    hooks?: boolean;
    tableNames?: string[];
    rejectOnEmpty?: boolean;
    originalAttributes?: DatabaseQueryOptions['attributes'];
  };
  return logger.info(query, {
    type,
    bind,
    limit,
    offset,
    hooks,
    rejectOnEmpty,
    attributes,
    originalAttributes,
    where,
    order,
    raw,
    plain,
  });
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
    resolveInfo,
    relationKeysMap,
    attributes = [],
    query,
    ...bypassParams
  } = opts || {};
  //
  const model = connection.models[modelName];
  const dataloaderContext = get(context, 'state.dataloaderContext', {});

  const queryParams: DatabaseQueryOptions = {
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
    // @ts-ignore
    const tableAttributes = model.tableAttributes as Record<
      string,
      { references?: { model: string; key: string } }
    >;
    const indexFields: string[] = flatten(indexes.map((i) => i.fields));
    const foreignKeys: string[] = Object.keys(tableAttributes).filter(
      (field) => tableAttributes[field].references,
    );

    attributes.push(
      ...model.primaryKeyAttributes,
      ...foreignKeys,
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
      queryParams.order.forEach((o) => {
        // usually `o` structure looks like [field, direction]
        // but if we want to sort by associated field, `o` has 3 elements
        // and its structure looks like [association, field, direction]
        // and in this case we shouldn't add it to queryParams, because it's not trivial
        if (Array.isArray(o) && o.length < 3) {
          const [field] = o;
          if (typeof field === 'string' && Array.isArray(queryParams.attributes)) {
            queryParams.attributes.push(field);
          }
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
  if (!name) {
    throw new Error("'name' is a required param to init database connection");
  }
  if (!user) {
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

  return connection;
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
    models[modelName].initModel(c, getTableName(modelName, tableNamePrefix));
  });
  Object.keys(models).forEach((modelName: string) => {
    if (typeof models[modelName].associate === 'function') {
      models[modelName].associate();
    }
  });

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
          const { target: model, associationType } = association as unknown as Association;

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
        `${String(modelName)}${capitalize(event)}`,
        async (
          instance: DatabaseHookModel<Model<typeof model>>,
          queryProps: DatabaseQueryOptions<Model<typeof model>>,
        ): Promise<void> => {
          if (typeof afterCommit === 'function' && instance.constructor.name !== modelName) {
            const w = `Constructor's name (${
              instance.constructor.name
            }) differs from "modelName" value (${String(modelName)})`;
            logger.warn(w);
            //
            await afterCommit(instance, queryProps);
            return;
          }
          const { transaction } = queryProps || {};
          if (!event.includes('Bulk') && !event.includes('Create') && !event.includes('Destroy')) {
            //
            if (!instance.isNewRecord) {
              const {
                _changed: changedFields,
                _previousDataValues: prevValues,
                dataValues,
              } = instance;
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
          if (transaction && typeof beforeCommit === 'function') {
            await beforeCommit(instance, { ...queryProps, transaction });
          }
          if (transaction && typeof afterCommit === 'function') {
            await transaction.afterCommit(() => afterCommit(instance, queryProps));
          }
        },
      );
    },
    //
    async wrapInTransaction<T = void>(
      action: (transaction: Transaction) => Promise<T>,
      opts?: DatabaseTransactionProps,
    ): Promise<T> {
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
      defaults: MakeNullishOptional<TModels[TModelName]>,
      opts?: DatabaseQueryOptions,
    ) {
      const model = models[modelName];
      const exist = await model.findOne<Model<TModels[TModelName]>>({
        where,
        ...opts,
      });
      if (exist) {
        return [exist, false];
      }
      const res = await model.create<Model<TModels[TModelName]>>(defaults, opts);
      return [res, true];
    },
    //
    getListWithPageInfo<TModelName extends keyof TModels>(
      list: DatabaseListWithPagination<TModels, TModelName> | null,
      pagination?: Pick<Partial<ListQueryOptions>, 'limit' | 'offset'>,
    ): DatabaseListWithPagination<TModels, TModelName> & { pageInfo: DatabaseListPageInfo } {
      const { rows, count } = list ?? { rows: [], count: 0 };
      const { limit, offset } = connection.helpers.getListQueryOptions({ pagination });
      const currentPage = offset / limit + 1;
      const totalPages = Math.ceil(count / limit);
      const hasNextPage = currentPage < totalPages;
      const hasPreviousPage = currentPage > 1;
      return {
        rows,
        count,
        pageInfo: { current: currentPage, total: totalPages, hasPreviousPage, hasNextPage },
      };
    },
    //
    async findAndCountAll<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      opts?: DatabaseTreeQueryOptions<TModels[TModelName]>,
    ): Promise<DatabaseListWithPagination<TModels, TModelName>> {
      //
      const { context, resolveInfo, raw, relationKeysMap, ...queryOptions } = opts || {};
      //
      const model = models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const pagination = pick(queryOptions, ['limit', 'offset']);
      //
      const p = queryBuilder(connection, modelName, { ...opts, query: 'findAndCountAll' });

      const res = (await model.findAndCountAll(p)) as DatabaseListWithCounter<TModels, TModelName>;
      //
      const limitedFields = Array.isArray(p.attributes) && p.attributes.length > 0;
      if (!raw && !limitedFields && dataloaderContext) {
        // @ts-ignore
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(res.rows);
      }
      //
      return connection.helpers.getListWithPageInfo(res, pagination);
    },
    //
    async findAll<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      opts?: DatabaseTreeQueryOptions<TModels[TModelName]>,
    ) {
      const { context, raw } = opts || {};
      //
      const model = models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const p = queryBuilder(connection, modelName, { ...opts, query: 'findAll' });
      const rows = (await model.findAll(p)) as DatabaseList<TModels, TModelName>;
      //
      const limitedFields = Array.isArray(p.attributes) && p.attributes.length > 0;
      if (!raw && !limitedFields && dataloaderContext) {
        // @ts-ignore
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(rows);
      }
      return rows;
    },
    async findOne<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      opts: DatabaseTreeQueryOptions<TModels[TModelName]> & { rejectOnEmpty?: boolean },
    ) {
      const { context, raw } = opts || {};
      //
      const model = models[modelName];
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      //
      const p = queryBuilder(connection, modelName, { ...opts, query: 'findOne' });
      const row = (await model.findOne(p)) as Model<TModels[TModelName]>;
      if (!row) {
        if (opts.rejectOnEmpty) {
          throw new DefaultError(`${model.name} couldn't be found in database`, { status: 404 });
        }
        return null;
      }
      //
      const limitedFields = Array.isArray(p.attributes) && p.attributes.length > 0;
      if (!raw && !limitedFields && dataloaderContext) {
        // @ts-ignore
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(row);
      }
      //
      return row;
    },
    async dbInstanceById<TModelName extends keyof TModels>(
      modelName: keyof TModels,
      id: DatabaseRowID | null | undefined,
      opts?: DatabaseTreeQueryOptions<TModels[TModelName]> & { rejectOnEmpty?: boolean },
    ) {
      const { rejectOnEmpty = true, context } = opts || {};
      if (!id) {
        if (rejectOnEmpty) {
          throw new DefaultError(
            `${String(modelName)} with ID: "${id}" couldn't be found in database`,
            {
              status: 404,
            },
          );
        }
        return null;
      }
      const dataloaderContext = get(context, 'state.dataloaderContext', {});
      const model = models[modelName];

      const p = queryBuilder(connection, modelName, { ...opts, query: 'dbInstanceById' });

      const row = (await model.findByPk(id, p)) as Model<TModels[TModelName]>;
      if (!row) {
        if (rejectOnEmpty) {
          throw new DefaultError(`${model.name} with ID: "${id}" couldn't be found in database`, {
            status: 404,
          });
        }
        return null;
      }
      // @ts-ignore
      if (dataloaderContext && dataloaderContext[EXPECTED_OPTIONS_KEY]) {
        // @ts-ignore
        dataloaderContext[EXPECTED_OPTIONS_KEY].prime(row);
      }
      //
      return row;
    },
    getListQueryOptions(props, defaults = {}): ListQueryOptions {
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
      logger.info('Database migrations completed successfully');

      await connection.sync();
    }
  }

  return connection;
}
