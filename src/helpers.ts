import { DataTypes, Sequelize, Model, WhereOptions, Op } from 'sequelize';
import snakeCase from 'lodash/snakeCase';
import camelCase from 'lodash/camelCase';
import upperFirst from 'lodash/upperFirst';
import compact from 'lodash/compact';

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

type Models = { [k: string]: Model };

export function getModels(dbConnection: Sequelize, s: any): Models {
  const models = {} as Models;

  Object.keys(s).forEach((schemaKey) => {
    // @ts-ignore
    models[schemaKey] = s[schemaKey](
      dbConnection,
      DataTypes,
      getModelName(schemaKey),
      getTableName(schemaKey),
    );
  });

  // Creating associations between models
  Object.keys(models).forEach((modelName: string) => {
    // @ts-ignore
    if (models[modelName].associate) {
      // @ts-ignore
      models[modelName].associate(models);
    }
  });

  return models;
}

export type CompareType = 'like' | 'notLike' | 'in' | 'notIn' | 'eq' | 'ne';

export type CompareValues = string | string[] | number | number[] | Array<string | number>;

export function getCompareSymbol(
  compareType: CompareType,
  vals: CompareValues,
): typeof Op[keyof typeof Op] {
  let symbol: keyof typeof Op;
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
  if (
    values === null ||
    (typeof values === 'string' && values.length > 0) ||
    typeof values === 'number'
  ) {
    const compareSymbol = getCompareSymbol(compareType, values);
    // @ts-ignore
    // eslint-disable-next-line no-param-reassign
    where[field] = {
      [compareSymbol]: compareType === 'like' ? `%${values}%` : values,
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
      } else if (compareType === 'like') {
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
