'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '../public/audio.js'), 'utf8');

function harness(preference) {
  const sources = [];
  const voices = [];
  const storage = new Map(preference ? [['photoGuessSoundMuted', preference]] : []);
  const document = {
    hidden: false,
    addEventListener(name, fn) { this[name] = fn; }
  };
  const button = { addEventListener(name, fn) { this[name] = fn; } };
  class Context {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    async resume() { this.state = 'running'; }
    createGain() {
      return { gain: { setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
    createBuffer(channels, length, rate) {
      const samples = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => samples };
    }
    createBufferSource() {
      const source = { connect() {}, start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(source);
      return source;
    }
    createOscillator() {
      const oscillator = { frequency: {}, connect() {}, disconnect() {},
        start(time) { this.startsAt = time; }, stop(time) { if (time === undefined) this.muted = true; } };
      voices.push(oscillator);
      return oscillator;
    }
  }
  const localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const scope = vm.createContext({ window: { AudioContext: Context }, document, localStorage });
  vm.runInContext(script, scope);
  return { scope, sources, voices, storage, document, button, audio: scope.createStickerAudio(button) };
}

const lobby = { host: true, gameId: 'one', phase: 'lobby', players: [{ id: 'a' }] };
const voting = { ...lobby, phase: 'voting', round: 1, votesIn: 0 };

test('the original loop is about 37 seconds, audible and unclipped', () => {
  const { scope } = harness();
  const pcm = scope.renderStickerMusic();
  assert.ok(Math.abs(pcm.length / 24000 - 36.923) < .01);
  let peak = 0;
  let energy = 0;
  for (const sample of pcm) {
    assert.ok(Number.isFinite(sample));
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  assert.ok(peak < 1 && peak > .2);
  assert.ok(energy / pcm.length > .006);
  assert.ok(Math.abs(pcm[0] - pcm.at(-1)) < .001);
});

test('music plays through the match, while polls do not repeat cues', async () => {
  const { audio, sources, voices } = harness();
  audio.update(lobby);
  assert.equal(sources.length, 0);
  await audio.unlock();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].loop, true);
  audio.update({ ...lobby, players: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(voices.length, 2);
  audio.update(voting);
  assert.equal(voices.length, 5);
  audio.update({ ...voting, votesIn: 1 });
  assert.equal(voices.length, 6);
  audio.update({ ...voting, votesIn: 1 });
  for (const second of [4, 3, 3, 2, 3, 2, 1, 0]) audio.tick(second);
  assert.equal(voices.length, 9);
  audio.update({ ...voting, phase: 'reveal' });
  assert.equal(voices.length, 13);
  assert.equal(sources.length, 1);
  audio.update({ ...voting, phase: 'finished', stopped: true });
  assert.equal(voices.length, 15);
  assert.equal(sources[0].stopped, true);
});

test('mute cancels pending cues and persists, and hidden tabs go quiet', async () => {
  const { audio, button, sources, voices, storage, document } = harness('true');
  audio.update(lobby);
  assert.equal(await audio.unlock(), false);
  assert.equal(sources.length, 0);
  button.click();
  await Promise.resolve();
  assert.equal(button.textContent, 'Mute');
  audio.play('tick', 2);
  button.click();
  assert.equal(voices[0].muted, true);
  assert.equal(storage.get('photoGuessSoundMuted'), 'true');
  assert.equal(sources[0].stopped, true);
  button.click();
  await Promise.resolve();
  assert.equal(sources.length, 2);
  document.hidden = true;
  document.visibilitychange();
  assert.equal(sources[1].stopped, true);
  audio.play('vote');
  assert.equal(voices.length, 1);
});
