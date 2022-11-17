import { resolve as resolvePath } from 'path';
import { Sequelize } from 'sequelize';
import { Umzug, SequelizeStorage, MigrationMeta } from 'umzug';
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

export default async function runMigrations(
  sequelizeInstance: Sequelize,
  cmd: MigrateCommand,
  migrationsPath: string,
): Promise<void> {
  const migrator = new Umzug({
    context: sequelizeInstance.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize: sequelizeInstance }),
    logger: console,
    migrations: {
      glob: resolvePath(migrationsPath, 'migrations/*.{js.ts}'),
      resolve: ({ name, path, context }) => {
        if (!path) {
          logger.warn('Invalid "path" passed to db-migration', { name, path, context });
          return {
            name,
            up() {
              return Promise.resolve();
            },
            down() {
              return Promise.resolve();
            },
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require, import/no-dynamic-require
        const migration = require(path);
        return {
          // adjust the parameters Umzug will
          // pass to migration methods when called
          name,
          up: async () => migration.up(context, Sequelize),
          down: async () => migration.down(context, Sequelize),
        };
      },
    },
  });

  migrator.on('migrating', logger.info);
  migrator.on('migrated', logger.info);
  migrator.on('reverting', logger.info);
  migrator.on('reverted', logger.info);

  let executedCmd: Promise<MigrationMeta[]> | null = null;
  logger.info(`DB-MIGRATION ${cmd.toUpperCase()} BEGIN`);
  //
  switch (cmd) {
    case 'up':
    case 'migrate':
      executedCmd = migrator.up();
      break;

    case 'next':
    case 'migrate-next':
      // executedCmd = cmdMigrateNext();
      break;

    case 'down':
    case 'reset':
      executedCmd = migrator.down();
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
    logger.info(err as Error);
    logger.info('='.repeat(errorStr.length));
  }
}
