import { DataTypes, Sequelize, Model } from 'sequelize';
import snakeCase from 'lodash/snakeCase';
import capitalize from 'lodash/capitalize';

// Custom Tables' names (if we need to override filename-based naming
const dbTables: { [k: string]: any } = {};
// Custom Models' names (if we need to override filename-based naming
const dbModels: { [k: string]: any } = {};

//
export function getModelName(key: string): string {
  return dbModels[key] || capitalize(key);
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
