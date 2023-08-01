import { WhereOperators, Op, OrOperator, WhereAttributeHash } from 'sequelize';
import snakeCase from 'lodash/snakeCase';
import camelCase from 'lodash/camelCase';
import upperFirst from 'lodash/upperFirst';
import compact from 'lodash/compact';
import { logger as rootLogger } from '@fjedi/logger';
//
export const logger = rootLogger.child({ module: 'DATABASE' });

// Custom Tables' names (if we need to override filename-based naming
const dbTables: { [k: string]: string } = {};
// Custom Models' names (if we need to override filename-based naming
const dbModels: { [k: string]: string } = {};

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
  | 'numberRange'
  | 'timeRange';

export type TimeRangeType = { from?: string | Date; to?: string | Date };

export type NumberRangeType = { min?: number; max?: number };

export type CompareValues =
  | string
  | string[]
  | number
  | number[]
  | Array<string | number>
  | TimeRangeType
  | NumberRangeType
  | undefined
  | undefined[]
  | null[]
  | null;

export type FilterParams = {
  values: CompareValues;
  compareType: CompareType;
  arrayOperator?: 'AND' | 'OR';
};

export function getCompareSymbol(
  compareType: CompareType,
  vals: CompareValues,
): (typeof Op)[keyof typeof Op] {
  let symbol: keyof typeof Op;

  if (compareType === 'timeRange' || compareType === 'numberRange') {
    throw new Error('Invalid usage of "getCompareSymbol" helper');
  }

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

export function createFilter(params: FilterParams): WhereOperators | OrOperator {
  const { values, compareType } = params;
  if (compareType === 'timeRange' || compareType === 'numberRange') {
    throw new Error(`To filter by date- or number range, use "createRangeFilter" helper`);
  }
  if (
    values === null ||
    (typeof values === 'string' && values.length > 0) ||
    typeof values === 'number'
  ) {
    const compareSymbol = getCompareSymbol(compareType, values);
    return {
      [compareSymbol]: ['like', 'iLike', 'notLike', 'notILike'].includes(compareType)
        ? `%${values}%`
        : values,
    };
  } else if (Array.isArray(values) && compact(values).length > 0) {
    const vals = compact(values);
    if (vals.length > 0) {
      const arrayOperator = params?.arrayOperator || 'OR';
      const arrayOperatorSymbol = arrayOperator === 'OR' ? Op.or : Op.and;
      if (compareType === 'in' || compareType === 'notIn') {
        const v = Array.isArray(vals) && vals.length === 1 ? vals[0] : vals;
        const compareSymbol = getCompareSymbol(compareType, v);
        return {
          [compareSymbol]: v,
        };
      } else if (compareType === 'like' || compareType === 'iLike') {
        return {
          [arrayOperatorSymbol]: vals.map((v) => ({
            [Op[compareType]]: `%${v}%`,
          })),
        };
      } else {
        return {
          [arrayOperatorSymbol]: vals.map((v) => ({
            [Op[compareType]]: v,
          })),
        };
      }
    }
  }
  return {};
}

export type RangeFilterValue =
  | {
      min?: number;
      max?: number;
    }
  | {
      min?: TimeRangeType['from'];
      max?: TimeRangeType['to'];
    };

export function createRangeFilter(range: RangeFilterValue): WhereOperators {
  const { min, max } = range;
  if (typeof min !== 'undefined' && typeof max !== 'undefined') {
    return { [Op.between]: [min, max] };
  }
  if (typeof min !== 'undefined') {
    return { [Op.gte]: min };
  }
  if (typeof max !== 'undefined') {
    return { [Op.lte]: max };
  }
  return {};
}

export function filterByField(
  where: WhereAttributeHash,
  field: string,
  values: FilterParams['values'],
  compareType: FilterParams['compareType'],
  params: Omit<FilterParams, 'values' | 'compareType'>,
): void {
  if (compareType === 'numberRange') {
    if (!values) {
      return;
    }
    const { min, max } = values as NumberRangeType;
    where[field] = createRangeFilter({ min, max });
    return;
  }
  if (compareType === 'timeRange') {
    if (!values) {
      return;
    }
    const { from, to } = values as TimeRangeType;
    where[field] = createRangeFilter({ min: from, max: to });
    return;
  }
  where[field] = createFilter({
    ...params,
    values,
    compareType,
  });
}
