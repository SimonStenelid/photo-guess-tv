'use strict';

const QRCode = require('./vendor/QRCode');
const { M } = require('./vendor/QRCode/QRErrorCorrectLevel');

module.exports = function makeQrSvg(url) {
  const code = new QRCode(-1, M);
  code.addData(url);
  code.make();

  const quietZone = 4;
  const size = code.getModuleCount();
  const viewSize = size + 2 * quietZone;
  const modules = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (code.isDark(row, col)) {
        modules.push('M' + (col + quietZone) + ' ' + (row + quietZone) + 'h1v1h-1z');
      }
    }
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + viewSize + ' ' + viewSize +
    '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' +
    modules.join('') + '"/></svg>';
};
