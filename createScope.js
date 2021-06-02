const fs = require('fs');
const chalk = require('chalk');
const canhazdbClient = require('canhazdb-client');
const canhazdbServer = require('canhazdb-server');

const createNotifyServer = require('notify-over-http');
const createMetricsEngine = require('./common/createMetricsEngine');
const hint = require('hinton');

const createScheduler = require('skeddy');

const tls = {
  key: fs.readFileSync('./certs/localhost.privkey.pem'),
  cert: fs.readFileSync('./certs/localhost.cert.pem'),
  ca: [fs.readFileSync('./certs/ca.cert.pem')],
  requestCert: true
};

async function loadSettingsFromDatabase (config, db) {
  const settings = await db.getAll('settings');

  const objectifiedSettings = settings.reduce((result, setting) => {
    result[setting.key] = setting.value;
    return result;
  }, {});

  if (!objectifiedSettings.installed && !config.hideUninstalledWarning) {
    console.log(chalk.yellow('Puzed instance is not installed'));
  }

  return objectifiedSettings;
}

async function createScope (config) {
  process.env.HINT = process.env.HINT || config.hint;

  hint('puzed.db', 'connecting');

  const dataNode = config.createDataNode
    ? await canhazdbServer({
        host: 'localhost', port: 7061, queryPort: 8061, dataDirectory: config.dataDirectory, single: true, tls
      })
    : null;

  const db = await canhazdbClient(dataNode ? dataNode.url : 'https://localhost:8061', { tls });

  hint('puzed.settings', 'grabbing settings from db');
  const settings = await loadSettingsFromDatabase(config, db, 'settings');

  hint('puzed.db', 'fetching all servers');
  const servers = await db.getAll('servers');

  hint('puzed.notify', 'creating notify server');
  const notify = createNotifyServer({
    servers: servers
      .map(server => ({
        url: `https://${server.hostname}:${server.apiPort}/notify`,
        headers: {
          host: settings.domains.api[0]
        }
      }))
  });

  const scope = {
    config,
    settings,
    notify,
    dataNode,
    scheduler: createScheduler(),
    db,
    close: () => {
      return Promise.all([
        db.close(),
        scope.scheduler.cancelAndStop(),
        dataNode && dataNode.close()
      ]);
    }
  };

  hint('puzed.metrics', 'starting metrics engine');
  scope.metrics = createMetricsEngine(scope);

  scope.reloadSettings = async () => {
    scope.settings = await loadSettingsFromDatabase(config, db, 'settings');
  };

  scope.providers = require('./providers')(scope);

  return scope;
}

module.exports = createScope;
