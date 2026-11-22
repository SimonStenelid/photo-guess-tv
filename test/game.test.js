'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { createHandler, newGame, RequestError } = require('../server');
const { memoryStorage } = require('../storage');

const origin = 'https://photo-guess.test';
const hostCode = '123456789012345678901234';
const host = { 'x-host-code': hostCode };
const jpeg = Buffer.from([255, 216, 12, 34, 255, 217]);

function makeClient(handle) {
  return async function send(method, url, body, headers = {}) {
    const photo = Buffer.isBuffer(body);
    const req = Object.assign(Readable.from(body === undefined ? [] : [
      photo ? body : Buffer.from(JSON.stringify(body))
    ]), {
      method, url, socket: { remoteAddress: '127.0.0.1' },
      headers: { 'content-type': photo ? 'image/jpeg' : 'application/json', ...headers }
    });
    let status;
    let data;
    const responseHeaders = {};
    const res = {
      setHeader(name, value) { responseHeaders[name] = value; },
      writeHead(code, values) { status = code; Object.assign(responseHeaders, values); },
      end(value) {
        data = responseHeaders['Content-Type']?.includes('application/json') ? JSON.parse(value) : value;
      }
    };
    try {
      await handle(req, res);
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      return { status: error.status, data: { error: error.message } };
    }
    return { status, data, headers: responseHeaders };
  };
}

function action(client, state) {
  return client('POST', '/api/advance', {
    gameId: state.gameId, phase: state.phase, round: state.round
  }, host);
}

async function join(client, query, name) {
  const response = await client('POST', '/api/join' + query, { name });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return { 'x-player-token': response.data.token };
}

