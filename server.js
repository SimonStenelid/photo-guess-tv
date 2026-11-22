'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const makeQrSvg = require('./qr');
const { port, lanUrl } = require('./network');
const { memoryStorage, cloudStorage } = require('./storage');

const maxPhotoSize = 2 * 1024 * 1024;
const photoLimits = { min: 1, max: 100 };
const voteDurationMs = 15_000;
const leaseMs = 25_000;
const renewBelowMs = 15_000;
const publicDir = path.join(__dirname, 'public');
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const staticRoutes = new Map([
  ['/', ['tv.html', 'text/html; charset=utf-8']],
  ['/tv', ['tv.html', 'text/html; charset=utf-8']],
  ['/join', ['phone.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/common.js', ['common.js', 'text/javascript; charset=utf-8']],
  ['/mascot.js', ['mascot.js', 'text/javascript; charset=utf-8']],
  ['/audio.js', ['audio.js', 'text/javascript; charset=utf-8']],
  ['/nunito-900.woff2', ['nunito-900.woff2', 'font/woff2']],
  ['/tv.js', ['tv.js', 'text/javascript; charset=utf-8']],
  ['/phone.js', ['phone.js', 'text/javascript; charset=utf-8']]
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function reply(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(body);
}

function json(res, status, data) {
  reply(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw new RequestError(413, 'That upload is too large.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new RequestError(413, 'That upload is too large.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  if (req.headers['content-type'] !== 'application/json') {
    throw new RequestError(415, 'Expected a JSON request.');
  }
  const bytes = await readBody(req, 1024);
  try {
    return JSON.parse(bytes.toString()) || {};
  } catch {
    throw new RequestError(400, 'Invalid request.');
  }
}

function newGame(now) {
  return {
    id: randomUUID(),
    phase: 'lobby',
    players: [],
    photos: [],
    index: 0,
    votes: {},
    voteDeadline: null,
    liveUntil: now + leaseMs,
    purgeAt: new Date(now + 24 * 60 * 60 * 1000)
  };
}

function activePhoto(game) {
  return game.phase === 'voting' || game.phase === 'reveal' ? game.photos[game.index] : undefined;
}

function revealIfExpired(game, now) {
  if (game.phase !== 'voting' || game.voteDeadline > now) return false;
  revealRound(game);
  return true;
}

function revealRound(game) {
  const ownerId = activePhoto(game).ownerId;
  for (const player of game.players) {
    if (game.votes[player.id] === ownerId) player.score++;
  }
  game.lastReveal = { round: game.index + 1, ownerId, votes: game.votes };
  game.voteDeadline = null;
  game.phase = 'reveal';
}

function startVoting(game, now) {
  game.votes = {};
  game.phase = 'voting';
  game.voteDeadline = now + voteDurationMs;
}

function finishGame(game) {
  const removed = game.photos.filter((photo) => !photo.retired).map((photo) => photo.id);
  game.photos = [];
  game.votes = {};
  game.voteDeadline = null;
  game.phase = 'finished';
  return removed;
}

function advance(game, now) {
  if (game.phase === 'lobby') {
    if (game.players.length < 2 || game.players.some((player) => player.uploads < photoLimits.min)) {
      throw new RequestError(409, 'You need two players, and each player must share at least one photo.');
    }
    for (let i = game.photos.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [game.photos[i], game.photos[j]] = [game.photos[j], game.photos[i]];
    }
    startVoting(game, now);
  } else if (game.phase === 'voting') {
    revealRound(game);
  } else if (game.phase === 'reveal') {
    const playedPhoto = game.photos[game.index];
    game.index++;
    if (game.index === game.photos.length) {
      return finishGame(game);
    }
    playedPhoto.retired = true;
    startVoting(game, now);
    return [playedPhoto.id];
  }
  return [];
}

function playerFor(game, req) {
  return game.players.find((player) => player.token === req.headers['x-player-token']);
}

function roundResult(reveal, player) {
  if (!reveal) return undefined;
  let outcome = 'no-vote';
  if (player.id === reveal.ownerId) outcome = 'own-photo';
  else if (Object.hasOwn(reveal.votes, player.id)) {
    outcome = reveal.votes[player.id] === reveal.ownerId ? 'correct' : 'incorrect';
  }
  return { round: reveal.round, ownerId: reveal.ownerId, outcome };
}

function readState(game, req, host, origin, cloud, now, ticket) {
  if (!game) return { cloud, host, phase: host ? 'setup' : 'closed', players: [], photoCount: 0 };
  const photo = activePhoto(game);
  const player = playerFor(game, req);
  const showScores = host && (game.phase === 'reveal' || game.phase === 'finished');
  const reveal = game.lastReveal || (game.phase === 'reveal'
    ? { round: game.index + 1, ownerId: photo.ownerId, votes: game.votes } : undefined);
  const room = ticket ? '?room=' + ticket : '';
  return {
    cloud,
    gameId: game.id,
    phase: game.phase,
    stopped: game.stopped,
    photoLimits,
    joinUrl: origin + '/join' + room,
    qrUrl: '/qr.svg' + room,
    host,
    players: game.players.map(({ id, name, score, uploads }) => ({
      id, name, score: showScores ? score : undefined,
      hasPhotos: game.phase === 'lobby' ? uploads >= photoLimits.min : undefined
    })),
    photoCount: game.photos.length,
    round: photo ? game.index + 1 : undefined,
    photoUrl: photo && (host || !cloud) ? '/photo/' + photo.id + room : undefined,
    ownerId: game.phase === 'reveal' ? photo.ownerId : undefined,
    votesIn: Object.keys(game.votes).length,
    votesExpected: photo ? game.players.length - 1 : 0,
    voteTimeLeftMs: game.phase === 'voting' ? Math.max(0, game.voteDeadline - now) : undefined,
    me: player ? {
      id: player.id,
      name: player.name,
      uploads: player.uploads,
      ownsPhoto: Boolean(photo && photo.ownerId === player.id),
      voted: Object.hasOwn(game.votes, player.id),
      roundResult: roundResult(reveal, player),
      correct: game.phase === 'reveal' && Object.hasOwn(game.votes, player.id)
        ? game.votes[player.id] === photo.ownerId : undefined
    } : undefined
  };
}

function allowWidget(req, res, route) {
  const origin = req.headers.origin;
  const method = route === '/api/state' ? 'GET' :
    ['/api/advance', '/api/stop'].includes(route) ? 'POST' : undefined;
  if (!method || (origin !== 'null' && origin !== 'file://')) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'OPTIONS' || req.headers['access-control-request-method'] !== method) return false;
  res.setHeader('Access-Control-Allow-Methods', method);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Host-Code');
  res.setHeader('Access-Control-Max-Age', '600');
  res.writeHead(204);
  res.end();
  return true;
}

function createHandler({ store, origin, cloud, hostCode, clock = Date.now, preview }) {
  const secret = Buffer.from(hostCode);
  const localQr = cloud ? null : makeQrSvg(origin + '/join');
  const localPort = new URL(origin).port || port;

  function isLoopback(req) {
    return req.socket.remoteAddress === '127.0.0.1' &&
      ['localhost:' + localPort, '127.0.0.1:' + localPort].includes(req.headers.host);
  }

  function signRoom(id) {
    const signature = createHmac('sha256', secret).update('room:' + id)
      .digest().subarray(0, 16).toString('base64url');
    return id + '.' + signature;
  }

  function verifyRoom(ticket) {
    if (typeof ticket !== 'string' || ticket.length !== 59) return null;
    const id = ticket.slice(0, 36);
    if (!uuidPattern.test(id)) return null;
    const candidate = Buffer.from(ticket);
    const expected = Buffer.from(signRoom(id));
    return candidate.length === expected.length && timingSafeEqual(candidate, expected) ? id : null;
  }

  function gameState(game, req, host, now) {
    return readState(game, req, host, origin, cloud, now, cloud && game ? signRoom(game.id) : null);
  }

  function isHost(req) {
    const input = req.headers['x-host-code'];
    if (typeof input !== 'string') return false;
    const candidate = Buffer.from(input.trim().toLowerCase());
    return candidate.length === secret.length && timingSafeEqual(candidate, secret);
  }

  function isLive(game, now) {
    return game && (!cloud || game.liveUntil > now);
  }

  function canRead(game, host, room, now) {
    return isLive(game, now) && (!cloud || host || room === game.id);
  }

  function requireRoom(game, room, now) {
    if (!canRead(game, false, room, now)) {
      throw new RequestError(410, 'This game has ended. Scan the new QR code on the TV.');
    }
  }

  function requirePlayer(game, req) {
    const player = playerFor(game, req);
    if (!player) throw new RequestError(401, 'Join the game first.');
    return player;
  }

  function requireUpload(game, req, room, now) {
    requireRoom(game, room, now);
    const player = requirePlayer(game, req);
    if (game.phase !== 'lobby') throw new RequestError(409, 'The game has started. Uploads are closed.');
    if (player.uploads >= photoLimits.max) {
      throw new RequestError(409, 'You have already shared ' + photoLimits.max + ' photos.');
    }
    return player;
  }

  async function getState(req, host, room) {
    if (cloud && !host && !room) {
      return gameState(null, req, host, clock());
    }
    const game = await store.game.read();
    const now = clock();
    if (!canRead(game, host, room, now)) return gameState(null, req, host, now);
    function needsUpdate(value, time) {
      return (value.phase === 'voting' && value.voteDeadline <= time) ||
        (cloud && host && value.phase !== 'finished' && value.liveUntil - time <= renewBelowMs);
    }
    if (!needsUpdate(game, now)) return gameState(game, req, host, now);
    return store.game.update((current) => {
      const time = clock();
      if (!canRead(current, host, room, time)) {
        return { result: gameState(null, req, host, time) };
      }
      if (!needsUpdate(current, time)) {
        return { result: gameState(current, req, host, time) };
      }
      revealIfExpired(current, time);
      if (cloud && host && current.phase !== 'finished') current.liveUntil = time + leaseMs;
      return { next: current, result: gameState(current, req, host, time) };
    });
  }

  async function removePhotos(ids, timeoutMs) {
    let timedOut = false;
    let timer;
    const cleanup = async () => {
      for (let start = 0; start < ids.length && !timedOut; start += 12) {
        const results = await Promise.allSettled(ids.slice(start, start + 12).map((id) => store.photos.remove(id)));
        if (results.some((result) => result.status === 'rejected')) {
          console.error('Some photos could not be removed. Bucket lifecycle cleanup will retry.');
        }
      }
    };
    if (!timeoutMs || !ids.length) return cleanup();
    try {
      await Promise.race([cleanup(), new Promise((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          console.warn('Photo cleanup reached its request limit. The bucket lifecycle will remove remaining objects.');
          resolve();
        }, timeoutMs);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    const ticket = url.searchParams.get('room');
    const room = cloud ? verifyRoom(ticket) : null;
    if (allowWidget(req, res, route)) return;

    if (preview && isLoopback(req)) {
      const page = await preview.resolve(req, url);
      if (page) return reply(res, page.status, page.body, page.type);
    }

    if (req.method === 'GET') {
      if (staticRoutes.has(route)) {
        const [file, type] = staticRoutes.get(route);
        return reply(res, 200, fs.readFileSync(path.join(publicDir, file)), type);
      }
      if (route === '/api/state') return json(res, 200, await getState(req, isHost(req), room));
      if (route === '/api/local-host' && !cloud) {
        if (!isLoopback(req)) {
          throw new RequestError(403, 'Enter the host code shown in the server terminal.');
        }
        return json(res, 200, { code: hostCode });
      }
      if (route === '/qr.svg' && (!cloud || room)) {
        const qr = localQr || makeQrSvg(origin + '/join?room=' + ticket);
        return reply(res, 200, qr, 'image/svg+xml');
      }
      if (route.startsWith('/photo/') && (!cloud || room)) {
        const game = await store.game.read();
        const photo = canRead(game, false, room, clock()) && activePhoto(game);
        if (photo && route === '/photo/' + photo.id) {
          const bytes = await store.photos.get(photo.id);
          if (bytes) return reply(res, 200, bytes, 'image/jpeg');
        }
      }
    }

    if (req.method === 'POST') {
      if (route === '/api/stop') {
        if (!isHost(req)) throw new RequestError(403, 'Check your host code.');
        const { gameId } = await readJson(req);
        const { state, removed } = await store.game.update((game) => {
          const now = clock();
          if (!isLive(game, now) || game.id !== gameId) {
            throw new RequestError(409, 'The TV has already moved on.');
          }
          if (game.phase === 'finished') {
            return { result: { state: gameState(game, req, true, now), removed: [] } };
          }
          const removed = finishGame(game);
          game.stopped = true;
          if (cloud) game.liveUntil = now + leaseMs;
          return { next: game, result: { state: gameState(game, req, true, now), removed } };
        });
        await removePhotos(removed, cloud ? 4000 : undefined);
        return json(res, 200, state);
      }

      if (route === '/api/advance') {
        if (!isHost(req)) throw new RequestError(403, 'Check your host code.');
        const { gameId, phase, round } = await readJson(req);
        const { state, removed } = await store.game.update((game) => {
          const now = clock();
          const reopeningFinished = phase === 'finished' &&
            (!game || (game.id === gameId && game.phase === 'finished'));
          if (cloud && !isLive(game, now) && (phase === 'setup' || reopeningFinished)) {
            const next = newGame(now);
            return { next, result: { state: gameState(next, req, true, now), removed: [] } };
          }
          if (!isLive(game, now) || game.id !== gameId ||
              (activePhoto(game) ? game.index + 1 : undefined) !== round) {
            throw new RequestError(409, 'The TV has already moved on.');
          }
          const expired = revealIfExpired(game, now);
          if (game.phase === 'reveal' && phase === 'voting') {
            return {
              next: expired ? game : undefined,
              result: { state: gameState(game, req, true, now), removed: [] }
            };
          }
          if (game.phase !== phase) throw new RequestError(409, 'The TV has already moved on.');
          const removed = advance(game, now);
          const next = phase === 'finished' ? newGame(now) : game;
          if (cloud) next.liveUntil = now + leaseMs;
          return { next, result: { state: gameState(next, req, true, now), removed } };
        });
        await removePhotos(removed);
        return json(res, 200, state);
      }

      if (cloud && !room) {
        throw new RequestError(410, 'Scan the QR code on the TV to join a game.');
      }

      if (route === '/api/join') {
        const { name: submittedName } = await readJson(req);
        const name = typeof submittedName === 'string' ? submittedName.trim() : '';
        if (!name || name.length > 24) throw new RequestError(400, 'Use a name of 1 to 24 characters.');
        const token = await store.game.update((game) => {
          requireRoom(game, room, clock());
          if (game.phase !== 'lobby') throw new RequestError(409, 'Wait for the next game to join.');
          if (game.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
            throw new RequestError(409, 'That name is taken.');
          }
          if (game.players.length >= 12) throw new RequestError(409, 'This game has reached 12 players.');
          const player = { id: randomUUID(), token: randomUUID(), name, uploads: 0, score: 0 };
          game.players.push(player);
          return { next: game, result: player.token };
        });
        return json(res, 201, { token });
      }

      if (route === '/api/photo') {
        if (req.headers['content-type'] !== 'image/jpeg') {
          throw new RequestError(415, 'Choose a photo that your browser can open.');
        }
        const game = await store.game.read();
        requireUpload(game, req, room, clock());
        const bytes = await readBody(req, maxPhotoSize);
        if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 ||
            bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) {
          throw new RequestError(415, 'That photo could not be read.');
        }
        const id = randomUUID();
        await store.photos.put(id, bytes);
        try {
          const uploads = await store.game.update((current) => {
            const player = requireUpload(current, req, room, clock());
            current.photos.push({ id, ownerId: player.id });
            player.uploads++;
            return { next: current, result: player.uploads };
          });
          return json(res, 201, { uploads });
        } catch (error) {
          if (error instanceof RequestError) await removePhotos([id]);
          throw error;
        }
      }

      if (route === '/api/vote') {
        const { gameId, round, guess } = await readJson(req);
        const state = await store.game.update((game) => {
          const now = clock();
          requireRoom(game, room, now);
          const player = requirePlayer(game, req);
          if (game.phase !== 'voting' || game.voteDeadline <= now || game.id !== gameId || game.index + 1 !== round) {
            throw new RequestError(409, 'Voting is closed for that round.');
          }
          if (activePhoto(game).ownerId === player.id || Object.hasOwn(game.votes, player.id)) {
            throw new RequestError(409, 'You cannot vote twice or vote on your own photo.');
          }
          if (!game.players.some((candidate) => candidate.id === guess)) {
            throw new RequestError(400, 'Choose a player in this game.');
          }
          game.votes[player.id] = guess;
          return { next: game, result: gameState(game, req, false, now) };
        });
        return json(res, 200, state);
      }
    }
    throw new RequestError(404, 'Page not found.');
  };
}

async function start(development) {
  const cloud = !development && Boolean(process.env.PHOTO_BUCKET);
  const listenPort = development ? Number(process.env.PORT || 3100) : port;
  const origin = development ? 'http://127.0.0.1:' + listenPort : cloud ? process.env.PUBLIC_ORIGIN : lanUrl;
  const hostCode = cloud ? process.env.PHOTO_HOST_CODE : randomBytes(4).toString('hex');
  if (cloud && (!origin || !/^https:\/\/[^/]+$/.test(origin) || !/^[a-f0-9]{24,64}$/.test(hostCode || ''))) {
    throw new Error('Cloud mode requires PUBLIC_ORIGIN and a strong PHOTO_HOST_CODE.');
  }
  const store = cloud
    ? cloudStorage(process.env.GOOGLE_CLOUD_PROJECT, process.env.PHOTO_DATABASE, process.env.PHOTO_BUCKET)
    : memoryStorage();
  const preview = development ? require('./dev/preview').createPreview(store, newGame) : undefined;
  if (preview) await preview.reset();
  else if (!cloud) await store.game.update(() => ({ next: newGame(Date.now()) }));
  const handle = createHandler({ store, origin, cloud, hostCode, preview });
  http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (error instanceof RequestError) return json(res, error.status, { error: error.message });
      console.error('Game request failed:', error.code || error.name);
      if (!res.headersSent && !res.destroyed) json(res, 500, { error: 'Something went wrong.' });
    });
  }).on('error', (error) => {
    console.error('Could not start the game server on port ' + listenPort + ' (' + error.code + ').');
    process.exitCode = 1;
  }).listen(listenPort, development ? '127.0.0.1' : '0.0.0.0', () => {
    if (development) {
      console.log('Sticker Party preview: ' + origin + '/preview');
      return;
    }
    console.log('Photo Guess TV: ' + origin + '/tv');
    if (!cloud) {
      console.log('Local URL: http://127.0.0.1:' + port);
      console.log('Join:      ' + origin + '/join');
      console.log('Host code: ' + hostCode);
    }
  });
}

if (require.main === module) {
  start(process.argv.includes('--preview')).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createHandler, newGame, RequestError };
