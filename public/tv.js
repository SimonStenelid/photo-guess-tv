'use strict';

var serverOrigin = window.photoGuessServer || '';
var cloudHostKey = 'photoGuessHost:' + (serverOrigin || location.origin);
var code = localStorage.getItem(cloudHostKey) || sessionStorage.getItem('photoGuessHost') || '';
var screen = byId('screen');
var stage = byId('stage');
var action = byId('advance');
var lobbyAction = byId('lobby-action');
var stopGame = byId('stop-game');
var stopConfirmation = byId('stop-confirmation');
var keepPlaying = byId('keep-playing');
var confirmStop = byId('confirm-stop');
var hostForm = byId('host-form');
var notice = byId('notice');
var gameAudio = createStickerAudio(byId('game-sound'));
var latest;
var fingerprint;
var countdown;
var voteCounter;
var countdownEnd = 0;
var connectionNotice = serverOrigin.indexOf('https://') === 0 || location.protocol === 'https:'
  ? 'Connection lost. Check the TV’s internet connection.'
  : 'Connection lost. Check that the game server is running.';
var wakePolling;
var advancing = false;

function canStop(state) {
  return state.host && ['lobby', 'voting', 'reveal'].indexOf(state.phase) !== -1;
}

function canAdvance(state) {
  return state.phase !== 'lobby' ||
    (state.players.length >= 2 && state.photoCount > 0 &&
      state.players.every(function (player) { return player.hasPhotos !== false; }));
}

function closeStopConfirmation() {
  stopConfirmation.hidden = true;
  stopGame.hidden = !latest || !canStop(latest);
}

function updateCountdown() {
  if (!countdown) return;
  var seconds = Math.max(0, Math.ceil((countdownEnd - performance.now()) / 1000));
  gameAudio.tick(seconds);
  var label = String(seconds).padStart(2, '0');
  if (countdown.textContent !== label) countdown.textContent = label;
}

window.setInterval(updateCountdown, 100);

function scoreboard(players) {
  var board = make('ol', null, 'scoreboard');
  players.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (player) {
    var row = make('li');
    row.appendChild(make('span', player.name));
    row.appendChild(make('strong', String(player.score)));
    board.appendChild(row);
  });
  return board;
}

function updateVotes(state) {
  if (voteCounter) voteCounter.textContent = state.votesIn + ' of ' + state.votesExpected + ' votes';
}

function lobby(state, waitingForPhotos) {
  var intro = make('div', null, 'lobby-intro');
  intro.appendChild(mascot(state.host && !action.disabled ? 'ready' : 'idle'));
  intro.appendChild(make('h1', 'Join the game'));
  var maxPhotos = state.photoLimits ? state.photoLimits.max : 100;
  intro.appendChild(make('p', 'Share 1–' + maxPhotos + ' photos each.', 'lede'));
  var names = make('ul', null, 'names');
  state.players.forEach(function (player) {
    names.appendChild(make('li', player.name));
  });
  var photosShared = state.photoCount === 1 ? ' photo shared' : ' photos shared';
  intro.appendChild(make('p', state.players.length + ' joined · ' + state.photoCount + photosShared, 'count'));
  if (state.host && action.disabled) {
    if (state.players.length < 2) {
      intro.appendChild(make('p', state.players.length === 0
        ? 'Waiting for two players to join.' : 'Waiting for one more player to join.', 'notice'));
    }
    if (waitingForPhotos.length) {
      var namesWithoutPhotos = waitingForPhotos.map(function (player) { return player.name; });
      intro.appendChild(make('p', 'Waiting for a photo from ' + namesWithoutPhotos.join(', ') + '.', 'notice'));
    }
  }
  intro.appendChild(names);

  var join = make('div', null, 'join-card');
  var qr = make('img');
  qr.src = serverOrigin + (state.qrUrl || '/qr.svg');
  qr.alt = 'QR code to join the game';
  join.appendChild(qr);
  join.appendChild(make('strong', 'Scan to join'));
  var link = make(serverOrigin ? 'span' : 'a', state.joinUrl, 'join-address');
  if (!serverOrigin) link.href = state.joinUrl;
  join.appendChild(link);
  screen.appendChild(intro);
  screen.appendChild(join);
}

