const http = require('http');

const selectRandomItemFromArray = require('./selectRandomItemFromArray');

const httpProxy = require('http-proxy');

async function getProxyTarget ({ db }, request) {
  const hostnameAndMaybePort = request.headers.host && request.headers.host.toLowerCase();

  if (!hostnameAndMaybePort) {
    return [{ statusCode: 404, message: 'no host specified found' }];
  }

  let hostname = hostnameAndMaybePort.split(':')[0];
  let branch;

  if (hostname.includes('--')) {
    [branch, hostname] = hostname.split('--');
  }

  branch = branch || 'production';

  const service = await db.getOne('services', {
    query: {
      domain: hostname
    }
  });

  if (!service) {
    return [{ statusCode: 404, message: `no service for host ${hostnameAndMaybePort} found` }];
  }

  const deployment = await db.getOne('deployments', {
    query: {
      serviceId: service.id,
      subdomain: branch
    }
  });

  if (!deployment) {
    return [{ statusCode: 404, message: `no deployment for host ${hostnameAndMaybePort} found` }];
  }

  const instances = await db.getAll('instances', {
    query: {
      deploymentId: deployment.id,
      status: 'healthy'
    },
    fields: ['dockerPort', 'serverId']
  });

  if (instances.length === 0) {
    return [{ statusCode: 404, message: `no instances for host ${hostnameAndMaybePort} found` }];
  }

  const instance = selectRandomItemFromArray(instances);

  return [
    null,
    {
      server: await db.getOne('servers', {
        query: {
          id: instance.serverId
        }
      }),
      instance
    }
  ];
}

async function proxyHttpToInstance ({ db }, request, response) {
  const [proxyTargetRejection, proxyTarget] = await getProxyTarget({ db }, request);
  const server = proxyTarget && proxyTarget.server;
  const instance = proxyTarget && proxyTarget.instance;
  if (proxyTargetRejection) {
    response.writeHead(proxyTargetRejection.statusCode);
    response.end(proxyTargetRejection.message);
    return;
  }

  const proxyRequest = http.request(`http://${server.hostname}:${instance.dockerPort}${request.url}`, {
    method: request.method,
    headers: request.headers
  }, function (proxyResponse) {
    response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
    proxyResponse.pipe(response);
  });

  proxyRequest.on('error', error => {
    if (error.code === 'ECONNREFUSED') {
      response.writeHead(502);
      response.end();
      return;
    }
    if (error.code === 'ECONNRESET') {
      response.writeHead(502);
      response.end();
      return;
    }
    console.log(error);
    response.writeHead(500);
    response.end();
  });

  request.pipe(proxyRequest);
}

function proxyWebsocketToInstance ({ db }) {
  return async function (request, socket, head) {
    const [proxyTargetRejection, proxyTarget] = await getProxyTarget({ db }, request);
    const server = proxyTarget && proxyTarget.server;
    const instance = proxyTarget && proxyTarget.instance;

    if (proxyTargetRejection) {
      console.log('could not proxy websockets', proxyTargetRejection);
      return;
    }

    const proxy = httpProxy.createProxyServer({
      target: {
        hostname: server.hostname,
        port: instance.dockerPort
      }
    });
    proxy.ws(request, socket, head);
  };
}

module.exports = {
  http: proxyHttpToInstance,
  websocket: proxyWebsocketToInstance
};
