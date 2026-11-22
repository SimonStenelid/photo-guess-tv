'use strict';

var room = new URLSearchParams(location.search).get('room');
var roomQuery = room ? '?room=' + encodeURIComponent(room) : '';
var local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
var demo = local ? new URLSearchParams(location.search).get('demo') : null;
var playerKey = 'photoGuessPlayer' + (room ? ':' + room : demo ? ':demo:' + demo : '');
var token = sessionStorage.getItem(playerKey) || '';
var joinForm = byId('join-form');
var uploadForm = byId('upload-form');
var choices = byId('choices');
var notice = byId('notice');
var photos = byId('photos');
var resultBadge = byId('round-result');
var sticker = mascot('idle');
byId('phone-mascot').appendChild(sticker);
var latest;
var fingerprint;
var pending = false;
var shownResult;
var resultTimer;
var connectionNotice = 'Connection lost. Retrying…';

var outcomes = {
  correct: { label: '+1 point', mood: 'right' },
  incorrect: { label: 'No point', mood: 'wrong' },
  'own-photo': { label: 'Your photo', mood: 'ready' },
  'no-vote': { label: 'No vote', mood: 'still' }
};

function showFeedback(state, previous, baseMood, moment) {
  var me = state.me;
  var result = me && me.roundResult;
  var key = result && state.gameId + ':' + result.round;
  var missed = result && previous && previous.gameId === state.gameId && shownResult !== key;
  window.clearTimeout(resultTimer);
  resultBadge.hidden = true;
  if (state.stopped || !result || (state.phase !== 'reveal' && !missed)) {
    poseMascot(sticker, baseMood, moment);
    return;
  }

  var outcome = outcomes[result.outcome];
  var owner = state.players.find(function (player) { return player.id === result.ownerId; });
  shownResult = key;
  resultBadge.className = 'round-result round-result--' + result.outcome;
  resultBadge.textContent = state.phase !== 'reveal' && owner
    ? owner.name + ' shared round ' + result.round + ' · ' + outcome.label : outcome.label;
  resultBadge.hidden = false;
  poseMascot(sticker, outcome.mood, key + ':result');
  if (state.phase !== 'reveal') {
    resultTimer = window.setTimeout(function () {
      resultBadge.hidden = true;
      poseMascot(sticker, baseMood, moment);
    }, 2400);
  }
}

function playerHeaders() {
  return { 'X-Player-Token': token };
}

function render(state) {
  var previous = latest;
  latest = state;
  var current = JSON.stringify([state.gameId, state.phase, state.stopped, state.photoLimits, state.me, state.round, state.ownerId, state.players]);
  if (fingerprint === current) return;
  fingerprint = current;

  var me = state.me;
  var lobby = state.phase === 'lobby';
  var maxPhotos = state.photoLimits ? state.photoLimits.max : 100;
  byId('stage').textContent = me ? me.name : 'Join';
  joinForm.hidden = Boolean(me) || !lobby;
  uploadForm.hidden = !me || !lobby || me.uploads >= maxPhotos;
  choices.hidden = true;
  choices.textContent = '';
  var title;
  var instruction;
  var mood = 'idle';

  if (state.phase === 'closed') {
    title = 'Game closed';
    instruction = 'Scan the QR code on the TV to join.';
  } else if (!me) {
    title = lobby ? 'Join the game' : 'Game in progress';
    instruction = lobby ? '' : 'Join the next game.';
  } else if (lobby) {
    title = 'Share photos';
    mood = me.uploads ? 'ready' : 'idle';
    if (me.uploads === 0) {
      instruction = 'Choose 1–' + maxPhotos + ' photos.';
    } else {
      instruction = me.uploads + ' of ' + maxPhotos + ' shared. ' + (me.uploads >= maxPhotos
        ? '' : 'Add more before the game starts.');
    }
  } else if (state.phase === 'finished') {
    title = state.stopped ? 'Game stopped' : 'Game over';
    instruction = 'Final scores are on the TV.';
    mood = state.stopped ? 'still' : 'celebrate';
  } else if (state.phase === 'reveal') {
    var owner = state.players.find(function (player) { return player.id === state.ownerId; });
    title = owner ? owner.name + ' shared this.' : 'Answer revealed';
    instruction = '';
  } else {
    title = me.ownsPhoto ? 'Your photo' : me.voted ? 'Vote in' : 'Whose photo?';
    instruction = me.ownsPhoto ? 'Sit this round out.' : me.voted ? 'Watch the TV for the answer.' : 'Look at the TV, then pick a name.';
    mood = me.ownsPhoto ? 'still' : me.voted ? 'ready' : 'thinking';
    if (!me.ownsPhoto && !me.voted) {
      choices.hidden = false;
      choices.className = state.players.length > 4 ? 'choices choices--many' : 'choices';
      state.players.forEach(function (player) {
        var button = make('button', player.name);
        button.type = 'button';
        button.addEventListener('click', function () {
          perform(function () {
            return post('/api/vote' + roomQuery, {
              gameId: state.gameId,
              round: state.round,
              guess: player.id
            }, playerHeaders()).then(render);
          });
        });
        choices.appendChild(button);
      });
    }
  }

  byId('title').textContent = title;
  byId('instruction').textContent = instruction;
  showFeedback(state, previous, mood, [state.gameId, state.phase, state.round, mood].join(':'));
}

