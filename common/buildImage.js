const path = require('path');
const fs = require('fs').promises;
const chalk = require('chalk');
const chalkCtx = new chalk.Instance({ level: 3 });
const execa = require('execa');
const tar = require('tar-fs');

const buildDockerImage = require('./dockerCommands/buildDockerImage');
const getDeploymentAndRelated = require('../queries/deployments/getDeploymentAndRelated');

const { createLiveLogger } = require('./liveLogger');

async function generateDockerfile (templateName, options) {
  let template = await fs.readFile(path.resolve(__dirname, `../dockerfileTemplates/Dockerfile.${templateName}`), 'utf8');

  template = template
    .replace('{{buildCommand}}', options.buildCommand)
    .replace('{{runCommand}}', options.runCommand);

  return template;
}

async function buildImage (scope, deploymentId) {
  const { db, notify, config } = scope;

  const server = await scope.db.getOne('servers', {
    query: {
      id: config.serverId
    }
  });

  const {
    deployment,
    service,
    provider
  } = await getDeploymentAndRelated(scope, deploymentId);

  await db.patch('deployments', {
    buildStatus: 'building'
  }, {
    query: {
      id: deploymentId
    }
  });

  notify.broadcast(deploymentId);
  // TODO: This fixes a race condition somewhere
  setTimeout(() => notify.broadcast(deploymentId), 500);
  // --------------------------------------

  const log = createLiveLogger(deploymentId);

  const repositoryPath = `/tmp/${deploymentId}`;

  try {
    log('\n' + chalkCtx.greenBright('Cloning repository from github'));
    await provider.cloneRepository(scope, {
      service,
      deployment,
      providerRepositoryId: service.providerRepositoryId,
      branch: deployment.commitHash,
      target: repositoryPath
    });

    log('\n' + chalkCtx.greenBright('Creating Dockerfile from template'));
    const dockerfileContent = await generateDockerfile(service.image, {
      socksHost: server.hostname,
      socksPort: '1080',
      socksUser: service.id,
      socksPass: service.networkAccessToken,

      serviceName: service.name,
      deploymentTitle: deployment.title,
      commitHash: deployment.commitHash,

      buildCommand: service.buildCommand,
      runCommand: service.runCommand
    });

    await fs.writeFile(path.join(repositoryPath, '/Dockerfile'), dockerfileContent);

    log('\n' + chalkCtx.greenBright('Creating .dockerignore'));
    const dockerignoreTemplate = await fs.readFile(path.resolve(__dirname, '../dockerfileTemplates/.dockerignore'), 'utf8');
    await fs.writeFile(path.join(repositoryPath, '.dockerignore'), dockerignoreTemplate);

    log('\n' + chalkCtx.greenBright('Build docker image\n'));
    const imageId = await buildDockerImage(scope, log, tar.pack(repositoryPath));

    await db.patch('deployments', {
      buildStatus: 'success',
      buildLog: log.end(),
      imageId
    }, {
      query: {
        id: deploymentId
      }
    });

    notify.broadcast(deploymentId);
  } catch (error) {
    log('\n' + chalkCtx.redBright(error.message));
    log('\n' + chalkCtx.greenBright('Cleaning up build directory'));
    const logData = log.end();

    try {
      await execa('rm', ['-rf', repositoryPath]);
    } catch (error) {
      console.log(error);
    }

    await db.patch('deployments', {
      buildStatus: 'failed',
      buildLog: logData
    }, {
      query: {
        id: deploymentId
      }
    });

    notify.broadcast(deploymentId);
  }
}

module.exports = buildImage;
