'use strict';

var stickerSampleRate = 24000;
var stickerBeat = 60 / 104;
var stickerBars = [
  { bass: 48, chord: [60, 64, 67], tune: [76, 79, null, 76, 74, null, 72, null] },
  { bass: 45, chord: [57, 60, 64], tune: [72, null, 76, 79, null, 76, 72, null] },
  { bass: 41, chord: [57, 60, 65], tune: [77, null, 76, 72, 74, null, 72, null] },
  { bass: 43, chord: [55, 59, 65], tune: [71, 74, null, 77, 76, null, 74, null] },
  { bass: 48, chord: [60, 64, 67], tune: [76, null, 79, 81, null, 79, 76, null] },
  { bass: 45, chord: [57, 60, 64], tune: [72, 76, null, 79, 81, null, 79, null] },
  { bass: 41, chord: [57, 60, 65], tune: [77, 76, 72, null, 77, 79, null, 77] },
  { bass: 43, chord: [55, 59, 65], tune: [74, null, 71, 74, 72, null, null, null] },
  { bass: 48, chord: [60, 64, 67], tune: [67, null, 72, 76, null, 79, null, 76] },
  { bass: 40, chord: [55, 60, 64], tune: [74, null, 72, 71, null, 67, 71, null] },
  { bass: 41, chord: [57, 60, 65], tune: [72, null, 77, 81, 79, null, 77, null] },
  { bass: 43, chord: [55, 59, 65], tune: [74, null, 71, 67, null, 71, 74, null] },
  { bass: 45, chord: [57, 60, 64], tune: [76, 79, null, 81, 84, null, 81, null] },
  { bass: 41, chord: [57, 60, 65], tune: [77, null, 81, 79, 76, null, 72, null] },
  { bass: 43, chord: [55, 60, 65], tune: [74, 77, null, 76, 74, null, 71, null] },
  { bass: 43, chord: [55, 59, 62], tune: [72, null, 76, 74, 72, null, null, null] }
];

var stickerCues = {
  join: [[0, 76, .09, .13], [.064, 84, .12, .11]],
  vote: [[0, 79, .085, .08]],
  round: [[0, 67, .12, .12], [.085, 72, .15, .10], [.16, 76, .19, .10]],
  tick: [[0, 77, .06, .095]],
  lastTick: [[0, 81, .075, .13]],
  reveal: [[0, 72, .15, .16], [.078, 76, .16, .12], [.158, 79, .19, .13], [.236, 84, .34, .13]],
  finish: [[0, 72, .15, .12], [.10, 76, .15, .12], [.20, 79, .19, .12], [.33, 84, .37, .13], [.33, 79, .36, .065]],
  stop: [[0, 76, .13, .11], [.095, 72, .22, .10]]
};