function refresh() {
  var startingState = latest;
  var sentToken = token;
  return request('/api/state' + roomQuery, { headers: playerHeaders() }).then(function (state) {
    if (sentToken !== token || startingState !== latest) return;
    if (notice.textContent === connectionNotice) notice.textContent = '';
    if (token && !state.me) {
      token = '';
      sessionStorage.removeItem(playerKey);
    }
    render(state);
  }).catch(function () {
    notice.textContent = connectionNotice;
  });
}

function perform(operation) {
  if (pending) return;
  pending = true;
  notice.textContent = '';
  operation().catch(function (error) {
    notice.textContent = error.message;
  }).then(function () {
    pending = false;
  });
}

joinForm.addEventListener('submit', function (event) {
  event.preventDefault();
  perform(function () {
    return post('/api/join' + roomQuery, { name: byId('name').value }).then(function (result) {
      token = result.token;
      sessionStorage.setItem(playerKey, token);
      return refresh();
    });
  });
});

function preparePhoto(file) {
  return new Promise(function (resolve, reject) {
    var image = new Image();
    var objectUrl = URL.createObjectURL(file);
    image.onload = function () {
      URL.revokeObjectURL(objectUrl);
      var ratio = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      var context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('That photo could not be prepared.'));
      }, 'image/jpeg', 0.82);
    };
    image.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('This browser could not open ' + file.name + '. Try a JPEG or PNG.'));
    };
    image.src = objectUrl;
  });
}

uploadForm.addEventListener('submit', function (event) {
  event.preventDefault();
  if (!latest || !latest.me) return;
  var files = Array.from(photos.files);
  if (!files.length) return;
  var remaining = (latest.photoLimits ? latest.photoLimits.max : 100) - latest.me.uploads;
  if (files.length > remaining) {
    notice.textContent = 'Choose up to ' + remaining + (remaining === 1 ? ' more photo.' : ' more photos.');
    return;
  }

  perform(function () {
    var button = uploadForm.querySelector('button');
    button.disabled = true;
    photos.disabled = true;
    var uploaded = 0;
    var skipped = 0;
    var upload = files.reduce(function (sequence, file, index) {
      return sequence.then(function () {
        notice.textContent = 'Sharing photo ' + (index + 1) + ' of ' + files.length + '…';
        return preparePhoto(file).then(function (blob) {
          return request('/api/photo' + roomQuery, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'image/jpeg' }, playerHeaders()),
            body: blob
          }).then(function () { uploaded++; });
        }, function () {
          skipped++;
        });
      });
    }, Promise.resolve());

    return upload.then(function () {
      notice.textContent = skipped
        ? uploaded + ' shared. ' + skipped + ' could not be opened. Try JPEG or PNG.'
        : uploaded + (uploaded === 1 ? ' photo shared.' : ' photos shared.');
    }, function (error) {
      notice.textContent = (uploaded ? uploaded + ' shared. ' : '') + error.message;
    }).then(function () {
      button.disabled = false;
      photos.disabled = false;
      photos.value = '';
      return refresh();
    });
  });
});

function startPhonePolling() {
  var wakePolling = poll(refresh, function () {
    return !document.hidden && (!latest || (!latest.stopped && !latest.cloud) ||
      (latest.phase !== 'finished' && latest.phase !== 'closed'));
  });
  document.addEventListener('visibilitychange', wakePolling);
}

if (demo) {
  request('/api/dev/player?demo=' + encodeURIComponent(demo)).then(function (result) {
    token = result.token;
    sessionStorage.setItem(playerKey, token);
  }).catch(function (error) {
    notice.textContent = error.message;
  }).then(startPhonePolling);
} else {
  startPhonePolling();
}
