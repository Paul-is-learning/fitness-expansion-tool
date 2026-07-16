// ─────────────────────────────────────────────────────────────────────
// /api/analyst — Analyste IA intégré (v6.74).
//
// POST { user, question, context } → réponse de Claude (Anthropic API).
// Le contexte est le JSON compact de l'analyse du site (construit côté
// client par src/ai-analyst.js) : KPIs, sources de membres, concurrents,
// risques, financement, ranking des autres sites.
//
// Env var requise (Vercel → Settings → Environment Variables) :
//   ANTHROPIC_API_KEY = sk-ant-...   (console.anthropic.com)
// Sans clé : 503 NO_API_KEY (le client affiche la marche à suivre).
//
// Garde-fous :
//   - whitelist users (identique aux autres endpoints)
//   - question ≤ 1 000 chars, contexte ≤ 24 KB
//   - max_tokens 900, modèle claude-sonnet-5 (rapide + économique)
//   - le system prompt interdit d'inventer des chiffres hors contexte
// ─────────────────────────────────────────────────────────────────────

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANALYST_MODEL || 'claude-sonnet-5';

const ALLOWED_USERS = new Set([
  'paulbecaud@isseo-dev.com',
  'pbecaud@isseo-dev.com',
  'ulysse.gaspard0@gmail.com',
  'tomescumh@yahoo.com',
]);

const SYSTEM = `Tu es l'analyste investissement senior intégré à "Expansion Intelligence Platform",
l'outil de géomarketing de Paul Becaud (Isseo), master-franchisé Fitness Park en Roumanie.

Règles absolues :
- Réponds en français, ton direct et professionnel (registre d'un memo d'investissement).
- N'utilise JAMAIS de tiret long (— ou –) : sépare avec une virgule, un point médian (·) ou deux-points.
- Appuie CHAQUE affirmation chiffrée sur le CONTEXTE JSON fourni. Si une donnée n'y est pas, dis-le
  ("le modèle ne fournit pas X") — n'invente JAMAIS un chiffre.
- Sois concis : 150-250 mots sauf si on te demande un document (argumentaire, paragraphe de thèse).
- Pédagogie : si un terme technique est central à ta réponse (IRR equity, DSCR, FCFE...), glisse sa
  signification en une demi-phrase.
- Contexte marché utile : Fitness Park = low-cost 27,8€ TTC ; concurrents premium (World Class ~46-90€),
  mid (Stay Fit ~28-32€, 18GYM ~26-36€) ; pénétration fitness RO ~5% vs FR ~11%.
- Le "modèle de référence" est calibré sur OnAir Montreuil (comptes audités) et le BP Avril 2026 —
  il est verrouillé ; les réglages/scénarios sont des études autour de cette référence.
- Si on te demande une comparaison entre sites, utilise le champ "autresSites" du contexte.
- Termine par une ligne "→ À creuser :" avec UNE question pertinente que l'utilisateur devrait se poser.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  if (!API_KEY) {
    res.status(503).json({ error: 'NO_API_KEY', hint: 'Ajouter ANTHROPIC_API_KEY dans les env vars Vercel puis redéployer.' });
    return;
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { res.status(400).json({ error: 'BAD_JSON' }); return; }

  const user = String(body.user || '').toLowerCase().trim();
  const question = String(body.question || '').slice(0, 1000);
  const context = body.context;
  if (!ALLOWED_USERS.has(user)) { res.status(403).json({ error: 'FORBIDDEN_USER' }); return; }
  if (!question.trim()) { res.status(400).json({ error: 'EMPTY_QUESTION' }); return; }
  const ctxStr = JSON.stringify(context || {});
  if (ctxStr.length > 24 * 1024) { res.status(413).json({ error: 'CONTEXT_TOO_LARGE' }); return; }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: `CONTEXTE (analyse du site, JSON) :\n${ctxStr}\n\nQUESTION :\n${question}`,
        }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[api/analyst] Anthropic error:', r.status, JSON.stringify(j).slice(0, 300));
      res.status(502).json({ error: 'UPSTREAM', status: r.status, message: j.error?.message || 'Anthropic API error' });
      return;
    }
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    res.status(200).json({ ok: true, answer: text, usage: j.usage });
  } catch (e) {
    console.error('[api/analyst] error:', e);
    res.status(500).json({ error: 'INTERNAL', message: String(e.message || e) });
  }
};
