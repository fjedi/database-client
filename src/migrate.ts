import { resolve as resolvePath } from 'path';
import { Sequelize } from 'sequelize';
import Migrator, { Umzug, UmzugOptions, Migration } from 'umzug';
import { logger } from '@fjedi/logger';

export type MigrateCommand =
  | 'up'
  | 'down'
  | 'migrate'
  | 'migrate-next'
  | 'next'
  | 'prev'
  | 'reset'
  | 'reset-prev';

function logUmzugEvent(eventName: string) {
  return (name: string, migration?: Migration) => {
    logger.info(`${name} ${eventName}`);
  };
}

type MigrationOptions = {
  migrator: Umzug;
  seeder: Umzug;
};

type GetUmzugConfigParams = {
  sequelize: Sequelize;
  modelName?: string;
  path: string;
};

async function cmdMigrate(opts: MigrationOptions) {
  const { migrator, seeder } = opts;
  return migrator.up().then(() => seeder.up());
}

async function cmdReset(opts: MigrationOptions) {
  const { migrator, seeder } = opts;
  return seeder.down({ to: 0 }).then(() => migrator.down({ to: 0 }));
}

function genUmzugConfig(params: GetUmzugConfigParams): UmzugOptions {
  const { sequelize, modelName, path: filePath } = params;
  return {
    storage: 'sequelize',
    storageOptions: {
      sequelize,
      modelName: modelName || 'SequelizeMeta',
    },

    // see: https://github.com/sequelize/umzug/issues/17
    migrations: {
      params: [
        sequelize.getQueryInterface(), // queryInterface
        sequelize.constructor, // DataTypes
        () => {
          throw new Error(
            'Migration tried to use old style "done" callback. Please upgrade to "umzug" and return a promise instead.',
          );
        },
      ],
      path: filePath,
      pattern: /\.(j|t)s$/,
    },

    logging() {},
  };
}

export default async function runMigrations(
  sequelizeInstance: Sequelize,
  cmd: MigrateCommand,
  path: string,
): Promise<void> {
  const migrator = new Migrator(
    genUmzugConfig({
      sequelize: sequelizeInstance,
      path: resolvePath(path, 'migrations'),
    }),
  );
  const seedPath = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
  const seeder = new Migrator(
    genUmzugConfig({
      sequelize: sequelizeInstance,
      modelName: 'SequelizeSeeds',
      path: resolvePath(path, 'seeds', seedPath),
    }),
  );

  migrator.on('migrating', logUmzugEvent('migrating'));
  migrator.on('migrated', logUmzugEvent('migrated'));
  migrator.on('reverting', logUmzugEvent('reverting'));
  migrator.on('reverted', logUmzugEvent('reverted'));

  let executedCmd: Promise<Migration[]> | null = null;
  logger.info(`DB-MIGRATION ${cmd.toUpperCase()} BEGIN`);
  //
  switch (cmd) {
    case 'up':
    case 'migrate':
      executedCmd = cmdMigrate({ migrator, seeder });
      break;

    case 'next':
    case 'migrate-next':
      // executedCmd = cmdMigrateNext();
      break;

    case 'down':
    case 'reset':
      executedCmd = cmdReset({ migrator, seeder });
      break;

    case 'prev':
    case 'reset-prev':
      // executedCmd = cmdResetPrev({migrator, seeder});
      break;

    default:
      logger.info(`invalid cmd: ${cmd}`);
      process.exit(1);
  }

  try {
    await executedCmd;
    const doneStr = `DB-MIGRATION ${cmd.toUpperCase()} DONE`;
    logger.info(doneStr);
    logger.info('='.repeat(doneStr.length));
  } catch (err) {
    const errorStr = `DB-MIGRATION ${cmd.toUpperCase()} ERROR`;
    logger.info(errorStr);
    logger.info('='.repeat(errorStr.length));
    logger.info(err);
    logger.info('='.repeat(errorStr.length));
  }
}
