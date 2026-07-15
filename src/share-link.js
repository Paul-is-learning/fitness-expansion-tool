// ─────────────────────────────────────────────────────────────────────
// share-link.js — création de liens de présentation publics (v6.80).
// Bouton 🔗 sur la fiche : snapshotte le Mémo d'IC du site ouvert,
// l'envoie à /api/share, copie l'URL lecture seule (30 jours) dans le
// presse-papier. À envoyer à un bailleur / une banque / FP France.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  function getUser() {
    try {
      const raw = localStorage.getItem('fpCurrentUser') || sessionStorage.getItem('fpCurrentUser');
      return raw ? (JSON.parse(raw)?.email || '').toLowerCase().trim() : '';
    } catch { return ''; }
  }

  function toast(msg, ok) {
    const old = document.getElementById('fpShareToast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'fpShareToast';
    t.style.cssText = `position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:100005;
      background:${ok ? 'rgba(16,185,129,.95)' : 'rgba(239,68,68,.95)'};color:#fff;font-family:var(--font,sans-serif);
      font-size:12px;font-weight:700;padding:11px 18px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);
      max-width:88vw;text-align:center;line-height:1.5`;
    t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
  }

  async function shareMemo() {
    if (typeof window.ICMemo?.buildHtml !== 'function') { toast('Module mémo non chargé', false); return; }
    const html = window.ICMemo.buildHtml();
    if (!html) { toast('Analyse d’abord un site — le lien partage le mémo de la fiche ouverte.', false); return; }
    const siteName = window._lastCaptageLocation?.siteName || 'Site';
    toast('Création du lien…', true);
    try {
      const r = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user: getUser(), title: 'Mémo IC — ' + siteName, html, days: 30 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) {
        toast('Erreur : ' + (j.error || 'HTTP ' + r.status) + (location.hostname === 'localhost' ? ' (fonctionne uniquement en production)' : ''), false);
        return;
      }
      let copied = false;
      try { await navigator.clipboard.writeText(j.url); copied = true; } catch {}
      toast(`🔗 Lien créé (valide 30 jours)${copied ? ' — copié dans le presse-papier ✓' : ''}<br>
        <a href="${j.url}" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;font-weight:500;font-size:10px;word-break:break-all">${j.url}</a>`, true);
      try { window.AuditLog?.log({ action: 'share.create', target: siteName, field: 'memo', meta: { days: 30 } }); } catch {}
    } catch (e) {
      toast('Connexion impossible — réessaie.', false);
    }
  }

  window.ShareLink = { shareMemo };
})();