function showRound(state, photo) {
  var revealing = state.phase === 'reveal';
  var owner = state.players.find(function (player) { return player.id === state.ownerId; });
  var photoUrl = serverOrigin + state.photoUrl;
  if (!photo || photo.getAttribute('src') !== photoUrl) {
    photo = make('img', null, 'round-photo');
    photo.src = photoUrl;
    photo.alt = 'The photo for round ' + state.round;
  }
  var frame = make('div', null, 'photo-frame');
  frame.appendChild(photo);
  screen.appendChild(frame);

  var aside = make('div', null, 'round-info');
  aside.appendChild(mascot(revealing ? 'celebrate' : 'thinking'));
  aside.appendChild(make('h1', revealing && owner ? owner.name + ' shared this.' : 'Whose photo?'));
  if (revealing) {
    if (state.host) aside.appendChild(scoreboard(state.players));
  } else {
    countdown = make('p', null, 'countdown');
    countdown.setAttribute('aria-live', 'off');
    aside.appendChild(countdown);
    updateCountdown();
    voteCounter = make('p', null, 'vote-counter');
    updateVotes(state);
    aside.appendChild(voteCounter);
  }
  aside.appendChild(action);
  screen.appendChild(aside);
}

function render(state) {
  if (!canStop(state) || (latest && latest.gameId !== state.gameId)) closeStopConfirmation();
  latest = state;
  gameAudio.update(state);
  countdownEnd = performance.now() + (state.voteTimeLeftMs || 0);
  var current = JSON.stringify(Object.assign({}, state, { voteTimeLeftMs: undefined, votesIn: undefined }));
  if (fingerprint === current) {
    updateCountdown();
    updateVotes(state);
    return;
  }
  fingerprint = current;
  countdown = null;
  voteCounter = null;

  var lobbyOpen = state.phase === 'lobby';
  var waitingForPhotos = lobbyOpen ? state.players.filter(function (player) {
    return player.hasPhotos === false;
  }) : [];
  var finished = state.phase === 'finished';
  var waiting = state.phase === 'setup' || state.phase === 'closed';
  stage.textContent = lobbyOpen || waiting ? 'Lobby' : finished ? 'Final scores' : 'Round ' + state.round + ' of ' + state.photoCount;
  action.hidden = !state.host;
  stopGame.hidden = !canStop(state) || !stopConfirmation.hidden;
  hostForm.hidden = state.host;
  action.disabled = !stopConfirmation.hidden || !canAdvance(state);
  var labels = { setup: 'New game', lobby: 'Start game', voting: 'Reveal answer', reveal: 'Next round', finished: 'New game' };
  action.textContent = state.phase === 'reveal' && state.round === state.photoCount
    ? 'Finish game' : labels[state.phase];
  screen.className = 'tv-screen ' + (lobbyOpen ? 'lobby' : finished || waiting ? 'finished' : 'round') +
    (state.phase === 'reveal' ? ' round--reveal' : '');
  var existingPhoto = screen.querySelector('.round-photo');
  var restoreFocus = document.activeElement === action;
  lobbyAction.appendChild(action);
  screen.textContent = '';

  if (waiting) {
    screen.appendChild(mascot('idle'));
    screen.appendChild(make('h1', 'Photo Guess'));
    if (!state.host) screen.appendChild(make('p', 'Enter your host code.', 'lede'));
  } else if (lobbyOpen) {
    lobby(state, waitingForPhotos);
    if (state.host && !action.disabled && document.activeElement === document.body) action.focus();
  } else if (finished) {
    screen.appendChild(mascot('celebrate'));
    if (state.host) {
      var bestScore = Math.max.apply(null, state.players.map(function (player) { return player.score; }));
      var winners = state.players.filter(function (player) { return player.score === bestScore; });
      var heading = winners.map(function (player) { return player.name; }).join(', ');
      screen.appendChild(make('h1', state.stopped ? 'Game stopped' : heading + (winners.length > 1 ? ' tie.' : ' wins.')));
      if (state.players.length) screen.appendChild(scoreboard(state.players));
    } else {
      screen.appendChild(make('h1', 'Game over'));
    }
  } else {
    showRound(state, existingPhoto);
  }
  if ((restoreFocus || (serverOrigin && document.activeElement === document.body)) && !action.hidden && !action.disabled) {
    action.focus();
  }
}

