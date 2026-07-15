// ─────────────────────────────────────────────────────────────────────
// src/admin-users.js — v6.87 « Auth Pro »
//
// Gestion des utilisateurs branchée sur l'ANNUAIRE SERVEUR (KV via
// /api/auth). S'affiche dans le panneau utilisateurs (showUserPanel)
// quand une session serveur admin est active ; sinon le panneau garde
// son mode local historique (offline / CI).
//
// Rôles : admin (tout + gestion users) · editor (modifie) · viewer (lit).
// Expose : window.AdminUsers = { blockHtml, load, add, setRole,
//                                resetPw, del, changeMyPw }
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const ROLES = {
    admin:  { label: 'Admin',   color: 'var(--accent)', desc: 'Tout, dont la gestion des utilisateurs' },
    editor: { label: 'Éditeur', color: 'var(--blue)',   desc: 'Peut modifier sites et hypothèses' },
    viewer: { label: 'Lecteur', color: '#94a3b8',       desc: 'Lecture seule' },
  };
  const ERRORS = {
    LAST_ADMIN: 'Impossible : il faut au moins un admin actif.',
    CANT_DELETE_SELF: 'Impossible de supprimer son propre compte.',
    CANT_DEMOTE_SELF: 'Impossible de retirer son propre rôle admin.',
    CANT_DISABLE_SELF: 'Impossible de désactiver son propre compte.',
    PASSWORD_REQUIRED: 'Mot de passe initial requis (6 caractères minimum).',
    PASSWORD_TOO_SHORT: 'Mot de passe trop court (6 caractères minimum).',
    BAD_CURRENT_PASSWORD: 'Mot de passe actuel incorrect.',
    ADMIN_ONLY: 'Action réservée aux admins.',
    NO_SESSION: 'Session serveur expirée — reconnectez-vous.',
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(payload) {
    try {
      const isGet = typeof payload === 'string';
      const r = await fetch(isGet ? `/api/auth?action=${payload}` : '/api/auth', {
        method: isGet ? 'GET' : 'POST',
        headers: isGet ? undefined : { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: isGet ? undefined : JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, ...j };
    } catch {
      return { ok: false, status: 0, error: 'NETWORK' };
    }
  }

  function say(msg, good) {
    const el = document.getElementById('auStatus');
    if (!el) return;
    el.style.color = good ? 'var(--green, #34d399)' : '#f87171';
    el.textContent = msg;
    if (good) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
  }
  const errMsg = j => ERRORS[j.error] || j.hint || `Erreur serveur (${j.status || j.error || '?'})`;

  function fmtLast(ts) {
    if (!ts) return 'jamais connecté';
    const d = Date.now() - ts;
    if (d < 36e5) return `il y a ${Math.max(1, Math.round(d / 6e4))} min`;
    if (d < 864e5) return `il y a ${Math.round(d / 36e5)} h`;
    return `il y a ${Math.round(d / 864e5)} j`;
  }

  // ── Bloc HTML injecté dans le panneau utilisateurs ──────────────────
  function blockHtml() {
    return `
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--gray)">UTILISATEURS</div>
        <div style="font-size:9px;padding:2px 8px;border-radius:20px;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);color:var(--green,#34d399);font-weight:700">☁️ ANNUAIRE SERVEUR</div>
      </div>
      <div id="auList" style="max-height:240px;overflow-y:auto"><div style="font-size:11px;color:var(--gray2);padding:8px">Chargement…</div></div>
      <div style="font-size:11px;font-weight:700;color:var(--gray);margin:12px 0 8px">AJOUTER UN UTILISATEUR</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        <input type="email" id="auEmail" placeholder="email@exemple.com" autocomplete="off" style="flex:2;min-width:150px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:12px;font-family:var(--font)">
        <input type="text" id="auName" placeholder="Prénom Nom" autocomplete="off" style="flex:1;min-width:100px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:12px;font-family:var(--font)">
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input type="text" id="auPw" placeholder="Mot de passe initial (6 min)" autocomplete="off" style="flex:2;min-width:150px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:12px;font-family:var(--font)">
        <select id="auRole" title="${esc(Object.values(ROLES).map(r => r.label + ' : ' + r.desc).join(' · '))}" style="flex:1;min-width:90px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--white);font-size:11px;font-family:var(--font)">
          <option value="viewer">Lecteur</option>
          <option value="editor">Éditeur</option>
          <option value="admin">Admin</option>
        </select>
        <button class="btn btn-sm btn-primary" onclick="AdminUsers.add()">Ajouter</button>
      </div>
      <div id="auStatus" style="font-size:10px;min-height:14px;margin-top:6px"></div>
      <div style="font-size:9px;color:var(--gray2);margin-top:2px;line-height:1.5">
        Admin : tout · Éditeur : modifie sites &amp; hypothèses · Lecteur : lecture seule.<br>
        Le compte marche immédiatement sur <b>tous les appareils</b> — transmettez email + mot de passe, l'utilisateur pourra le changer ensuite.
      </div>
    </div>`;
  }

  // ── Rendu de la liste ────────────────────────────────────────────────
  async function load() {
    const box = document.getElementById('auList');
    if (!box) return;
    const j = await api('users');
    if (!j.ok) { box.innerHTML = `<div style="font-size:11px;color:#f87171;padding:8px">${esc(errMsg(j))}</div>`; return; }
    box.innerHTML = j.users.map(u => {
      const role = ROLES[u.role] || ROLES.viewer;
      const me = u.email === j.me;
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;margin-bottom:4px;background:var(--card2);${u.disabled ? 'opacity:.45' : ''}">
        <div style="width:28px;height:28px;border-radius:50%;background:${role.color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;flex-shrink:0">${esc((u.name || u.email)[0].toUpperCase())}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name || u.email.split('@')[0])}${u.disabled ? ' <span style="color:#f87171;font-size:9px">— désactivé</span>' : ''}</div>
          <div style="font-size:9px;color:var(--gray2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(u.email)}">${esc(u.email)} · ${fmtLast(u.lastLogin)}</div>
        </div>
        ${me
          ? `<span style="font-size:9px;color:${role.color};font-weight:700;flex-shrink:0">${role.label} — vous</span>`
          : `<select onchange="AdminUsers.setRole('${esc(u.email)}', this.value)" title="Changer le rôle" style="padding:4px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:${role.color};font-size:10px;font-weight:700;font-family:var(--font);flex-shrink:0">
               ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${r.label}</option>`).join('')}
             </select>
             <button class="btn btn-sm" title="Définir un nouveau mot de passe" style="font-size:11px;padding:4px 7px;flex-shrink:0" onclick="AdminUsers.resetPw('${esc(u.email)}')">🔑</button>
             <button class="btn btn-sm" title="Supprimer le compte" style="color:var(--red);font-size:11px;padding:4px 7px;flex-shrink:0" onclick="AdminUsers.del('${esc(u.email)}')">🗑</button>`}
      </div>`;
    }).join('');
  }

  // ── Actions ──────────────────────────────────────────────────────────
  async function add() {
    const email = (document.getElementById('auEmail')?.value || '').trim().toLowerCase();
    const name = (document.getElementById('auName')?.value || '').trim();
    const password = document.getElementById('auPw')?.value || '';
    const role = document.getElementById('auRole')?.value || 'viewer';
    if (!email.includes('@')) return say('Email invalide.');
    if (password.length < 6) return say('Mot de passe initial requis (6 caractères minimum).');
    const j = await api({ action: 'user-save', email, name, role, password });
    if (!j.ok) return say(errMsg(j));
    say(`${email} ajouté (${ROLES[role].label}) — identifiants à transmettre.`, true);
    ['auEmail', 'auName', 'auPw'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    load();
  }

  async function setRole(email, role) {
    const j = await api({ action: 'user-save', email, role });
    if (!j.ok) { say(errMsg(j)); load(); return; }
    say(`Rôle de ${email} → ${ROLES[role].label}.`, true);
    load();
  }

  async function resetPw(email) {
    const pw = prompt(`Nouveau mot de passe pour ${email} (6 caractères minimum) :`);
    if (pw === null) return;
    if (pw.length < 6) return say('Mot de passe trop court (6 caractères minimum).');
    const j = await api({ action: 'set-password', email, password: pw });
    if (!j.ok) return say(errMsg(j));
    try { window._fpMirrorLocalPw?.(email, pw); } catch {}
    say(`Mot de passe de ${email} mis à jour — à lui transmettre.`, true);
  }

  async function del(email) {
    if (!confirm(`Supprimer le compte ${email} ?\nIl ne pourra plus se connecter (ses analyses partagées restent).`)) return;
    const j = await api({ action: 'user-delete', email });
    if (!j.ok) return say(errMsg(j));
    say(`${email} supprimé.`, true);
    load();
  }

  // ── Mon mot de passe (tous rôles, session serveur requise) ──────────
  async function changeMyPw() {
    const current = prompt('Mot de passe actuel :');
    if (current === null) return;
    const pw = prompt('Nouveau mot de passe (6 caractères minimum) :');
    if (pw === null) return;
    if (pw.length < 6) return alert('Mot de passe trop court (6 caractères minimum).');
    const j = await api({ action: 'set-password', current, password: pw });
    if (j.ok) { try { window._fpMirrorLocalPw?.(window._serverSession?.email, pw); } catch {} }
    alert(j.ok ? 'Mot de passe mis à jour ✓' : errMsg(j));
  }

  window.AdminUsers = { blockHtml, load, add, setRole, resetPw, del, changeMyPw };
})();
