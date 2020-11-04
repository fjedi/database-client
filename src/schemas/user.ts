/* eslint-disable lines-between-class-members, import/prefer-default-export */
import { Sequelize, Model, DataTypes } from 'sequelize';

export class User extends Model {
  id!: string;
  firstName!: string;
  lastName!: string;
  token!: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  props?: JSON;

  static initModel<TConnection extends Sequelize>(db: TConnection, tableName: string): void {
    //
    User.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV1,
          allowNull: false,
          primaryKey: true,
          unique: true,
        },
        firstName: {
          type: DataTypes.STRING(64),
          allowNull: true,
        },
        lastName: {
          type: DataTypes.STRING(64),
          allowNull: true,
        },
        token: {
          type: DataTypes.STRING(512),
          allowNull: true,
        },
      },
      {
        sequelize: db,
        paranoid: false, // We want to keep data in database even after it has been removed
        timestamps: true,
        modelName: 'User',
        tableName,
        indexes: [
          {
            fields: ['createdAt'],
          },
        ],
      },
    );
  }

  // static associate<TModels>(models: TModels) {}
}
