(function () {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  let csrfToken = '';

  window.setCsrfToken = function setCsrfToken(token) {
    csrfToken = typeof token === 'string' ? token : '';
  };

  window.fetch = function securedFetch(input, init) {
    const options = { ...(init || {}) };
    const method = String(options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
      const headers = new Headers(options.headers || {});
      headers.set('X-CSRF-Token', csrfToken);
      options.headers = headers;
    }
    return nativeFetch(input, options);
  };
}());
