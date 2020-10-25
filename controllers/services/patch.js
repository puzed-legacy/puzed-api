const axios = require('axios');
const finalStream = require('final-stream');
const writeResponse = require('write-response');

const authenticate = require('../../common/authenticate');
const presentService = require('../../presenters/service');

const validateService = require('../../validators/service');
const getServiceById = require('../../queries/services/getServiceById');

async function patchService (scope, request, response, tokens) {
  const { db, settings, config } = scope;

  request.setTimeout(60 * 60 * 1000);

  const { user } = await authenticate({ db, config }, request.headers.authorization);

  const service = await getServiceById(scope, user.id, tokens.serviceId);

  if (!service) {
    throw Object.assign(new Error('resource not be found'), {
      statusCode: 404
    });
  }

  const body = await finalStream(request)
    .then(buffer => buffer.toString('utf8'))
    .then(JSON.parse);

  const validationErrors = await validateService(scope, user.id, service, body, true);

  if (validationErrors) {
    throw Object.assign(new Error('invalid service data'), {
      statusCode: 422,
      message: {
        error: validationErrors
      }
    });
  }

  await db.patch('services', {
    ...body,
    secrets: body.secrets ? JSON.stringify(body.secrets) : service.secrets,
    dateUpdated: Date.now()
  }, {
    query: {
      id: service.id
    }
  });

  const updatedService = await getServiceById(scope, user.id, tokens.serviceId);

  await axios(`https://localhost:${config.httpsPort}/services/${service.id}/deployments`, {
    method: 'POST',
    headers: {
      host: settings.domains.api[0],
      authorization: request.headers.authorization
    },
    data: JSON.stringify({
      title: 'production-update-' + Date.now(),
      branch: 'master',
      autoSwitch: {
        targetDeployment: 'production',
        newTitle: 'production-backup-' + Date.now()
      }
    })
  });

  writeResponse(200, JSON.stringify(presentService(updatedService)), response);
}

module.exports = patchService;
