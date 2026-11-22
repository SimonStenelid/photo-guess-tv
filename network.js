'use strict';

const os = require('node:os');

const port = Number(process.env.PORT || 3000);
const addresses = Object.values(os.networkInterfaces()).flat();
const lanIp = process.env.LAN_IP || addresses.find(
  (address) => address.family === 'IPv4' && !address.internal
)?.address || '127.0.0.1';

module.exports = { port, lanUrl: 'http://' + lanIp + ':' + port };
