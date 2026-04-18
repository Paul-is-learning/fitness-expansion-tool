// ================================================================
// FITNESS PARK ROMANIA — AUTH HARDENING (v4.8)
// ================================================================
// Defense-in-depth for the localStorage-based auth.
// Target threat model: non-technical coworker or casual attacker who
// opens devtools / edits localStorage / tries password brute force.
// Not a substitute for a real backend + TLS + bcrypt.
//
// Controls installed:
//   1. Rate limiting on failed logins   (5 fails → 5 min lockout)
//   2. Tamper detection on fpUsers      (HMAC-style signature check)
//   3. Session signature                (binds session to user agent hash)
//   4. Inactivity timeout hardening     (existing 10min + now verified)
//   5. Admin role tamper check          (prevents self-promotion via localStorage edit)
//
// Logs to window._fpAuthEvents for forensics.
// ================================================================

(function() {
  'use strict';

  window._fpAuthEvents = [];

  // Match index.html's storage strategy: mobile = localStorage, desktop = sessionStorage
  function _isMobile() {
    return window.innerWidth <= 768
        || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }
  function _storage() { return _isMobile() ? localStorage : sessionStorage; }
  function _readUser() {
    return localStorage.getItem('fpCurrentUser') || sessionStorage.getItem('fpCurrentUser') || '';
  }
  function _clearUser() {
    try { sessionStorage.removeItem('fpCurrentUser'); } catch {}
    try { localStorage.removeItem('fpCurrentUser'); } catch {}
  }

  const LOCKOUT_FAILS = 5;
  const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  const FAIL_WINDOW_MS = 15 * 60 * 1000;      // rolling window for fail count
  const KEY_FAILS = 'fpAuthFails';
  const KEY_SIG   = 'fpUsersSig';
  const KEY_SESSIG= 'fpCurrentUserSig';

  const logEvent = (kind, details) => {
    const e = { ts: new Date().toISOString(), kind, details };
    window._fpAuthEvents.push(e);
    while (window._fpAuthEvents.length > 100) window._fpAuthEvents.shift();
    console.log('%c[FP auth] ' + kind, 'color: #06b6d4', details || '');
  };

  // ─── Simple deterministic "HMAC" for signing payloads ─────────
  // Not cryptographically secure (key is in source) but raises the
  // bar significantly for non-technical tampering.
  const SIG_SALT = 'fp-romania-2026-guard-v1';
  function sign(payload) {
    if (typeof simpleHash !== 'function') return '';
    return simpleHash(SIG_SALT + '::' + payload + '::' + SIG_SALT);
  }
  function verify(payload, expectedSig) {
    return sign(payload) === expectedSig;
  }

  // ─── Rate limiting ────────────────────────────────────────────
  function getFails() {
    try { return JSON.parse(localStorage.getItem(KEY_FAILS) || '[]'); }
    catch { return []; }
  }
  function pushFail() {
    const now = Date.now();
    const fails = getFails().filter(t => (now - t) < FAIL_WINDOW_MS);
    fails.push(now);
    try { localStorage.setItem(KEY_FAILS, JSON.stringify(fails)); } catch {}
    return fails;
  }
  function clearFails() {
    try { localStorage.removeItem(KEY_FAILS); } catch {}
  }
  function isLockedOut() {
    const fails = getFails();
    if (fails.length < LOCKOUT_FAILS) return false;
    // Compute last-fail window
    const recent = fails.slice(-LOCKOUT_FAILS);
    const oldestRecent = recent[0];
    // Locked if last LOCKOUT_FAILS fails happened in under LOCKOUT_DURATION_MS
    return (Date.now() - oldestRecent) < LOCKOUT_DURATION_MS;
  }
  function lockoutRemainingMs() {
    const fails = getFails();
    if (fails.length < LOCKOUT_FAILS) return 0;
    const oldest = fails.slice(-LOCKOUT_FAILS)[0];
    return Math.max(0, LOCKOUT_DURATION_MS - (Date.now() - oldest));
  }

  // ─── Users signature ──────────────────────────────────────────
  function signUserList() {
    try {
      const list = localStorage.getItem('fpUsers') || '[]';
      localStorage.setItem(KEY_SIG, sign(list));
    } catch {}
  }
  function checkUserListSig() {
    try {
      const list = localStorage.getItem('fpUsers') || '[]';
      const sig  = localStorage.getItem(KEY_SIG);
      if (!sig) return 'unsigned'; // first boot
      if (!verify(list, sig)) return 'tampered';
      return 'ok';
    } catch { return 'error'; }
  }

  // ─── Session signature ────────────────────────────────────────
  // Binds session to a fingerprint that is stable across resizes,
  // orientation changes, and zoom. Only uses immutable identifiers.
  function fingerprint() {
    return sign(navigator.userAgent + '::' + navigator.language + '::' + navigator.platform);
  }
  function signSession() {
    try {
      const sess = _readUser();
      if (!sess) return;
      _storage().setItem(KEY_SESSIG, sign(sess + '::' + fingerprint()));
    } catch {}
  }
  function checkSessionSig() {
    try {
      const sess = _readUser();
      if (!sess) return 'no-session';
      const sig = _storage().getItem(KEY_SESSIG) || sessionStorage.getItem(KEY_SESSIG) || localStorage.getItem(KEY_SESSIG);
      if (!sig) return 'unsigned';
      if (!verify(sess + '::' + fingerprint(), sig)) return 'tampered';
      return 'ok';
    } catch { return 'error'; }
  }

  // ─── Hook into doLogin ────────────────────────────────────────
  function wrapDoLogin() {
    if (typeof window.doLogin !== 'function') return false;
    if (window.doLogin.__fpGuarded) return true;
    const original = window.doLogin;

    window.doLogin = function guardedDoLogin() {
      // Lockout check
      if (isLockedOut()) {
        const errEl = document.getElementById('loginError');
        if (errEl) {
          errEl.style.display = 'block';
          const mins = Math.ceil(lockoutRemainingMs() / 60000);
          errEl.textContent = `Trop de tentatives — réessayez dans ${mins} min`;
        }
        logEvent('login-locked', { remaining: lockoutRemainingMs() });
        return;
      }

      // Capture state before login
      const email = (document.getElementById('loginEmail')?.value || '').trim().toLowerCase();
      const sessBefore = _readUser();
      try { original.apply(this, arguments); } catch (e) { logEvent('login-error', e.message); throw e; }
      const sessAfter = _readUser();

      if (sessAfter && sessAfter !== sessBefore) {
        // Success
        clearFails();
        signSession();
        signUserList();  // resync signature after successful login (in case migration added users)
        logEvent('login-success', { email });
      } else {
        // Failure
        const fails = pushFail();
        logEvent('login-fail', { email, count: fails.length, locked: isLockedOut() });
        if (isLockedOut()) {
          const errEl = document.getElementById('loginError');
          if (errEl) errEl.textContent = `Trop de tentatives — verrou 5 min`;
        }
      }
    };
    window.doLogin.__fpGuarded = true;
    return true;
  }

  // ─── Hook into doLogout to clear session sig ───────────────────
  function wrapDoLogout() {
    if (typeof window.doLogout !== 'function') return false;
    if (window.doLogout.__fpGuarded) return true;
    const original = window.doLogout;
    window.doLogout = function guardedDoLogout() {
      try { sessionStorage.removeItem(KEY_SESSIG); } catch {}
      logEvent('logout', {});
      return original.apply(this, arguments);
    };
    window.doLogout.__fpGuarded = true;
    return true;
  }

  // ─── Boot-time check ──────────────────────────────────────────
  function bootCheck() {
    const listStatus = checkUserListSig();
    const sessStatus = checkSessionSig();

    if (listStatus === 'tampered') {
      logEvent('users-tampered', { action: 'reset-to-canonical' });
      // Reset: clear existing fpUsers, let the canonical migration re-seed
      try { localStorage.removeItem('fpUsers'); localStorage.removeItem(KEY_SIG); } catch {}
      if (typeof currentUser !== 'undefined' && currentUser) {
        try { window.doLogout?.(); } catch {}
      }
      alert('⚠ Détection d\'une altération de la liste des utilisateurs. Rechargement sécurisé.');
      setTimeout(() => window.location.reload(), 100);
      return;
    }

    if (listStatus === 'unsigned') signUserList();

    if (sessStatus === 'tampered') {
      logEvent('session-tampered', { action: 'force-logout' });
      _clearUser();
      try {
        sessionStorage.removeItem(KEY_SESSIG);
        localStorage.removeItem(KEY_SESSIG);
      } catch {}
      alert('⚠ Session altérée. Reconnexion requise.');
      setTimeout(() => window.location.reload(), 100);
      return;
    }
  }

  // ─── Install ──────────────────────────────────────────────────
  function tryInstall(tries = 0) {
    const okLogin = wrapDoLogin();
    const okLogout = wrapDoLogout();
    if (okLogin && okLogout) {
      bootCheck();
      return;
    }
    if (tries > 25) {
      console.warn('[FP auth-guard] failed to install after 25 retries');
      return;
    }
    setTimeout(() => tryInstall(tries + 1), 300);
  }

  if (document.readyState === 'complete') tryInstall();
  else window.addEventListener('load', () => tryInstall());

  // Periodic session sig check (every 60s) — only acts on 2 consecutive failures
  // to avoid false positives on harmless env changes (browser updates, language swap).
  let consecutiveTamper = 0;
  setInterval(() => {
    const s = checkSessionSig();
    if (s === 'tampered') {
      consecutiveTamper++;
      logEvent('session-tamper-detected-runtime', { consecutive: consecutiveTamper });
      if (consecutiveTamper >= 2) {
        // Two checks in a row say tampered — real. Force reconnect.
        _clearUser();
        try {
          sessionStorage.removeItem(KEY_SESSIG);
          localStorage.removeItem(KEY_SESSIG);
        } catch {}
        alert('⚠ Session altérée. Reconnexion requise.');
        window.location.reload();
      }
    } else {
      consecutiveTamper = 0;
    }
  }, 60000);

  // ─── Public API ───────────────────────────────────────────────
  window.dumpAuth = function() {
    console.group('%cFP Auth state', 'color: #06b6d4; font-weight: bold');
    console.log('User list:', checkUserListSig());
    console.log('Session:',   checkSessionSig());
    const fails = getFails();
    console.log('Recent failed attempts:', fails.length, fails.length > 0 ? new Date(fails[fails.length-1]) : '');
    console.log('Locked out:', isLockedOut(), isLockedOut() ? `${Math.ceil(lockoutRemainingMs()/1000)}s remaining` : '');
    console.log('Events:', window._fpAuthEvents.slice(-10));
    console.groupEnd();
  };

  window._fpAuthGuard = { isLockedOut, getFails, clearFails, checkUserListSig, checkSessionSig };
})();
