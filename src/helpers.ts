import { WhereOptions, Op, Transaction } from 'sequelize';
import snakeCase from 'lodash/snakeCase';
import camelCase from 'lodash/camelCase';
import upperFirst from 'lodash/upperFirst';
import compact from 'lodash/compact';
import { logger as rootLogger } from '@fjedi/logger';

//
export const logger = rootLogger.child({ module: 'DATABASE' });

// Custom Tables' names (if we need to override filename-based naming
const dbTables: { [k: string]: any } = {};
// Custom Models' names (if we need to override filename-based naming
const dbModels: { [k: string]: any } = {};

//
export function getModelName(key: string): string {
  return dbModels[key] || upperFirst(camelCase(key));
}

//
export function getTableName(key: string, prefix?: string): string {
  if (typeof dbTables[key] === 'string') {
    return dbTables[key];
  }
  return `${prefix || ''}${snakeCase(key)}`;
}

export type CompareType =
  | 'like'
  | 'iLike'
  | 'notLike'
  | 'notILike'
  | 'in'
  | 'notIn'
  | 'eq'
  | 'ne'
  | 'timeRange';

export type TimeRangeType = { from?: string | Date; to?: string | Date };

export type CompareValues =
  | string
  | string[]
  | number
  | number[]
  | Array<string | number>
  | TimeRangeType;

export function getCompareSymbol(
  compareType: CompareType,
  vals: CompareValues,
): (typeof Op)[keyof typeof Op] {
  let symbol: keyof typeof Op;
  //
  if (compareType === 'timeRange') {
    throw new Error('Invalid usage of "getCompareSymbol" helper');
  }
  //
  switch (compareType) {
    case 'in':
      symbol = !Array.isArray(vals) || vals.length === 1 ? 'eq' : compareType;
      break;
    case 'notIn':
      symbol = !Array.isArray(vals) || vals.length === 1 ? 'ne' : compareType;
      break;
    default:
      symbol = compareType;
  }

  return Op[symbol];
}

export function filterByField(
  where: WhereOptions,
  field: string,
  values: CompareValues,
  compareType: CompareType,
): void {
  //
  if (compareType === 'timeRange') {
    if (!values) {
      return;
    }
    const { from, to } = values as TimeRangeType;
    if (from && to) {
      // @ts-ignore
      // eslint-disable-next-line no-param-reassign
      where[field] = {
        [Op.between]: [from, to],
      };
    } else if (from) {
      // @ts-ignore
      // eslint-disable-next-line no-param-reassign
      where[field] = {
        [Op.gte]: from,
      };
    } else if (to) {
      // @ts-ignore
      // eslint-disable-next-line no-param-reassign
      where[field] = {
        [Op.lte]: to,
      };
    }
    return;
  }
  //
  if (
    values === null ||
    (typeof values === 'string' && values.length > 0) ||
    typeof values === 'number'
  ) {
    const compareSymbol = getCompareSymbol(compareType, values);
    // @ts-ignore
    // eslint-disable-next-line no-param-reassign
    where[field] = {
      [compareSymbol]: ['like', 'iLike', 'notLike', 'notILike'].includes(compareType)
        ? `%${values}%`
        : values,
    };
  } else if (Array.isArray(values) && compact(values).length > 0) {
    // @ts-ignore
    const vals = compact(values);
    if (vals.length > 0) {
      if (compareType === 'in' || compareType === 'notIn') {
        const v = Array.isArray(vals) && vals.length === 1 ? vals[0] : vals;
        const compareSymbol = getCompareSymbol(compareType, v);
        // @ts-ignore
        // eslint-disable-next-line no-param-reassign
        where[field] = {
          [compareSymbol]: v,
        };
      } else if (compareType === 'like' || compareType === 'iLike') {
        // @ts-ignore
        // eslint-disable-next-line no-param-reassign
        where[field] = {
          [Op.or]: vals.map((v) => ({
            [Op[compareType]]: `%${v}%`,
          })),
        };
      } else {
        // @ts-ignore
        // eslint-disable-next-line no-param-reassign
        where[field] = {
          [Op.or]: vals.map((v) => ({
            [Op[compareType]]: v,
          })),
        };
      }
    }
  }
}

// Used as an 'invisible' property on transaction objects,
// used to stored "after*" hook functions that should only run if the transaction actually commits successfully
const transHooks = Symbol('afterCommitHooks');
export function afterCommitHook(transaction: Transaction, hookFn: () => any): void {
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
}
