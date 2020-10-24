const finalStream = require('final-stream');
const axios = require('axios');
const writeResponse = require('write-response');

const createRandomString = require('../../common/createRandomString');
const authenticate = require('../../common/authenticate');
const presentService = require('../../presenters/service');

const validateService = require('../../validators/service');

async function createService (scope, request, response) {
  const { db, settings, config } = scope;

  request.setTimeout(60 * 60 * 1000);

  const { user } = await authenticate({ db, config }, request.headers.authorization);

  if (!user.allowedServiceCreate) {
    throw Object.assign(new Error('Validation error'), {
      statusCode: 422,
      message: {
        error: {
          messages: ['You do not have permission to create services']
        }
      }
    });
  }

  const body = await finalStream(request)
    .then(buffer => buffer.toString('utf8'))
    .then(JSON.parse);

  if (settings.domains.api.includes(body.domain) || settings.domains.client.includes(body.domain)) {
    throw Object.assign(new Error('Validation error'), {
      statusCode: 422,
      message: {
        error: {
          messages: [`domain of "${body.domain}" is already taken`],
          fields: {
            domain: [`domain of "${body.domain}" is already taken`]
          }
        }
      }
    });
  }

  const validationErrors = await validateService(scope, user.id, body);

  if (validationErrors) {
    throw Object.assign(new Error('invalid service data'), {
      statusCode: 422,
      message: {
        error: validationErrors
      }
    });
  }

  const service = await db.post('services', {
    name: body.name,
    linkId: body.linkId,
    providerRepositoryId: body.providerRepositoryId,
    image: body.image,
    webPort: body.webPort,
    networkRulesId: body.networkRulesId,
    domain: body.domain,
    secrets: JSON.stringify(body.secrets),
    environmentVariables: body.environmentVariables,
    runCommand: body.runCommand,
    buildCommand: body.buildCommand,
    networkAccessToken: await createRandomString(40),
    userId: user.id,
    dateCreated: Date.now()
  });

  await axios(`https://localhost:${config.httpsPort}/services/${service.id}/deployments`, {
    method: 'POST',
    headers: {
      host: settings.domains.api[0],
      authorization: request.headers.authorization
    },
    data: JSON.stringify({
      title: 'production',
      branch: 'master'
    })
  });

  writeResponse(201, JSON.stringify(presentService(service)), response);
}

module.exports = createService;
