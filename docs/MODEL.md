# Model — Golden Numbers Reference

> **Purpose:** Every constant that drives the financial model, with source, reasoning, and date of last calibration. If you change a number here, bump `MODEL_VERSION` in `config.js` and re-run `tests/analysis.html`.

Last audited: **2026-04-18** (v6.0-onair-calibrated)

---

## 🎯 OnAir Calibration (v6.0)

All % of revenue ratios have been calibrated against the **OnAir Montreuil** (TEMATACA franchise) real financial statements (exercise 09/2024 → 08/2025, CA 2.24 M€, EBITDA 44.7%). Source: Plaquette TEMATACA (Fiteco expert-comptable).

| Poste | BP v5.x | BP v6.0 | OnAir réel | Notes |
|---|---:|---:|---:|---|
| Cost of Sales | 5.0% | **2.8%** | 2.77% | Achats marchandises revendues |
| OPEX ops | 20.0% | **15.0%** | ~12% | Énergie+maint+assu+télécom+marketing local. Calibré OnAir + prudence RO. |
| Fonds publicitaire | 2.0% | **1.0%** | 1.0% | Standard franchise fitness EU |
| Redevance franchise | 6.0% | **6.0%** | 4.0% | Maintenu 6% car **master-franchise Isseo** (vs franchise classique OnAir) |
| Staff | 9.0% | **9.0%** | 9.0% | Identique — taux BP FP officiel aligné réel |
| Loyer all-in | 12-15% | 12-15% | 12.4% | Steps Hala Laminor (real data) |

**Impact 5 sites vs v5.x :**
- Hala Laminor: IRR 48% → 58%, NPV 2.74 M€ → 3.70 M€
- Baneasa: IRR 51% → 61%, NPV 3.02 M€ → 4.01 M€
- Unirea: IRR 31% → 40%, NPV 1.28 M€ → 2.02 M€
- Grand Arena: IRR −9% → +2%, NPV −0.96 M€ → −0.53 M€
- Militari: IRR −4% → +7%, NPV −0.76 M€ → −0.29 M€

---

## 1. Fitness Park pricing (EUR TTC / month)

| Tier | Price TTC | Price HT | Source |
|------|-----------|----------|--------|
| Base (monthly, no commitment) | **28 €** | 23.14 € | BP V17, positioning vs Stay Fit 32€ / 18GYM 36€ |
| Premium | **40 €** | 33.06 € | Alignement offre FR, +accès club couple |
| Ultimate | **50 €** | 41.32 € | Sports collectifs + coaching |

Blended ARPU HT ≈ **27 €** depending on persona mix and `TAUX_VAD`.

**TAUX_VAD = 20%** (default, user-adjustable 5-50% via slider): share of customers on Premium/Ultimate tiers. Source: BP V17 C46.

**TVA_RO = 21%**: Romania VAT. Source: BP V17 C24.

---

## 2. Competitor pricing (monthly TTC)

| Brand | Price | Segment |
|-------|-------|---------|
| World Class | 46-145 € | premium |
| Downtown Fitness | 42 € | mid-premium |
| 18GYM | 36 € | mid |
| Stay Fit | 32 € | mid |
| Absolute Gym | 25 € | independent |
| Nr1 Fitness | 22 € | lowcost |

Sources: official brand websites verified March 2026.

---

## 3. Capture rates by competitor segment (CAPTURE_RATES)

`index.html` line ~3456. Probability a competitor member switches to FP (base rate, before distance/rating/strength modifiers).

| Segment | Rate | Reasoning |
|---------|-----:|-----------|
| premium        | **12%** | WC 46-145€ → FP 28€ (−50 to −117€). Churn WC ~20%, 60% consider low-cost alternatives. Benchmark: Basic-Fit captures 10-15% of premium on weekends. |
| mid-premium    | **18%** | Downtown 42€ → FP 28€ = −33%. Near-identical positioning; FP wins on price + brand + new equipment. |
| mid            | **22%** | Stay Fit 32€ / 18GYM 36€ → FP 28€. Identical target; FP cheaper with international brand. Benchmark WE: 20-25% mid→lowcost migration. |
| lowcost        | **6%**  | Already low-cost, but FP = international brand + premium equipment. Quality-dissatisfied migrate up. |
| independent    | **15%** | Aging equipment, no brand. FP offers modernity + competitive price. |
| crossfit       | **3%**  | Community niche, near-zero transferability. |
| boutique       | **2%**  | Unique experience, non-substitutable. |

