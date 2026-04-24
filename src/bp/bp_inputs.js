// ================================================================
// BP INPUTS METADATA — 41 inputs utilisateurs
// ================================================================
// Dérivé de HYPOTHESES col C (lignes 14-100), filtré pour exclure
// les headers de section et les non-numériques (EUR, ROM).
//
// Chaque input a : coord Excel, label, unité, valeur baseline,
// min/max/step, groupe visuel, note.
// ================================================================
(function (global) {
  'use strict';

  // Groupes visuels
  const G = {
    franchise: '🤝 Franchise & redevances',
    fiscal: '🧾 Fiscalité',
    commercial: '💳 Commercial & offre',
    rampup: '📈 Ramp-up & croissance',
    rh: '👥 Ressources humaines',
    loyer: '🏢 Loyer & surface',
    opex: '⚙️ OPEX opérationnels',
    capex: '🔨 CAPEX & leasing',
  };

  // Typage strict — chaque input a type, unité, bornes.
  // pct = pourcentage stocké en décimal (0.06 = 6%) — on affiche ×100.
  // eur = montant, nb = entier, ratio = multiplicateur.
  const INPUTS = [
    // Franchise & redevances
    { coord: 'C15', group: G.franchise, label: "Droit d'entrée par club franchisé",            unit: '€ / club',   type: 'eur', baseline: 45000,  min: 0,     max: 150000, step: 500 },
    { coord: 'C16', group: G.franchise, label: 'Redevance franchise → MF',                     unit: '% CA',       type: 'pct', baseline: 0.06,   min: 0,     max: 0.15,   step: 0.001 },
    { coord: 'C17', group: G.franchise, label: 'Fonds publicitaire',                           unit: '% CA',       type: 'pct', baseline: 0.02,   min: 0,     max: 0.05,   step: 0.001 },
    { coord: 'C18', group: G.franchise, label: 'Packs équipement par club',                    unit: '€ / club',   type: 'eur', baseline: 750000, min: 200000,max: 1500000,step: 5000 },
    { coord: 'C19', group: G.franchise, label: 'Marge sur vente packs',                        unit: '%',          type: 'pct', baseline: 0.075,  min: 0,     max: 0.25,   step: 0.005 },
    { coord: 'C20', group: G.franchise, label: "Droit d'entrée Holding / club",                unit: '€ / club',   type: 'eur', baseline: 10000,  min: 0,     max: 50000,  step: 500 },
    { coord: 'C21', group: G.franchise, label: 'Redevance succursales → FP France',            unit: '% CA',       type: 'pct', baseline: 0.06,   min: 0,     max: 0.12,   step: 0.001 },
    { coord: 'C22', group: G.franchise, label: 'Redevance franchises reversée → FP France',    unit: '% CA',       type: 'pct', baseline: 0.03,   min: 0,     max: 0.08,   step: 0.001 },
    // Fiscalité
    { coord: 'C23', group: G.fiscal,    label: 'Taux IS Roumanie',                             unit: '%',          type: 'pct', baseline: 0.16,   min: 0.10,  max: 0.30,   step: 0.005 },
    { coord: 'C24', group: G.fiscal,    label: 'Taux TVA Roumanie',                            unit: '%',          type: 'pct', baseline: 0.21,   min: 0.15,  max: 0.25,   step: 0.01 },
    // Commercial
    { coord: 'C34', group: G.commercial,label: 'Cible adhérents / club (maturité)',            unit: 'membres',    type: 'nb',  baseline: 3600,   min: 1500,  max: 6000,   step: 50 },
    { coord: 'C42', group: G.commercial,label: 'Tarif abo mensuel standard TTC',               unit: 'EUR',        type: 'eur', baseline: 27.8,   min: 15,    max: 60,     step: 0.1 },
    { coord: 'C46', group: G.commercial,label: 'Taux VAD (clients 45/50€)',                    unit: '%',          type: 'pct', baseline: 0.2,    min: 0,     max: 0.5,    step: 0.01 },
    { coord: 'C48', group: G.commercial,label: 'Loyer PT externe (mensuel/PT)',                unit: 'EUR/mois',   type: 'eur', baseline: 500,    min: 0,     max: 2000,   step: 50 },
    { coord: 'C41', group: G.commercial,label: "Frais d'adhésion HT",                          unit: 'EUR',        type: 'eur', baseline: 0,      min: 0,     max: 100,    step: 5 },
    // Ramp-up & croissance
    { coord: 'C35', group: G.rampup,    label: 'Ramp-up A1 (% cible)',                         unit: '%',          type: 'pct', baseline: 0.7,    min: 0.3,   max: 1.0,    step: 0.01 },
    { coord: 'C36', group: G.rampup,    label: 'Ramp-up A2 (% cible)',                         unit: '%',          type: 'pct', baseline: 0.9,    min: 0.5,   max: 1.0,    step: 0.01 },
    { coord: 'C37', group: G.rampup,    label: 'Churn annuel post-maturité',                   unit: '%',          type: 'pct', baseline: 0.043,  min: 0,     max: 0.15,   step: 0.005 },
    { coord: 'C38', group: G.rampup,    label: 'Croissance CA A4-A6',                          unit: '%/an',       type: 'pct', baseline: 0.05,   min: 0,     max: 0.15,   step: 0.005 },
    { coord: 'C39', group: G.rampup,    label: 'Croissance CA A7+',                            unit: '%/an',       type: 'pct', baseline: 0.02,   min: -0.05, max: 0.10,   step: 0.005 },
    // RH
    { coord: 'C56', group: G.rh,        label: 'Responsable de club',                          unit: 'EUR/an brut',type: 'eur', baseline: 36000,  min: 20000, max: 80000,  step: 500 },
    { coord: 'C57', group: G.rh,        label: 'Vendeurs (x2 ETP, par ETP)',                   unit: 'EUR/an brut',type: 'eur', baseline: 24000,  min: 15000, max: 50000,  step: 500 },
    { coord: 'C58', group: G.rh,        label: 'Charges patronales',                           unit: '%',          type: 'pct', baseline: 0.0225, min: 0,     max: 0.30,   step: 0.005 },
    { coord: 'C61', group: G.rh,        label: 'Augmentation annuelle salaires',               unit: '%/an',       type: 'pct', baseline: 0.06,   min: 0,     max: 0.15,   step: 0.005 },
    // Loyer
    { coord: 'C50', group: G.loyer,     label: 'Surface club',                                 unit: 'm²',         type: 'nb',  baseline: 1400,   min: 500,   max: 3000,   step: 10 },
    { coord: 'C51', group: G.loyer,     label: 'Loyer mensuel (hors charges)',                 unit: 'EUR/mois',   type: 'eur', baseline: 16900,  min: 3000,  max: 50000,  step: 100 },
    { coord: 'C52', group: G.loyer,     label: 'Charges locatives mensuelles',                 unit: 'EUR/mois',   type: 'eur', baseline: 2800,   min: 0,     max: 15000,  step: 100 },
    { coord: 'C54', group: G.loyer,     label: 'Augmentation annuelle loyer',                  unit: '%/an',       type: 'pct', baseline: 0.02,   min: 0,     max: 0.10,   step: 0.005 },
    // OPEX
    { coord: 'C63', group: G.opex,      label: 'Coût des ventes (accessoires VAD)',            unit: '% CA',       type: 'pct', baseline: 0.028,  min: 0,     max: 0.10,   step: 0.001 },
    { coord: 'C64', group: G.opex,      label: 'FP Cloud',                                     unit: 'EUR/mois',   type: 'eur', baseline: 600,    min: 0,     max: 5000,   step: 50 },
    { coord: 'C65', group: G.opex,      label: 'OPEX Ops (% CA, ratio A3)',                    unit: '% CA',       type: 'pct', baseline: 0.16,   min: 0.05,  max: 0.30,   step: 0.005 },
    { coord: 'C66', group: G.opex,      label: 'Augmentation OPEX annuelle',                   unit: '%/an',       type: 'pct', baseline: 0.045,  min: 0,     max: 0.15,   step: 0.005 },
    { coord: 'C67', group: G.opex,      label: 'OPEX Ops A1 (% CA)',                           unit: '% CA',       type: 'pct', baseline: 0.20,   min: 0.10,  max: 0.35,   step: 0.005 },
    { coord: 'C68', group: G.opex,      label: 'OPEX Ops A5+ (cruising)',                      unit: '% CA',       type: 'pct', baseline: 0.12,   min: 0.05,  max: 0.25,   step: 0.005 },
    { coord: 'C69', group: G.opex,      label: 'Impôts locaux (taxe foncière)',                unit: '% CA',       type: 'pct', baseline: 0.02,   min: 0,     max: 0.08,   step: 0.005 },
    // CAPEX
    { coord: 'C73', group: G.capex,     label: 'Référence travaux France',                     unit: 'EUR/m²',     type: 'eur', baseline: 800,    min: 400,   max: 1500,   step: 10 },
    { coord: 'C74', group: G.capex,     label: 'Remise travaux Roumanie',                      unit: '%',          type: 'pct', baseline: 0.25,   min: 0,     max: 0.50,   step: 0.01 },
    { coord: 'C78', group: G.capex,     label: 'Coût équipements / m²',                        unit: 'EUR/m²',     type: 'eur', baseline: 600,    min: 300,   max: 1200,   step: 10 },
    { coord: 'C79', group: G.capex,     label: 'Part équipements CAPEX',                       unit: '%',          type: 'pct', baseline: 0.4,    min: 0,     max: 1.0,    step: 0.05 },
    { coord: 'C82', group: G.capex,     label: 'Durée amortissement CAPEX',                    unit: 'années',     type: 'nb',  baseline: 10,     min: 3,     max: 15,     step: 1 },
    { coord: 'C87', group: G.capex,     label: 'Durée leasing',                                unit: 'années',     type: 'nb',  baseline: 5,      min: 3,     max: 10,     step: 1 },
    { coord: 'C90', group: G.capex,     label: 'Droit entrée pays (one-shot)',                 unit: 'EUR',        type: 'eur', baseline: 400000, min: 0,     max: 1000000,step: 10000 },
  ];

  global.BPInputs = {
    list: INPUTS,
    groups: G,
    byCoord: Object.fromEntries(INPUTS.map(i => [i.coord, i])),
  };

})(typeof window !== 'undefined' ? window : globalThis);