function stickerFrequency(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function renderStickerMusic() {
  var samples = new Float32Array(Math.round(stickerBars.length * 4 * stickerBeat * stickerSampleRate));
  var seed = 7307;

  function note(at, midi, seconds, level, overtone) {
    var offset = Math.round(at * stickerSampleRate);
    var length = Math.round(seconds * stickerSampleRate);
    var step = 2 * Math.PI * stickerFrequency(midi) / stickerSampleRate;
    for (var i = 0; i < length; i++) {
      var position = i / length;
      var envelope = Math.min(1, i / 95) * (1 - position) * (1 - position);
      var wave = Math.sin(i * step) + overtone * Math.sin(i * step * 2);
      samples[(offset + i) % samples.length] += level * envelope * wave;
    }
  }

  function brush(at, level) {
    var offset = Math.round(at * stickerSampleRate);
    for (var i = 0; i < 870; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[(offset + i) % samples.length] +=
        level * (seed / 4294967296 - .5) * Math.min(1, i / 22) * Math.pow(1 - i / 870, 3);
    }
  }

  stickerBars.forEach(function (bar, index) {
    var at = index * 4 * stickerBeat;
    note(at, bar.bass, .43, .35, .11);
    note(at + stickerBeat * 2, bar.bass + 7, .33, .26, .10);
    bar.chord.forEach(function (pitch, voice) {
      note(at + stickerBeat * 1.12 + voice * .013, pitch, .31, .105, .20);
      note(at + stickerBeat * 3.12 + voice * .013, pitch, .27, .088, .20);
    });
    bar.tune.forEach(function (pitch, i) {
      if (pitch === null) return;
      var stagger = i % 2 ? .57 : 0;
      note(at + (Math.floor(i / 2) + stagger) * stickerBeat, pitch, .33, .24, .25);
    });
    [0.55, 1.55, 2.55, 3.55].forEach(function (beat, i) {
      brush(at + beat * stickerBeat, i % 2 ? .14 : .075);
    });
  });
  return samples;
}

function createStickerAudio(button) {
  var Context = window.AudioContext || window.webkitAudioContext;
  var preference = 'photoGuessSoundMuted';
  var muted = localStorage.getItem(preference) === 'true';
  var context;
  var output;
  var musicGain;
  var musicBuffer;
  var music;
  var musicStarted;
  var musicOffset = 0;
  var outputLevel;
  var musicLevel;
  var state;
  var lowestSecond = Infinity;
  var voices = [];

  function label() {
    if (!button) return;
    var on = Boolean(context && context.state === 'running' && !muted);
    button.hidden = !Context;
    button.textContent = on ? 'Mute' : 'Enable sound';
    button.className = on ? 'sound-on' : '';
  }

  function audible() {
    return context && context.state === 'running' && !muted && !document.hidden;
  }

  function sync() {
    if (!context) return;
    var at = context.currentTime;
    var heard = audible();
    var level = heard ? 1 : 0;
    if (level !== outputLevel) {
      output.gain.setTargetAtTime(level, at, .025);
      outputLevel = level;
    }
    if (!heard) {
      voices.forEach(function (voice) { voice.stop(); });
      voices = [];
    }
    var playing = heard && state && state.host &&
      ['lobby', 'voting', 'reveal'].indexOf(state.phase) !== -1;
    if (!playing) {
      if (music) {
        musicOffset = (musicOffset + at - musicStarted) % musicBuffer.duration;
        music.stop();
        music = null;
      }
      return;
    }
    var mix = state.phase === 'reveal' ? .11 : .19;
    if (mix !== musicLevel) {
      musicGain.gain.setTargetAtTime(mix, at, .12);
      musicLevel = mix;
    }
    if (music) return;
    if (!musicBuffer) {
      var samples = renderStickerMusic();
      musicBuffer = context.createBuffer(1, samples.length, stickerSampleRate);
      musicBuffer.getChannelData(0).set(samples);
    }
    music = context.createBufferSource();
    music.buffer = musicBuffer;
    music.loop = true;
    music.connect(musicGain);
    musicStarted = context.currentTime;
    music.start(0, musicOffset);
  }

  function unlock() {
    if (!Context || muted) return Promise.resolve(false);
    try {
      if (!context) {
        context = new Context();
        output = context.createGain();
        musicGain = context.createGain();
        output.gain.value = 0;
        musicGain.gain.value = .19;
        musicGain.connect(output);
        output.connect(context.destination);
        context.onstatechange = function () { label(); sync(); };
      }
      return (context.state === 'running' ? Promise.resolve() : context.resume()).then(function () {
        label();
        sync();
        return context.state === 'running';
      }).catch(function () { label(); return false; });
    } catch (error) {
      return Promise.resolve(false);
    }
  }

  function play(name, delay) {
    if (!audible() || !stickerCues[name]) return;
    var start = context.currentTime + (delay || 0);
    stickerCues[name].forEach(function (note) {
      var time = start + note[0];
      var voice = context.createOscillator();
      var envelope = context.createGain();
      voice.type = name === 'tick' || name === 'vote' ? 'sine' : 'triangle';
      voice.frequency.value = stickerFrequency(note[1]);
      envelope.gain.setValueAtTime(.0001, time);
      envelope.gain.exponentialRampToValueAtTime(note[3], time + .012);
      envelope.gain.exponentialRampToValueAtTime(.0001, time + note[2]);
      voice.connect(envelope);
      envelope.connect(output);
      voices.push(voice);
      voice.onended = function () {
        voices = voices.filter(function (active) { return active !== voice; });
        voice.disconnect();
        envelope.disconnect();
      };
      voice.start(time);
      voice.stop(time + note[2]);
    });
  }

  function update(next) {
    var previous = state;
    state = next;
    if (!previous || next.gameId !== previous.gameId || next.round !== previous.round) lowestSecond = Infinity;
    sync();
    if (!previous || !previous.host || !next.host || previous.gameId !== next.gameId) return;
    if (next.phase !== previous.phase || next.round !== previous.round) {
      if (next.phase === 'voting') play('round');
      else if (next.phase === 'reveal') play('reveal');
      else if (next.phase === 'finished') play(next.stopped ? 'stop' : 'finish');
    } else if (next.phase === 'lobby' && next.players.length > previous.players.length) {
      play('join');
    } else if (next.phase === 'voting' && next.votesIn > previous.votesIn) {
      play('vote');
    }
  }

  function tick(seconds) {
    if (!state || !state.host || state.phase !== 'voting' || seconds >= lowestSecond) return;
    lowestSecond = seconds;
    if (seconds > 0 && seconds <= 3) play(seconds === 1 ? 'lastTick' : 'tick');
  }

  if (button) button.addEventListener('click', function () {
    if (context && context.state === 'running' && !muted) {
      muted = true;
      localStorage.setItem(preference, 'true');
      sync();
      label();
    } else {
      muted = false;
      localStorage.setItem(preference, 'false');
      unlock();
    }
  });
  document.addEventListener('visibilitychange', sync);
  label();
  return { unlock: unlock, update: update, tick: tick, play: play };
}
