'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { lanUrl } = require('../network');

const root = path.join(__dirname, '..');
const serverAddress = process.env.PUBLIC_ORIGIN || lanUrl;
const output = path.join(root, process.env.PUBLIC_ORIGIN ? 'PhotoGuessTV-Cloud.wgt' : 'PhotoGuessTV.wgt');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-guess-tizen-'));

try {
  for (const name of ['config.xml', 'icon.png', 'setup.js']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(stage, name));
  }
  for (const name of ['style.css', 'common.js', 'mascot.js', 'audio.js', 'tv.js', 'nunito-900.woff2', 'nunito-OFL.txt']) {
    fs.copyFileSync(path.join(root, 'public', name), path.join(stage, name));
  }
  fs.writeFileSync(path.join(stage, 'server-config.js'),
    'window.photoGuessDefaultAddress = ' + JSON.stringify(serverAddress) + ';\n');

  const page = fs.readFileSync(path.join(root, 'public', 'tv.html'), 'utf8');
  const entryScript = '<script defer src="tv.js"></script>';
  if (!page.includes(entryScript)) throw new Error('TV page entry script is missing.');
  const widgetPage = page.replace(entryScript, [
    '<script defer src="server-config.js"></script>',
    '<script defer src="setup.js"></script>',
    entryScript
  ].join('\n  '));
  fs.writeFileSync(path.join(stage, 'index.html'), widgetPage);

  const archive = path.join(stage, 'PhotoGuessTV.wgt');
  execFileSync('zip', ['-q', '-X', archive, ...fs.readdirSync(stage)], { cwd: stage });
  fs.copyFileSync(archive, output);
  console.log(output);
  console.log('Default server address: ' + serverAddress + '/tv');
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
