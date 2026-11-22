'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const participants = [
  { key: 'alex', name: 'Alex', photo: 'raincoat.jpg' },
  { key: 'jamie', name: 'Jamie', photo: 'cat.jpg' },
  { key: 'sam', name: 'Sam', photo: 'cake.jpg' }
];

function createPreview(store, newGame) {
  let identities = new Map();
  async function reset() {
    const game = newGame(Date.now());
    const keys = new Map();
    for (const participant of participants) {
      const player = { id: randomUUID(), token: randomUUID(), name: participant.name, uploads: 1, score: 0 };
      const photo = { id: randomUUID(), ownerId: player.id };
      await store.photos.put(photo.id, fs.readFileSync(path.join(__dirname, 'photos', participant.photo)));
      game.players.push(player);
      game.photos.push(photo);
      keys.set(participant.key, player.id);
    }
    const previous = await store.game.update((current) => ({ next: game, result: current }));
    identities = keys;
    if (previous) await Promise.all(previous.photos.map((photo) => store.photos.remove(photo.id)));
  }

  async function resolve(req, url) {
    if (req.method === 'GET' && ['/preview', '/preview/audio'].includes(url.pathname)) {
      const page = url.pathname === '/preview/audio' ? 'audio.html' : 'preview.html';
      return { status: 200, body: fs.readFileSync(path.join(__dirname, page)), type: 'text/html; charset=utf-8' };
    }
    if (req.method === 'POST' && url.pathname === '/api/dev/reset' && req.headers['content-type'] === 'application/json') {
      await reset();
      return { status: 200, body: '{"reset":true}', type: 'application/json' };
    }
    if (req.method === 'GET' && url.pathname === '/api/dev/player') {
      const id = identities.get(url.searchParams.get('demo'));
      const game = await store.game.read();
      const player = id && game.players.find((entry) => entry.id === id);
      return {
        status: player ? 200 : 404,
        body: player ? JSON.stringify({ token: player.token }) : '{"error":"Reset the demo to restore sample players."}',
        type: 'application/json'
      };
    }
  }

  return { reset, resolve };
}

module.exports = { createPreview };
