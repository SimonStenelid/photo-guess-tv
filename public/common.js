'use strict';

function byId(id) {
  return document.getElementById(id);
}

function make(tag, text, className) {
  var node = document.createElement(tag);
  if (typeof text === 'string') node.textContent = text;
  if (className) node.className = className;
  return node;
}

function request(url, options) {
  return fetch(url, options).then(function (response) {
    return response.json().then(function (data) {
      if (!response.ok) throw new Error(data.error || 'The request failed.');
      return data;
    });
  });
}

function post(url, data, headers) {
  return request(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify(data)
  });
}

function poll(refresh, shouldContinue) {
  var pending = false;
  function wake() {
    if (pending || (shouldContinue && !shouldContinue())) return;
    pending = true;
    refresh().then(schedule, schedule);
  }
  function schedule() {
    if (shouldContinue && !shouldContinue()) {
      pending = false;
      return;
    }
    window.setTimeout(function () {
      pending = false;
      wake();
    }, 1000);
  }
  wake();
  return wake;
}
