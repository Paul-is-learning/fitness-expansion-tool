// ─────────────────────────────────────────────────────────────────────
// /api/backup — Sauvegarde automatique du cloud (v6.83).
//
// Ferme le risque "perte de données" : la base KV free tier a déjà été
// supprimée une fois. Ce module en fait des instantanés datés et permet
// de télécharger un export complet à tout moment.
//
// Actions :
//   GET ?action=snapshot   → (cron hebdo dimanche) agrège TOUTES les clés
//                            métier dans `fp:v2:backup:<YYYY-Www>`, garde
//                            les 8 dernières (≈ 2 mois d'historique).
//   GET ?action=list       → index des sauvegardes {key, ts, sizeKb, weeks}
//   GET ?action=download    → export JSON complet des données courantes,
//        (admin/whitelist)    en pièce jointe téléchargeable (Content-
//                            Disposition), horodaté. C'est le "bouton
//                            rassurance" : un fichier sur ton disque.
//   GET ?action=get&key=... → (admin) contenu d'une sauvegarde datée.
//
// Les instantanés sont eux-mêmes en KV (même base) : ils protègent contre
// la corruption/suppression de clés individuelles et le mauvais LWW, PAS
// contre la destruction de toute la base. Le download (fichier local) est
// le vrai coffre hors-ligne — à faire de temps en temps.
// ─────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const KV_URL   = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Clés métier à sauvegarder (tout sauf les backups eux-mêmes et les
// tokens éphémères magic/reset qui expirent seuls).
const BACKED_KEYS = [
  'fp:custom-sites:shared',
  'fp:audit:log',
  'fp:reviews-history',
  'fp:v2:directory',
  'fp:v2:scenarios',   // v6.84
  'fp:v2:conquest',    // v6.84
];

const BACKUP_INDEX = 'fp:v2:backup:index';
const MAX_BACKUPS = 8;

const ALLOWED_USERS = new Set([
  'paulbecaud@isseo-dev.com', 'pbecaud@isseo-dev.com',
  'ulysse.gaspard0@gmail.com', 'tomescumh@yahoo.com',
]);

async function kvGetRaw(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) throw new Error(`KV GET ${r.status}`);
  const j = await r.json();
  return j.result != null ? j.result : null; // string brute (déjà JSON)
}
async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' }, body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV SET ${r.status}`);
}
async function kvDel(key) {
  await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` } });
}

// Session cookie (miroir des autres endpoints)
function sessionRole(req) {
  try {
    const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('fp_session='));
    if (!c) return null;
    const [p, sig] = c.slice('fp_session='.length).split('.');
    if (crypto.createHmac('sha256', KV_TOKEN).update(p).digest('base64url') !== sig) return null;
    const s = JSON.parse(Buffer.from(p, 'base64url').toString());
    return Date.now() > s.x ? null : { email: s.e, role: s.r };
  } catch { return null; }
}

// Numéro de semaine ISO — clé stable dimanche → dimanche
function isoWeekKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yStart) / 864e5) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function collectData() {
  const data = {};
  for (const k of BACKED_KEYS) {
    try { const raw = await kvGetRaw(k); if (raw != null) data[k] = JSON.parse(raw); } catch {}
  }
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!KV_URL || !KV_TOKEN) { res.status(503).json({ error: 'KV_NOT_CONFIGURED' }); return; }

  const q = req.query || {};
  const action = String(q.action || 'snapshot');
  const s = sessionRole(req);
  const legacyUser = String(q.user || '').toLowerCase().trim();
  const isAdmin = (s && s.role === 'admin') || ALLOWED_USERS.has(legacyUser);

  try {
    // ── snapshot : appelé par le cron (pas d'auth : lecture seule + écrit
    //    une clé backup versionnée ; aucune donnée exposée en réponse) ──
    if (action === 'snapshot') {
      const wk = isoWeekKey(new Date(q._now ? Number(q._now) : Date.now()));
      const data = await collectData();
      const payload = { week: wk, ts: Date.now(), keys: Object.keys(data), data };
      const serialized = JSON.stringify(payload);
      if (serialized.length > 4 * 1024 * 1024) { res.status(200).json({ ok: false, skipped: 'too-large', kb: Math.round(serialized.length / 1024) }); return; }
      await kvSet(`fp:v2:backup:${wk}`, payload);
      // index + rotation
      let idx = [];
      try { const raw = await kvGetRaw(BACKUP_INDEX); if (raw) idx = JSON.parse(raw); } catch {}
      idx = idx.filter(e => e.week !== wk);
      idx.push({ week: wk, ts: payload.ts, sizeKb: Math.round(serialized.length / 1024), nKeys: payload.keys.length });
      idx.sort((a, b) => a.ts - b.ts);
      while (idx.length > MAX_BACKUPS) { const old = idx.shift(); try { await kvDel(`fp:v2:backup:${old.week}`); } catch {} }
      await kvSet(BACKUP_INDEX, idx);
      res.status(200).json({ ok: true, week: wk, sizeKb: Math.round(serialized.length / 1024), backupsKept: idx.length });
      return;
    }

    // ── list : index des sauvegardes ──
    if (action === 'list') {
      let idx = [];
      try { const raw = await kvGetRaw(BACKUP_INDEX); if (raw) idx = JSON.parse(raw); } catch {}
      res.status(200).json({ ok: true, backups: idx.reverse() });
      return;
    }

    // ── download : export complet téléchargeable (admin) ──
    if (action === 'download') {
      if (!isAdmin) { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      const data = await collectData();
      const stamp = new Date().toISOString().slice(0, 10);
      const doc = { app: 'Expansion Intelligence', exportedAt: new Date().toISOString(), by: s?.email || legacyUser, keys: Object.keys(data), data };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="fp-backup-${stamp}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).end(JSON.stringify(doc, null, 2));
      return;
    }

    // ── get : une sauvegarde datée (admin) ──
    if (action === 'get') {
      if (!isAdmin) { res.status(403).json({ error: 'ADMIN_ONLY' }); return; }
      const key = String(q.key || '');
      if (!/^\d{4}-W\d{2}$/.test(key)) { res.status(400).json({ error: 'BAD_KEY' }); return; }
      const raw = await kvGetRaw(`fp:v2:backup:${key}`);
      if (!raw) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).end(raw);
      return;
    }

    res.status(400).json({ error: 'UNKNOWN_ACTION' });
  } catch (e) {
    console.error('[api/backup] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