test('cloud room resumes across handlers, reveals by deadline, and deletes photos', async () => {
  let time = 1000;
  const store = memoryStorage();
  const options = { store, origin, cloud: true, hostCode, clock: () => time };
  let client = makeClient(createHandler(options));
  const preflight = await client('OPTIONS', '/api/advance', undefined, {
    origin: 'null', 'access-control-request-method': 'POST'
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'null');

  const locked = await client('GET', '/api/state');
  assert.equal(locked.data.phase, 'closed');
  assert.equal((await action(client, locked.data)).status, 409);
  let state = (await client('GET', '/api/state', undefined, host)).data;
  assert.equal(state.phase, 'setup');
  state = (await action(client, state)).data;
  assert.equal(state.phase, 'lobby');
  const query = new URL(state.joinUrl).search;
  assert.equal((await client('GET', state.qrUrl)).status, 200);
  assert.equal((await client('GET', '/api/state?room=' + state.gameId)).data.phase, 'closed');
  assert.equal((await client('GET', '/api/state' + query + 'x')).data.phase, 'closed');
  const a = await join(client, query, 'A');
  const b = await join(client, query, 'B');

  assert.equal((await client('POST', '/api/photo' + query, jpeg, a)).status, 201);
  assert.equal((await action(client, state)).status, 409);
  assert.equal((await client('POST', '/api/photo' + query, jpeg, b)).status, 201);
  state = (await action(client, state)).data;
  assert.equal(state.phase, 'voting');
  const photoUrl = state.photoUrl;
  assert.deepEqual((await client('GET', photoUrl)).data, jpeg);
  assert.equal((await client('GET', photoUrl.split('?')[0])).status, 404);
  assert.equal((await client('GET', '/api/state' + query, undefined, b)).data.photoUrl, undefined);

  const bOwnsPhoto = (await client('GET', '/api/state' + query, undefined, b)).data.me.ownsPhoto;
  const owner = bOwnsPhoto ? 'B' : 'A';
  const voter = bOwnsPhoto ? 'A' : 'B';
  const guess = state.players.find((p) => p.name === owner).id;
  assert.equal((await client('POST', '/api/vote' + query, { gameId: state.gameId, round: 1, guess }, bOwnsPhoto ? a : b)).status, 200);

  time += 15_000;
  client = makeClient(createHandler(options));
  const reveal = (await client('GET', '/api/state', undefined, host)).data;
  assert.equal(reveal.phase, 'reveal');
  assert.equal(reveal.players.find((p) => p.name === voter).score, 1);
  assert.equal((await action(client, state)).data.players.find((p) => p.name === voter).score, 1);
  const roundTwo = (await action(client, reveal)).data;
  assert.equal(roundTwo.round, 2);
  assert.equal((await client('GET', photoUrl)).status, 404);
  assert.equal(await store.photos.get(photoUrl.split('/').at(-1).split('?')[0]), undefined);
  const revealTwo = (await action(client, roundTwo)).data;
  const finished = (await action(client, revealTwo)).data;
  assert.equal(finished.phase, 'finished');

  time += 25_000;
  assert.equal((await client('GET', '/api/state' + query, undefined, b)).data.phase, 'closed');
  assert.equal((await client('GET', '/api/state', undefined, host)).data.phase, 'setup');
  const next = (await action(client, finished)).data;
  assert.equal(next.phase, 'lobby');
  assert.notEqual(next.gameId, finished.gameId);
});

test('only the host keeps a lobby active and a new room invalidates old invites', async () => {
  let time = 0;
  const store = memoryStorage();
  const client = makeClient(createHandler({ store, origin, cloud: true, hostCode, clock: () => time }));
  const setup = (await client('GET', '/api/state', undefined, host)).data;
  const lobby = (await action(client, setup)).data;
  const query = new URL(lobby.joinUrl).search;

  time = 20_000;
  assert.equal((await client('GET', '/api/state' + query)).data.phase, 'lobby');
  time = 26_000;
  assert.equal((await client('GET', '/api/state' + query)).data.phase, 'closed');
  const replacement = (await action(client, setup)).data;
  assert.notEqual(replacement.gameId, lobby.gameId);
  assert.equal((await client('GET', '/api/state' + query)).data.phase, 'closed');
});

test('LAN mode still shares the original QR and supports manual reveal', async () => {
  const store = memoryStorage();
  const client = makeClient(createHandler({ store, origin, cloud: false, hostCode }));
  await store.game.update(() => ({ next: newGame(Date.now()) }));
  const lobby = (await client('GET', '/api/state', undefined, host)).data;
  assert.equal(lobby.joinUrl, origin + '/join');
  const a = await join(client, '', 'A');
  const b = await join(client, '', 'B');
  assert.equal((await client('POST', '/api/photo', jpeg, a)).status, 201);
  assert.equal((await client('POST', '/api/photo', jpeg, b)).status, 201);
  const round = (await action(client, lobby)).data;
  const reveal = (await action(client, round)).data;
  assert.equal(reveal.phase, 'reveal');
});

test('each player can share up to 100 photos and needs one to start', async () => {
  const store = memoryStorage();
  const client = makeClient(createHandler({ store, origin, cloud: true, hostCode }));
  const setup = (await client('GET', '/api/state', undefined, host)).data;
  const lobby = (await action(client, setup)).data;
  const query = new URL(lobby.joinUrl).search;
  const a = await join(client, query, 'A');
  const b = await join(client, query, 'B');
  assert.deepEqual(lobby.photoLimits, { min: 1, max: 100 });

  for (let i = 1; i <= 99; i++) {
    const upload = await client('POST', '/api/photo' + query, jpeg, a);
    assert.equal(upload.status, 201);
    assert.equal(upload.data.uploads, i);
  }
  // If two tabs send the last allowed photo, only one can take slot 100.
  const lastSlot = await Promise.all([
    client('POST', '/api/photo' + query, jpeg, a),
    client('POST', '/api/photo' + query, jpeg, a)
  ]);
  assert.deepEqual(lastSlot.map((reply) => reply.status).sort(), [201, 409]);
  const full = (await client('GET', '/api/state', undefined, host)).data;
  assert.equal(full.photoCount, 100);
  assert.deepEqual(full.players.map((player) => player.hasPhotos), [true, false]);
  assert.equal((await action(client, full)).status, 409);
  assert.equal((await client('POST', '/api/photo' + query, jpeg, b)).status, 201);
  const started = await action(client, full);
  assert.equal(started.status, 200);
  assert.equal(started.data.photoCount, 101);
});

test('players get only their round reaction while the host gets the leaderboard', async () => {
  const store = memoryStorage();
  const client = makeClient(createHandler({ store, origin, cloud: true, hostCode }));
  const setup = (await client('GET', '/api/state', undefined, host)).data;
  const lobby = (await action(client, setup)).data;
  const query = new URL(lobby.joinUrl).search;
  const players = [];
  for (const name of ['A', 'B', 'C', 'D']) {
    const headers = await join(client, query, name);
    await client('POST', '/api/photo' + query, jpeg, headers);
    players.push(headers);
  }

  const voting = (await action(client, lobby)).data;
  const view = async (headers) => (await client('GET', '/api/state' + query, undefined, headers)).data;
  const voters = [];
  let owner;
  for (const headers of players) {
    const { me } = await view(headers);
    assert.equal(me.roundResult, undefined);
    if (me.ownsPhoto) owner = { id: me.id, headers };
    else voters.push({ id: me.id, headers });
  }
  const vote = (player, guess) => client('POST', '/api/vote' + query,
    { gameId: voting.gameId, round: voting.round, guess }, player.headers);
  assert.equal((await vote(voters[0], owner.id)).status, 200);
  assert.equal((await vote(voters[1], voters[0].id)).status, 200);

  const reveal = (await action(client, voting)).data;
  assert.equal(reveal.players.find((player) => player.id === voters[0].id).score, 1);
  for (const [player, outcome] of [
    [owner, 'own-photo'], [voters[0], 'correct'], [voters[1], 'incorrect'], [voters[2], 'no-vote']
  ]) {
    const result = await view(player.headers);
    assert.deepEqual(result.me.roundResult, { round: 1, ownerId: owner.id, outcome });
    assert.ok(result.players.every((entry) => entry.score === undefined));
  }
  const roundTwo = (await action(client, reveal)).data;
  assert.equal(roundTwo.round, 2);
  assert.equal((await view(voters[0].headers)).me.roundResult.outcome, 'correct');
});

test('only the host can stop a game, and only completed reveals survive', async () => {
  const store = memoryStorage();
  const client = makeClient(createHandler({ store, origin, cloud: true, hostCode }));
  const setup = (await client('GET', '/api/state', undefined, host)).data;
  const lobby = (await action(client, setup)).data;
  const query = new URL(lobby.joinUrl).search;
  const a = await join(client, query, 'A');
  const b = await join(client, query, 'B');
  for (const headers of [a, b]) await client('POST', '/api/photo' + query, jpeg, headers);
  const stateFor = async (headers) => (await client('GET', '/api/state' + query, undefined, headers)).data;
  const first = (await action(client, lobby)).data;
  const { me: firstA } = await stateFor(a);
  const { me: firstB } = await stateFor(b);
  const vote = (state, owner, voterHeaders) => client('POST', '/api/vote' + query,
    { gameId: state.gameId, round: state.round, guess: owner.id }, voterHeaders);
  await vote(first, firstA.ownsPhoto ? firstA : firstB, firstA.ownsPhoto ? b : a);
  const reveal = (await action(client, first)).data;
  assert.equal(reveal.players.reduce((n, p) => n + p.score, 0), 1);
  const second = (await action(client, reveal)).data;
  const remainingId = second.photoUrl.split('/').at(-1).split('?')[0];
  const { me: secondA } = await stateFor(a);
  const { me: secondB } = await stateFor(b);
  await vote(second, secondA.ownsPhoto ? secondA : secondB, secondA.ownsPhoto ? b : a);

  const stop = (id, headers) => client('POST', '/api/stop', { gameId: id }, headers);
  assert.equal((await stop(second.gameId, a)).status, 403);
  assert.equal((await stop('stale-game', host)).status, 409);
  const stopped = await stop(second.gameId, host);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.data.phase, 'finished');
  assert.equal(stopped.data.stopped, true);
  assert.equal(stopped.data.photoCount, 0);
  assert.equal(stopped.data.players.reduce((n, p) => n + p.score, 0), 1);
  assert.equal((await stateFor(a)).stopped, true);
  assert.equal((await client('GET', second.photoUrl)).status, 404);
  assert.equal(await store.photos.get(remainingId), undefined);
  assert.equal((await stop(second.gameId, host)).status, 200);
  const fresh = await action(client, stopped.data);
  assert.equal(fresh.data.phase, 'lobby');
  assert.equal((await stop(second.gameId, host)).status, 409);
});

test('a host can stop an empty lobby using the TV widget origin', async () => {
  const store = memoryStorage();
  const client = makeClient(createHandler({ store, origin, cloud: false, hostCode }));
  await store.game.update(() => ({ next: newGame(Date.now()) }));
  const lobby = (await client('GET', '/api/state', undefined, host)).data;
  const preflight = await client('OPTIONS', '/api/stop', undefined, {
    origin: 'null', 'access-control-request-method': 'POST'
  });
  assert.equal(preflight.status, 204);
  const stopped = await client('POST', '/api/stop', { gameId: lobby.gameId }, { ...host, origin: 'null' });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.headers['Access-Control-Allow-Origin'], 'null');
  assert.equal(stopped.data.stopped, true);
  assert.deepEqual(stopped.data.players, []);
});
