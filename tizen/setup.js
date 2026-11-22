'use strict';

(function () {
  var settings = byId('server-settings');
  var form = byId('server-form');
  var address = byId('server-address');
  var notice = byId('notice');
  var addressKey = 'photoGuessServer:' + window.photoGuessDefaultAddress;
  function serverOrigin(value) {
    var server = new URL(value);
    if ((server.protocol !== 'http:' && server.protocol !== 'https:') ||
        server.username || server.password || server.search || server.hash ||
        ['/','/tv','/tv/'].indexOf(server.pathname) === -1) {
      throw new Error('Use the full TV screen address.');
    }
    return server.origin;
  }

  window.photoGuessServer = localStorage.getItem(addressKey) || serverOrigin(window.photoGuessDefaultAddress);
  settings.hidden = false;

  settings.addEventListener('click', function () {
    form.hidden = !form.hidden;
    if (!form.hidden) {
      address.value = window.photoGuessServer + '/tv';
      address.focus();
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    try {
      localStorage.setItem(addressKey, serverOrigin(address.value.trim()));
      sessionStorage.removeItem('photoGuessHost');
      location.reload();
    } catch (error) {
      notice.textContent = 'Use the full TV screen address.';
      address.focus();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.isComposing) return;
    var active = document.activeElement;
    var isInput = active.tagName === 'INPUT';

    if (event.keyCode === 10009 && !isInput && window.tizen) {
      event.preventDefault();
      if (!form.hidden) {
        form.hidden = true;
        settings.focus();
      } else {
        window.tizen.application.getCurrentApplication().exit();
      }
      return;
    }

    if (event.keyCode === 13 && active.tagName === 'BUTTON') {
      event.preventDefault();
      if (!event.repeat) active.click();
      return;
    }

    if (event.keyCode < 37 || event.keyCode > 40) return;
    if (isInput && (event.keyCode === 37 || event.keyCode === 39)) return;
    var controls = Array.prototype.filter.call(
      document.querySelectorAll('.tv-shell button, .tv-shell input'),
      function (control) { return !control.disabled && !control.closest('[hidden]'); }
    );
    if (!controls.length) return;

    event.preventDefault();
    var direction = event.keyCode === 37 || event.keyCode === 38 ? -1 : 1;
    var current = controls.indexOf(active);
    var next = current === -1 ? 0 : (current + direction + controls.length) % controls.length;
    controls[next].focus();
  });
})();
