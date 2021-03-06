const WebSocket = require('ws');

const logger = require('./utils/logger')('ServerClass');
const { ServerError } = require('./types/errors');
const ServerClient = require('./serverClient');
const DataTransformer = require('./utils/dataTransformer');
const { UnauthorizedStack, ServerClientsPool } = require('./types/storages');
const { ActionController, EventController } = require('./types/controllers');

class Server {
  constructor(port, options = { authTimeout: 60000, connectionsLimit: 1024 }) {
    this._port = port;
    this._options = options;
    this._authStack = new UnauthorizedStack(options.authTimeout);
    this._clients = new ServerClientsPool(options.connectionsLimit);
    this._authHandler = async (client) => true;
    this._nameGetter = async (client) => {
      return `client-${this._clients.size}`;
    };
    this._errorHandler = (error) => {
      logger.err(error);
    }
    this._actions = new Map();
    this._events = new Map();
  }

  /**
   * Start up server
   * @returns {Promise.<void>}
   */
  async init() {
    this._wss = new WebSocket.Server({ port: this._port, ...this._options });
    logger.info('SocketServer is listening on port: ', this._port);

    this._wss.on('connection', this.#connectionHandler);
    this._wss.on('error', (error) => {
      throw new ServerError(error.message);
    });
  }

  #connectionHandler = async (client) => {
    logger.debug('New client connected');
    this._authStack.add(client);

    const isAuthorized = await this._authHandler(client);

    this._authStack.delete(client);
    if (isAuthorized) {
      const clientName = await this._nameGetter(client);
      this._clients.add(clientName, new ServerClient(client, this._events, this._actions, this._errorHandler));
      logger.debug(`Client authorized: ${clientName}`);
    } else {
      client.on('close', () => logger.debug('Client kicked'));
      await client.close(1010);
    }
  }


  /**
   * 
   * @param {Promise.<client>} fn 
   */
  setAuthHandler(fn) {
    this._authHandler = fn;
  }

  setClientNameGetter(fn) {
    this._nameGetter = fn
  }

  /**
   * 
   * @param {ActionController} ActionClass - accept ActionController inherit class instance
   */
  addAction(ActionClass) {
    if (!(ActionClass.prototype instanceof ActionController)) {
      throw new TypeError(`Action ${ActionClass.name} is not instance of ActionController-based class`);
    }

    this._actions.set(ActionClass.name, ActionClass);
  }

  addEvent(EventClass) {
    logger.debug(`Add event ${EventClass.name}`)

    if (!(EventClass.prototype instanceof EventController)) {
      throw new TypeError(`Event ${EventClass.name} is not instance of EventnController-based class`);
    }
    
    this._events.set(EventClass.name, EventClass);
  }

  setErrorHandler(fn) {
    this._errorHandler = fn;
  }

  getClient(name) {
    return this._clients.get(name);
  }
}

module.exports = Server;
