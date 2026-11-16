// Serveur MQTT local (WebSocket) pour les tests : node brokers.js 8883
const { createServer } = require('aedes-server-factory');
const port = +process.argv[2];
const srv = createServer(require('aedes')(), { ws: true });
srv.listen(port, '127.0.0.1', () => console.log('broker ws', port));
