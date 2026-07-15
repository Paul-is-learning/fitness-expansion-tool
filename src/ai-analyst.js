// ═════════════════════════════════════════════════════════════════════
// ANALYSTE IA (v6.74) — pose tes questions au site analysé, en français.
//
// Bouton 💬 sur la fiche → panneau chat. Le contexte envoyé à /api/analyst
// est un JSON compact construit ici : KPIs du site, sources de membres,
// top concurrents, risques/opportunités, financement, réglages, et le
// ranking des autres sites analysés (pour les comparaisons).
//
// Dégradation propre : sans ANTHROPIC_API_KEY côté Vercel, le panneau
// explique la marche à suivre (2 min).
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const F = (typeof fmt === 'function') ? fmt : (x => String(x));
  let history = []; // {q, a} de la session courante (par site ouvert)
  let busy = false;

  const CHIPS = [
    'Pourquoi ce verdict ?',
    'Explique l’IRR equity à un novice',
    'Rédige l’argumentaire de négociation loyer pour le bailleur',
    'Compare ce site aux autres sites analysés',
    'Quels sont les 3 risques principaux et comment les mitiger ?',
    'Rédige la thèse d’investissement en 5 phrases pour le mémo',
  ];

  function getUser() {
    try {
      const raw = localStorage.getItem('fpCurrentUser') || sessionStorage.getItem('fpCurrentUser');
      return raw ? (JSON.parse(raw)?.email || '').toLowerCase().trim() : '';
    } catch { return ''; }
  }

  // ─── Contexte compact ─────────────────────────────────────────────
  function buildContext() {
    const d = window._lastCaptageData;
    const exec = window._lastExecData?.exec;
    const loc = window._lastCaptageLocation;
    if (!d?.r?.pnl?.base || !exec) return null;
    const r = d.r, pb = r.pnl.base;
    const k = v => Math.round((v || 0) / 1000); // k€
    let autresSites = [];
    try {
      autresSites = (window._siteAnalyses || []).map(a => ({
        nom: a.name, score: a.score, verdict: a.verdict,
        membres: a.members, irrProjet: a.irrBase, irrEquity: a.irrEquity, npvK: k(a.npvBase),
      })).slice(0, 12);
    } catch {}
    return {
      site: {
        nom: loc?.siteName, rayonKm: (r.captageRadius || 3000) / 1000,
        surfaceM2: window._surfaceOverride?.surface ?? PNL_DEFAULTS.rentSteps.surface,
        loyerY1: window._rentOverride?.y1 ?? PNL_DEFAULTS.rentSteps.objectifNego[0].rent,
        chargesM2: window._chargeOverride?.chargeTotal ?? (PNL_DEFAULTS.rentSteps.serviceCharge + PNL_DEFAULTS.rentSteps.marketingFee),
      },
      verdict: { label: exec.verdict, score: exec.total, desc: exec.verdictDesc,
        risques: exec.risks, opportunites: exec.opportunities },
      demande: {
        popCible: r.popTarget, saz: r.saz?.total,
        sazDetail: { flux: r.saz?.flux, densite: r.saz?.densite, jeunesse: r.saz?.jeunesse },
        membres: { realiste: r.realiste, pessimiste: r.pessimiste, optimiste: r.optimiste, cibleBP: PNL_DEFAULTS.targetMembers },
        sources: { captifs: r.totalCaptifs, natifs: r.native?.captured, walkIn: r.walkIn?.walkInMembers, bonusDestination: r.destinationBonus?.bonusMembers },
        arpuHT: r.arpu, ltv: Math.round(r.ltv || 0), ltvCac: r.ltvCacRatio,
      },
      concurrence: {
        nbClubs: (r.comps || []).length,
        top: [...(r.comps || [])].sort((a, b) => (b.captured || 0) - (a.captured || 0)).slice(0, 5)
          .map(c => ({ nom: c.name, segment: c.segment, membresEst: c.membersEst || c.members, captables: c.captured })),
      },
      finance: {
        capexK: k(pb.capex), equityK: k(pb.equity), detteK: k(pb.loanPrincipal),
        financement: pb.financing,
        caAnnuelK: (pb.annualCA || []).map(k), ebitdaAnnuelK: (pb.annualEBITDA || []).map(k),
        fcfeAnnuelK: (pb.annualFCFE || []).map(k), fcfe5ansK: k(pb.fcfe5y),
        irrProjet: pb.irr, irrEquity: pb.irrEquity, npvK: k(pb.npv),
        dscrParAn: pb.dscrByYear, dscrMinCroisiere: pb.dscrMinCruise, moic: pb.moic,
        breakevenMois: pb.breakevenMonth, paybackMois: pb.paybackMonth, paybackEquityMois: pb.paybackEquityMonth,
        valeurSortieK: k(pb.terminalValue), multipleSortie: (typeof getEffectiveExitMultiple === 'function') ? getEffectiveExitMultiple() : 8,
      },
      autresSites,
      modele: { version: (typeof MODEL_VERSION !== 'undefined') ? MODEL_VERSION : '', reference: 'OnAir Montreuil audité + BP Avril 2026 (verrouillé)' },
    };
  }

  // ─── Markdown minimal → HTML sûr ──────────────────────────────────
  function md(t) {
    let s = String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b style="color:var(--white)">$1</b>');
    s = s.replace(/^### (.+)$/gm, '<div style="font-weight:800;color:var(--accent);margin:8px 0 3px">$1</div>');
    s = s.replace(/^[-•] (.+)$/gm, '<div style="padding-left:12px;position:relative"><span style="position:absolute;left:0;color:var(--accent)">•</span>$1</div>');
    s = s.replace(/^→ (.+)$/gm, '<div style="margin-top:8px;padding:6px 9px;background:rgba(212,160,23,.08);border-left:2px solid var(--accent);border-radius:0 5px 5px 0;font-size:10px">→ $1</div>');
    return s.replace(/\n\n/g, '<div style="height:7px"></div>').replace(/\n/g, '<br>');
  }

  // ─── UI ───────────────────────────────────────────────────────────
  function open() {
    if (!buildContext()) { alert('Analyse d’abord un site — l’Analyste IA répond sur la fiche ouverte.'); return; }
    history = [];
    const old = document.getElementById('fpAnalyst');
    if (old) { old.remove(); return; }
    const p = document.createElement('div');
    p.id = 'fpAnalyst';
    p.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:420px;max-width:92vw;z-index:10002;background:linear-gradient(180deg,#0d1322,#0a0f1c);border-left:1px solid rgba(212,160,23,.35);box-shadow:-18px 0 50px rgba(0,0,0,.55);display:flex;flex-direction:column;font-family:var(--font)';
    p.innerHTML = `
      <header style="padding:13px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div>
          <div style="font-size:13px;font-weight:900;color:var(--white)">💬 Analyste IA</div>
          <div style="font-size:8.5px;color:var(--gray2);margin-top:1px">${(window._lastCaptageLocation?.siteName || 'Site').replace(/</g,'&lt;')} · répond uniquement sur les chiffres du modèle</div>
        </div>
        <button onclick="AiAnalyst.open()" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--gray);width:30px;height:30px;cursor:pointer;font-size:13px">✕</button>
      </header>
      <div id="fpAnalystMsgs" style="flex:1;overflow-y:auto;padding:12px 14px">
        <div style="font-size:10px;color:var(--gray);line-height:1.6;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
          Je connais toute l'analyse de ce site (demande, concurrence, P&L, financement) et le classement de tes autres sites.
          Pose ta question — ou pars d'une suggestion :
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">
          ${CHIPS.map(c => `<button onclick="AiAnalyst.ask('${c.replace(/'/g, '\\&#39;')}')" style="font-size:8.5px;padding:5px 9px;background:rgba(212,160,23,.1);border:1px solid rgba(212,160,23,.3);border-radius:999px;color:var(--accent);cursor:pointer;font-family:var(--font)">${c}</button>`).join('')}
        </div>
      </div>
      <div style="padding:10px 14px;border-top:1px solid var(--border);flex-shrink:0">
        <div style="display:flex;gap:6px">
          <input id="fpAnalystInput" placeholder="Ta question sur ce site…" onkeydown="if(event.key==='Enter')AiAnalyst.ask()"
            style="flex:1;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:9px;color:var(--white);font-size:11px;font-family:var(--font)">
          <button id="fpAnalystSend" onclick="AiAnalyst.ask()" style="padding:10px 16px;background:var(--accent);border:none;border-radius:9px;color:#10131c;font-weight:800;font-size:11px;cursor:pointer;font-family:var(--font)">➤</button>
        </div>
      </div>`;
    document.body.appendChild(p);
    setTimeout(() => document.getElementById('fpAnalystInput')?.focus(), 60);
  }

  function bubble(html, who) {
    const box = document.getElementById('fpAnalystMsgs');
    if (!box) return null;
    const b = document.createElement('div');
    b.style.cssText = who === 'q'
      ? 'margin:10px 0 6px auto;max-width:88%;background:rgba(212,160,23,.14);border:1px solid rgba(212,160,23,.3);border-radius:11px 11px 3px 11px;padding:8px 11px;font-size:10.5px;color:var(--white);line-height:1.5'
      : 'margin:6px auto 10px 0;max-width:94%;background:var(--bg2);border:1px solid var(--border);border-radius:11px 11px 11px 3px;padding:9px 12px;font-size:10.5px;color:var(--gray);line-height:1.6';
    b.innerHTML = html;
    box.appendChild(b);
    box.scrollTop = box.scrollHeight;
    return b;
  }

  async function ask(preset) {
    if (busy) return;
    const input = document.getElementById('fpAnalystInput');
    const q = (preset || input?.value || '').trim();
    if (!q) return;
    if (input) input.value = '';
    const ctx = buildContext();
    if (!ctx) return;
    bubble(q.replace(/</g, '&lt;'), 'q');
    const wait = bubble('<span style="color:var(--gray2)">L’analyste réfléchit<span id="fpDots">…</span></span>', 'a');
    busy = true;
    const btn = document.getElementById('fpAnalystSend');
    if (btn) btn.disabled = true;
    const dots = setInterval(() => {
      const d = document.getElementById('fpDots');
      if (d) d.textContent = d.textContent.length >= 3 ? '.' : d.textContent + '.';
    }, 400);
    try {
      // les 2 derniers échanges donnent la continuité conversationnelle
      const convCtx = history.slice(-2).map(h => `Q précédente: ${h.q}\nR précédente (résumé): ${h.a.slice(0, 300)}`).join('\n');
      const r = await fetch('/api/analyst', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: getUser(), question: (convCtx ? convCtx + '\n\nNOUVELLE QUESTION: ' : '') + q, context: ctx }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.answer) {
        wait.innerHTML = md(j.answer);
        history.push({ q, a: j.answer });
        try { window.AuditLog?.log({ action: 'analyst.ask', target: ctx.site?.nom, field: q.slice(0, 80) }); } catch {}
      } else if (j.error === 'NO_API_KEY') {
        wait.innerHTML = `<b style="color:var(--yellow)">Clé API manquante côté serveur.</b><br><br>
          Pour activer l'Analyste IA (2 min) :<br>
          1. Crée une clé sur <b>console.anthropic.com</b> → API Keys<br>
          2. Vercel → projet → Settings → Environment Variables → ajoute <b>ANTHROPIC_API_KEY</b><br>
          3. Redeploy. C'est tout.`;
      } else {
        wait.innerHTML = `<span style="color:var(--red)">Erreur : ${(j.message || j.error || 'HTTP ' + r.status).toString().replace(/</g,'&lt;').slice(0, 160)}</span>`;
      }
    } catch (e) {
      wait.innerHTML = `<span style="color:var(--red)">Connexion impossible — réseau ou fonction indisponible.</span>`;
    } finally {
      clearInterval(dots);
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  window.AiAnalyst = { open, ask };
})();