**How to recalibrate:** after 6 months of operation, compare predicted captifs to actual migration. Adjust these rates within ±3%.

---

## 4. Distance decay function (`distanceDecay`)

`index.html` line ~3466. Adjusts the base capture rate based on how far a competitor's club is from the target site.

### With Google Distance Matrix (driving time)
| Drive time | Factor |
|-----------:|-------:|
| ≤ 3 min  | 1.00 |
| ≤ 5 min  | 0.85 |
| ≤ 8 min  | 0.65 |
| ≤ 12 min | 0.45 |
| ≤ 15 min | 0.25 |
| ≤ 20 min | 0.12 |
| > 20 min | 0.05 |

### Fallback (haversine)
| Distance | Factor |
|---------:|-------:|
| < 500 m | 1.00 |
| < 1 km  | 0.85 |
| < 1.5 km| 0.65 |
| < 2 km  | 0.45 |
| < 3 km  | 0.25 |
| < 4 km  | 0.12 |
| > 4 km  | 0.05 |

**Rationale:** empirical fitness retail heuristic — gym users won't drive more than 12 min for a mid-range club (source: IHRSA 2022 industry report).

---

## 5. Rating factor (`ratingFactor`)

Google rating adjustment on capture rate:
- Rating < 4.0 → **+30% per star below 4.0** (easier to capture, e.g. 3.6★ = +12%)
- Rating > 4.3 → **−20% per star above 4.3** (harder, e.g. 4.6★ = −6%)
- 4.0 ≤ rating ≤ 4.3 → neutral (×1.0)

---

## 6. Competitor strength factor (`competitorStrength`)

Review count is a proxy for establishment:
| Reviews | Factor | Interpretation |
|--------:|-------:|:---------------|
| < 100   | 1.15 | Small/new, easier to poach |
| 100-500 | 1.00 | Standard |
| 501-1000| 0.85 | Well-established |
| > 1000  | 0.75 | Dominant player (e.g. WC flagship) |

---

## 7. Walk-in conversion (`calcWalkIn`)

Mall / shopping centre traffic → FP membership conversion.

| Context | Conversion rate | Reason |
|---------|---------------:|--------|
| Standard mall (10-40k visitors/day) | **0.7 %** | Baseline impulse-visit-to-membership rate |
| **Premium mall (> 40k visitors/day)** | **1.0 %** | Higher-intent shopper base, longer dwell time |

Applied to daily footfall within 3 km radius.

**Source:** market benchmark Paul Becaud (Isseo internal data, other FP franchises).

---

## 8. Destination mall bonus (`calcDestinationBonus`)

Extends the catchment area for premium destination malls (Baneasa, AFI).

- Triggers only if mall has > 40k visitors/day
- Extended radius: **10 km** (vs 3 km standard)
- Conversion rate on extended zone: **0.4 %** (people who drive to the mall specifically)
- Subtracts the standard 3km catchment to avoid double-counting

**Rationale:** Baneasa attracts from all of Bucharest (city-wide destination). Standard 3km misses ~80% of its real catchment.

---

## 9. Native demand (`calcNativeDemand`)

New gym-goers not currently in any competitor.

Formula:
```
targetRate = 0.04 (4% target penetration for new-to-fitness)
untappedPct = max(0, targetRate - currentPenetration/100)
baseNative = popTarget × untappedPct
adjustedNative = baseNative × (0.3 + fpAttract × 0.7)  // attractiveness 0-1
```

Where `fpAttract = (SAZ.flux + SAZ.jeunesse) / 200`.

**Source:** Eurostat 2023 — Romania fitness penetration at 8% of adult pop vs 12% EU avg; untapped headroom.

---

## 10. Review → member estimation (dual model)

### Method A — Surface × Ratio (primary)
Calibrated on WC: 84,000 members / 45 clubs, avg 1,867 members/club, avg 1,867 m² → ratio **0.93 members/m²**.

Per-segment ratios:
| Segment | Ratio |
|---------|------:|
| Premium (with pool) | 0.85 mbr/m² |
| Mid-range           | 1.10 mbr/m² |
| Low-cost            | 1.50 mbr/m² |
| Independent         | 0.90 mbr/m² |

### Method B — Reviews × Multiplier (cross-check)
`REVIEWS_MULT = 3.9` — reviews per year × members per review/year.
`REVIEWS_ANNUAL_MULT = 43` — recalibrated with 16 verified review counts (March 2026).

