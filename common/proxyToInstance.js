const http = require('http');

const selectRandomItemFromArray = require('./selectRandomItemFromArray');

const httpProxy = require('http-proxy');

async function proxyHttpToInstance ({ db }, request, response) {
  const hostnameAndMaybePort = request.headers.host && request.headers.host.toLowerCase();

  if (!hostnameAndMaybePort) {
    response.writeHead(404);
    response.end('no host specified found');
    return;
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
    response.writeHead(404);
    response.end(`no service for host ${hostnameAndMaybePort} found`);
    return;
  }

  const deployment = await db.getOne('deployments', {
    query: {
      serviceId: service.id,
      subdomain: branch
    }
  });

  if (!deployment) {
    response.writeHead(404);
    response.end(`no deployment for host ${hostnameAndMaybePort} found`);
    return;
  }

  const instances = await db.getAll('instances', {
    query: {
      deploymentId: deployment.id,
      status: 'healthy'
    },
    fields: ['dockerPort', 'serverId']
  });

  if (instances.length === 0) {
    response.writeHead(404);
    response.end(`no instances for host ${hostnameAndMaybePort} found`);
    return;
  }

  const instance = selectRandomItemFromArray(instances);

  const server = await db.getOne('servers', {
    query: {
      id: instance.serverId
    }
  });

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

function proxyWebsocketToInstance ({ db, config, settings }) {
  return function (request, socket, head) {
    const proxy = httpProxy.createProxyServer({
      target: `${config.clientUrl}${request.url}`
    });
    proxy.ws(request, socket, head);
  };
}

module.exports = {
  http: proxyHttpToInstance,
  websocket: proxyWebsocketToInstance
};