function refresh() {
  var sentCode = code;
  var startingState = latest;
  return request(serverOrigin + '/api/state', { headers: { 'X-Host-Code': sentCode } }).then(function (state) {
    if (sentCode !== code || startingState !== latest) return;
    if (notice.textContent === connectionNotice) notice.textContent = '';
    render(state);
  }).catch(function () {
    notice.textContent = connectionNotice;
  });
}

hostForm.addEventListener('submit', function (event) {
  event.preventDefault();
  gameAudio.unlock();
  var input = byId('host-code');
  var candidate = input.value.trim().toLowerCase();
  request(serverOrigin + '/api/state', { headers: { 'X-Host-Code': candidate } }).then(function (state) {
    if (!state.host) throw new Error('Check your host code.');
    code = candidate;
    if (state.cloud) localStorage.setItem(cloudHostKey, code);
    else sessionStorage.setItem('photoGuessHost', code);
    input.value = '';
    notice.textContent = '';
    render(state);
    wakePolling();
    action.focus();
  }).catch(function (error) {
    notice.textContent = error.message;
  });
});

function hostAction(route, data) {
  advancing = true;
  notice.textContent = '';
  return post(serverOrigin + route, data, { 'X-Host-Code': code }).then(function (state) {
    render(state);
    wakePolling();
  }).catch(function (error) {
    notice.textContent = error.message;
    return refresh();
  }).then(function () {
    advancing = false;
  });
}

action.addEventListener('click', function () {
  if (advancing || !latest || action.hidden || action.disabled || !stopConfirmation.hidden) return;
  gameAudio.unlock();
  hostAction('/api/advance', { gameId: latest.gameId, phase: latest.phase, round: latest.round });
});

stopGame.addEventListener('click', function () {
  if (advancing || !latest || !canStop(latest)) return;
  stopGame.hidden = true;
  stopConfirmation.hidden = false;
  action.disabled = true;
  keepPlaying.focus();
});

keepPlaying.addEventListener('click', function () {
  if (advancing) return;
  closeStopConfirmation();
  action.disabled = !canAdvance(latest);
  if (!stopGame.hidden) stopGame.focus();
});

confirmStop.addEventListener('click', function () {
  if (advancing || !latest || !canStop(latest) || stopConfirmation.hidden) return;
  hostAction('/api/stop', { gameId: latest.gameId }).then(function () {
    if (latest.phase === 'finished') action.focus();
  });
});

document.addEventListener('keydown', function (event) {
  if ((event.key !== 'Enter' && event.keyCode !== 13) || event.repeat ||
      action.hidden || action.disabled || !stopConfirmation.hidden || event.target.closest('a, input, button')) return;
  event.preventDefault();
  action.click();
});

function startPolling() {
  wakePolling = poll(refresh, function () {
    return !document.hidden && (!latest || (!latest.stopped && !latest.cloud) ||
      ['closed', 'setup', 'finished'].indexOf(latest.phase) === -1);
  });
  document.addEventListener('visibilitychange', wakePolling);
}

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  request('/api/local-host').then(function (result) {
    code = result.code;
  }).catch(function () {}).then(startPolling);
} else {
  startPolling();
}