Adjusted by `estimateAge()` — clubs open > 5 years accumulate reviews, younger clubs have fewer despite high member counts.

---

## 11. Financial model defaults (FP_DEFAULTS)

```js
priceBaseTTC:     28
pricePremiumTTC:  40
priceUltimateTTC: 50
loyerAnnuel:      236,400 €     // 1,449 m² × 13.6 €/m² × 12 months
clubSurface:      1,449 m²     // BP V17 standard
```

**CAPEX default:** **1,176,000 €** (BP V17: aménagement + équipement + franchise entry).

**DEFAULT_CAC:** **50 €** (marketing local estimation, BP V17).

---

## 12. P&L horizon & scenarios

- Horizon: **60 months** (5 years)
- Rent steps: Y1 negotiated → Y3 market rate with HICP indexation
- Scenarios:
  - **Conservateur:** 60% of theoretical members (0.6 ×)
  - **Base (réaliste):** 100% (1.0 ×)
  - **Optimiste:** 130% (1.3 ×)

IRR computed on 60-month cash flow discounted at 8% (FP France internal hurdle rate).

---

## 13. Population estimation

### POP_REAL_FACTOR = **1.3**
Adjusts INS 2022 census (1.72M) to account for ~30% undocumented residents (students, recent arrivals, temporary workers).

### INS_SECTOR_AGE
Age distribution per sector (2022 census), used to derive % of 15-45 year-old population:
```
Secteur 1: 43% young (pop 217k)
Secteur 2: 44% young (pop 292k)
Secteur 3: 44% young (pop 375k)
Secteur 4: 42% young (pop 268k)
Secteur 5: 40% young (pop 240k)
Secteur 6: 43% young (pop 325k)
```

---

## 14. SAZ (Score Attractivité Zone)

Composite 0-100 weighted:
- **flux** (33%): POI footfall within radius
- **densite** (33%): population density
- **jeunesse** (34%): % of 15-45 yo

User-adjustable weights via sliders.

### Verdict thresholds
| Score | Label |
|------:|-------|
| ≥ 70  | GO |
| 50-70 | GO CONDITIONNEL |
| 35-50 | WATCH |
| < 35  | NO-GO |

---

## 15. LTV/CAC & persona mix

### Churn rates by persona (annual)
- CSP++ urban premium:    18%
- CSP+ mature:            25%
- Student / young:        40%
- Family:                 22%

Blended by persona mix of nearby CARTIERE.

### LTV formula
```
LTV = ARPU_monthly × (1 / (churnRate / 12))  // months of avg retention × ARPU
```

### Target LTV/CAC ≥ **3×** (industry minimum), FP targets **> 10×**.

---

## 16. Invariants enforced at runtime (`src/invariants.js`)

These are **machine-checked** on every `runCaptageAnalysis` call:

| ID | Check |
|----|-------|
| `ana.total-sum` | totalTheorique = captifs + natifs + walkIn + destBonus (±2) |
| `ana.captifs-sum` | totalCaptifs = Σ comps[].captured |
| `ana.no-nan` | No NaN/Infinity in key numerics |
| `ana.saz-bounds` | SAZ scores ∈ [0, 100] |
| `ana.arpu-sanity` | ARPU ∈ [10, 80] €/month |
| `ana.churn-bounds` | Churn rates ∈ [0, 1] |
| `ana.pop-nonneg` | popTarget ≥ 0 |
| `ana.irr-sanity` | IRR finite, ∈ [-100, 500]% |
| `ana.ltv-positive` | LTV > 0 if members > 0 |
| `ana.inputs-valid` | lat/lng ∈ Bucharest range, radius ∈ [500m, 15km] |

Violations logged to `window._fpIssues`. Use `window.dumpInvariants()` to inspect.

---

## How to modify a constant

1. Read the reasoning above. If it's still valid, DON'T CHANGE.
2. If you have a new source (field data, vendor update), document it in a comment.
3. Edit the constant in `index.html` (or `config.js` for global).
4. Bump `MODEL_VERSION` in `config.js` (e.g. `v4.8-reliability` → `v4.9-calibrated`).
5. Run `tests/analysis.html` — the baseline regression will FAIL. Expected.
6. Review the drift. If expected, update `.baseline.json` + BASELINE in `tests/analysis.html`.
7. Commit with a message explaining **why the number changed**.
8. Push → Vercel redeploy.
