// ================================================================
// FITNESS PARK ROMANIA — i18n (FR / EN)
// ================================================================
// Lightweight runtime i18n: `t('key')` lookup + localStorage-persisted
// locale + 'fp:locale-changed' event for re-renders.
//
// Coverage (v1) : full mobile UI (topbar, carousel, detail, sliders,
// P&L/Financement/BP template cards, FAB). Desktop sidebar main labels
// also covered. Deep desktop captage analysis + tour kept in FR.
// ================================================================

(function () {
  'use strict';

  const LS_KEY = 'fpLocale';
  const DEFAULT = 'fr';
  let currentLocale = (function () {
    try { return localStorage.getItem(LS_KEY) || DEFAULT; } catch { return DEFAULT; }
  })();

  const T = {
    fr: {
      // ─── Top bar / search ────────────────────────────────────────
      'topbar.search.placeholder': 'Bucarest…',
      'topbar.search.input': 'Ex: Bd. Iuliu Maniu 100, Bucarest',
      'topbar.locale.label': 'EN',
      'topbar.locale.title': 'Switch to English',

      // ─── Carousel card ───────────────────────────────────────────
      'card.site': 'SITE',
      'card.sector': 'Secteur',
      'card.phase': 'Phase',
      'card.members': 'Membres',
      'card.ctaViewAnalysis': "Voir l'analyse complète",

      // ─── Detail hero ─────────────────────────────────────────────
      'detail.prevSite': 'Site précédent',
      'detail.nextSite': 'Site suivant',
      'detail.hero.members': 'Membres cibles',
      'detail.hero.irrBase': 'IRR base',
      'detail.hero.npv5yr': 'NPV 5 ans',
      'detail.hero.sazScore': 'Score SAZ',
      'detail.hero.payback': 'Payback',
      'detail.hero.paybackNA': '—',
      'detail.hero.paybackMonths': 'mois',
      'detail.hero.scenarioBase': 'Scénario base',
      'detail.hero.zoneAttractiveness': 'Attractivité zone',

      // ─── Accordion heads ─────────────────────────────────────────
      'acc.location': 'Localisation',
      'acc.sazScore': 'Score attractivité (SAZ)',
      'acc.demographics': 'Démographie & marché',
      'acc.memberSources': 'Sources de membres',
      'acc.pnl3scenarios': 'P&L – 3 scénarios',
      'acc.financingEquity': 'Financement & IRR equity',
      'acc.competitors': 'Concurrents',
      'acc.bpTemplate': 'Structure coûts BP (type)',

      // ─── Location card ───────────────────────────────────────────
      'loc.coords': 'Coordonnées',
      'loc.sector': 'Secteur',
      'loc.surface': 'Surface',
      'loc.status': 'Statut',
      'loc.targetRent': 'Loyer cible',
      'loc.opening': 'Ouverture',

      // ─── Sources bars ────────────────────────────────────────────
      'src.captured': 'Captifs (concurrents)',
      'src.native': 'Natifs (nouvelle demande)',
      'src.walkIn': 'Walk-in (mall)',
      'src.destination': 'Destination (10km)',
      'src.total': 'total',
      'src.pctOfTotal': '% du total',

      // ─── Demographics ────────────────────────────────────────────
      'demo.popTarget': 'Pop. cible 15-45',
      'demo.popTargetHint': 'cible',
      'demo.arpu': 'ARPU blended',
      'demo.churnY1': 'Churn Y1',
      'demo.churnY2': 'Churn Y2+',
      'demo.ltv': 'LTV',
      'demo.ltvCac': 'LTV / CAC',

      // ─── Sliders ─────────────────────────────────────────────────
      'slider.rent.label': 'Loyer base Y1',
      'slider.rent.sub': 'Simulation temps réel',
      'slider.rent.marketHint': 'Marché 10-14',
      'slider.charge.label': 'Charges €/m²',
      'slider.charge.sub': 'Service + marketing fee',
      'slider.charge.standardHint': 'Standard 5.5',
      'slider.surface.label': 'Surface club',
      'slider.surface.sub': 'Variable par site',
      'slider.surface.refHint': 'Ref Hala 1 449',
      'slider.allInY1.prefix': 'Total all-in Y1 : ',
      'slider.allInY1.perYear': '/an',

      // ─── P&L scenarios ───────────────────────────────────────────
      'pnl.scenario.conservative': 'Conservateur',
      'pnl.scenario.base': 'Base',
      'pnl.scenario.optimistic': 'Optimiste',
      'pnl.npv': 'NPV',
      'pnl.breakeven': 'Breakeven',
      'pnl.payback': 'Payback',
      'pnl.moShort': 'mo',

      // ─── Financing card ──────────────────────────────────────────
      'fin.structure': 'Structure financement CAPEX',
      'fin.equity': 'Apport associés',
      'fin.loan': 'Emprunt bancaire',
      'fin.rate': 'Taux annuel',
      'fin.term': 'Durée',
      'fin.years': 'ans',
      'fin.monthlyPmt': 'Échéance mensuelle',
      'fin.totalInterest': 'Intérêts cumulés 7 ans',
      'fin.irrProject': 'IRR Projet',
      'fin.irrEquity': 'IRR Equity',
      'fin.irrLabelUnlevered': '(unlevered)',
      'fin.irrLabelLevered': '(levered)',
      'fin.equityShort': 'Equity',
      'fin.loanShort': 'Emprunt',

      // ─── BP Template card ────────────────────────────────────────
      'bp.revenues': 'Revenus',
      'bp.costRates': 'Coûts — Taux appliqués',
      'bp.rentStepped': 'Loyer stepped (Hala Laminor — objectif négo)',
      'bp.capexFinancing': 'CAPEX & Financement',
      'bp.financialParams': 'Paramètres financiers & sortie',
      'bp.onairBenchmark': '📊 Benchmark OnAir Montreuil (référence)',
      'bp.targetMembersMaturity': 'Cible membres maturité',
      'bp.staff': 'Staff (salaires + charges)',
      'bp.costOfSales': 'Cost of Sales (marchandises)',
      'bp.opexY1': 'OPEX ops Y1 (ramp-up)',
      'bp.opexY5': 'OPEX ops Y5+ (cruising)',
      'bp.franchiseRoyalty': 'Redevance franchise',
      'bp.adFund': 'Fonds publicitaire',
      'bp.fpCloud': 'FP Cloud SaaS',
      'bp.leasing': 'Leasing équipement',
      'bp.surfaceType': 'Surface type',
      'bp.capexTotal': 'CAPEX total',
      'bp.loanRate': 'Taux emprunt',
      'bp.loanTerm': 'Durée emprunt',
      'bp.wacc': 'WACC (actualisation)',
      'bp.cit': 'CIT Roumanie',
      'bp.exitMultiple': 'Exit multiple EV/EBITDA',
      'bp.pnlHorizon': 'Horizon P&L',
      'bp.pnlHorizonVal': '60 mois (5 ans)',
      'bp.growthA4A6': 'Croissance A4-A6',
      'bp.growthA7': 'Croissance A7+',
      'bp.indexation': 'Indexation HICP',
      'bp.indexationVal': '3%/an à partir de Y2',
      'bp.postMaturity': 'Post-maturité',
      'bp.longTerm': 'Long terme (= inflation)',
      'bp.scaledSurface': 'Scalé',
      'bp.refHala': 'ref Hala',
      'bp.perCA': 'du CA',
      'bp.perCAAdh': 'CA adh.',
      'bp.perMonth': '€/mois',

      // ─── FAB secondary sheet ─────────────────────────────────────
      // Pas d'emojis ici : évite troncature ellipsis sur viewport mobile 375px
      // (les 4 tabs partagent équitablement la largeur dispo).
      'fab.layers': 'Couches',
      'fab.competitors': 'Concurrence',
      'fab.mySites': 'Mes sites',
      'fab.dashboard': 'Dashboard',
      'fab.back': 'Retour',
      'fab.close': 'Fermer',

      // ─── My sites ────────────────────────────────────────────────
      'mysites.allHeader': '⭐ TOUS LES SITES',
      'mysites.badgePriority': 'Priorité',
      'mysites.badgeCustom': 'Custom',
      'mysites.addNew': 'Ajouter un site',
      'mysites.address': 'Adresse',
      'mysites.name': 'Nom du site',
      'mysites.btnAdd': 'Ajouter',

      // ─── Add-site overlay ────────────────────────────────────────
      'addsite.title': 'Ajouter un site',
      'addsite.subtitle': 'Bucharest et alentours',
      'addsite.placeholder': 'Rechercher une adresse…',
      'addsite.hint.bigIcon': '📍',
      'addsite.hint.text': 'Tape une adresse, un nom de bâtiment ou un centre commercial',
      'addsite.loading': 'Recherche en cours…',
      'addsite.empty': 'Aucun résultat',
      'addsite.preview.label': 'Site sélectionné',
      'addsite.preview.nameField': 'Nom affiché',
      'addsite.confirm': 'Ajouter ce site',
      'addsite.added': 'Site ajouté — analyse en cours',
      'addsite.error': 'Impossible d\'ajouter ce site',
      'addsite.footer': 'Powered by Google Places',

      // ─── Competitors ─────────────────────────────────────────────
      'comp.captifs': 'captifs',
      'comp.proximityTitle': 'Proximité concurrentielle',
      'comp.topBrands': 'Top marques — captifs potentiels',
      'comp.distance.close': '0-1 km (PROCHE)',
      'comp.distance.medium': '1-2 km (MOYEN)',
      'comp.distance.far': '2-3 km (ÉLOIGNÉ)',
      'comp.clubsLabel': 'clubs',

      // ─── Desktop: topbar + tabs ──────────────────────────────────
      'dtopbar.subtitle.html': 'Expansion Intelligence Platform <span style="font-weight:600;color:var(--gray);letter-spacing:.3px">Romania</span>',
      'dsearch.placeholder': 'Rechercher une adresse à Bucarest…',
      'dtab.explore': 'Explorer',
      'dtab.compete': 'Concurrence',
      'dtab.mysites': 'Mes Sites',
      'dtab.dash': 'Dashboard',
      'dtab.site': 'Fiche',
      'dtab.sources': 'Sources',

      // ─── Desktop: layers card ────────────────────────────────────
      'dlayers.title': 'Couches cartographiques',
      'dlayers.sectors.label': 'Secteurs & SAZ',
      'dlayers.sectors.hint': "Score d'attractivité par secteur",
      'dlayers.competitors.label': 'Concurrents',
      'dlayers.competitors.hint': 'Détection temps réel via Overpass API',
      'dlayers.heatmap.label': 'Heatmap concurrence',
      'dlayers.heatmap.hint': 'Zones saturées vs opportunités',
      'dlayers.transport.label': 'Métro & transports',
      'dlayers.transport.hint': 'Stations métro M1-M5 Bucharest',
      'dlayers.pois.label': 'Universités, malls, bureaux',
      'dlayers.pois.hint': '14 universités, 13 malls, 5 pôles bureaux',
      'dlayers.cartiere.label': 'Quartiers (cartiere)',
      'dlayers.cartiere.hint': '50 quartiers colorés par score jeunesse',
      'dlayers.heatDensity.label': 'Heatmap densité',
      'dlayers.heatDensity.hint': '397k bâtiments volumétriques, calibré census',
      'dlayers.dens.combined': 'Combiné',
      'dlayers.dens.night': 'Nuit',
      'dlayers.dens.day': 'Jour',
      'dlayers.youth.label': 'Heatmap jeunesse',
      'dlayers.youth.hint': 'Universités + quartiers jeunes',

      // ─── Desktop: filter + analysis mode ─────────────────────────
      'dfilter.title': 'Filtrer concurrents',
      'common.all': 'Tout',
      'common.none': 'Aucun',
      'danalysis.mode': 'Mode analyse',
      'danalysis.hint': 'Activez puis cliquez sur la carte',

      // ─── Desktop: catchment zone ─────────────────────────────────
      'dzone.title': 'Zone de chalandise',
      'diso.walk': '🚶 10min marche',
      'diso.drive': '🚗 10min voiture',
      'diso.transit': '🚇 10min métro',
      'diso.circle': '⚪ Cercle',

      // ─── Desktop: SAZ weights ────────────────────────────────────
      'dsaz.weights.title': 'Poids SAZ (ajustables)',
      'dsaz.flux': 'Flux',
      'dsaz.density': 'Densité',
      'dsaz.youth': 'Jeunesse',
      'dsaz.reset': 'Reset 33/33/34',
      'dsaz.preset.flux': 'Flux-first',
      'dsaz.preset.density': 'Densité-first',

      // ─── Desktop: sectors + actions + targets ────────────────────
      'dsectors.title': 'Secteurs Bucarest',
      'dactions.title': 'Actions',
      'dactions.demo': 'Mode Démo',
      'dactions.loadComp': 'Charger concurrents',
      'dactions.analyzeAll': 'Analyser tout',
      'dactions.overlap': 'Overlap sites',
      'dtargets.title': 'Sites cibles BP',
      'dtargets.badge': 'Phase 1-2',

      // ─── Desktop: user panel + replay ────────────────────────────
      'duser.title': 'Gestion utilisateurs',
      'duser.replay': '♫ Revoir la présentation',
      'duser.logout': 'Déconnexion',
      'duser.close': 'Fermer',

      // ─── Desktop: map legend ─────────────────────────────────────
      'dlegend.premium': 'Premium',
      'dlegend.mid': 'Mid-range',
      'dlegend.low': 'Low-cost',
      'dlegend.indep': 'Indépendant',
      'dlegend.target': 'Site cible FP',

      // ─── Common ──────────────────────────────────────────────────
      'common.yes': 'Oui',
      'common.no': 'Non',
      'common.perMonth': '/mois',
      'common.perYear': '/an',
      'common.offlineHint': 'Hors ligne — recherche désactivée',
      'common.offlineBanner': 'Hors ligne — les fonctions réseau sont désactivées',
      'common.onlineBack': 'De nouveau en ligne',
    },

    en: {
      // ─── Top bar / search ────────────────────────────────────────
      'topbar.search.placeholder': 'Bucharest…',
      'topbar.search.input': 'Ex: Bd. Iuliu Maniu 100, Bucharest',
      'topbar.locale.label': 'FR',
      'topbar.locale.title': 'Basculer en français',

      // ─── Carousel card ───────────────────────────────────────────
      'card.site': 'SITE',
      'card.sector': 'Sector',
      'card.phase': 'Phase',
      'card.members': 'Members',
      'card.ctaViewAnalysis': 'View full analysis',

      // ─── Detail hero ─────────────────────────────────────────────
      'detail.prevSite': 'Previous site',
      'detail.nextSite': 'Next site',
      'detail.hero.members': 'Target members',
      'detail.hero.irrBase': 'Base IRR',
      'detail.hero.npv5yr': 'NPV 5yr',
      'detail.hero.sazScore': 'SAZ Score',
      'detail.hero.payback': 'Payback',
      'detail.hero.paybackNA': '—',
      'detail.hero.paybackMonths': 'mo',
      'detail.hero.scenarioBase': 'Base scenario',
      'detail.hero.zoneAttractiveness': 'Zone attractiveness',

      // ─── Accordion heads ─────────────────────────────────────────
      'acc.location': 'Location',
      'acc.sazScore': 'Attractiveness score (SAZ)',
      'acc.demographics': 'Demographics & market',
      'acc.memberSources': 'Member sources',
      'acc.pnl3scenarios': 'P&L – 3 scenarios',
      'acc.financingEquity': 'Financing & Equity IRR',
      'acc.competitors': 'Competitors',
      'acc.bpTemplate': 'BP cost structure (template)',

      // ─── Location card ───────────────────────────────────────────
      'loc.coords': 'Coordinates',
      'loc.sector': 'Sector',
      'loc.surface': 'Surface',
      'loc.status': 'Status',
      'loc.targetRent': 'Target rent',
      'loc.opening': 'Opening',

      // ─── Sources bars ────────────────────────────────────────────
      'src.captured': 'Captured (from competitors)',
      'src.native': 'Native (new demand)',
      'src.walkIn': 'Walk-in (mall)',
      'src.destination': 'Destination (10km)',
      'src.total': 'total',
      'src.pctOfTotal': '% of total',

      // ─── Demographics ────────────────────────────────────────────
      'demo.popTarget': 'Target pop. 15-45',
      'demo.popTargetHint': 'target',
      'demo.arpu': 'Blended ARPU',
      'demo.churnY1': 'Churn Y1',
      'demo.churnY2': 'Churn Y2+',
      'demo.ltv': 'LTV',
      'demo.ltvCac': 'LTV / CAC',

      // ─── Sliders ─────────────────────────────────────────────────
      'slider.rent.label': 'Y1 base rent',
      'slider.rent.sub': 'Real-time simulation',
      'slider.rent.marketHint': 'Market 10-14',
      'slider.charge.label': 'Charges €/m²',
      'slider.charge.sub': 'Service + marketing fee',
      'slider.charge.standardHint': 'Standard 5.5',
      'slider.surface.label': 'Club surface',
      'slider.surface.sub': 'Variable per site',
      'slider.surface.refHint': 'Hala ref 1,449',
      'slider.allInY1.prefix': 'Y1 all-in total: ',
      'slider.allInY1.perYear': '/yr',

      // ─── P&L scenarios ───────────────────────────────────────────
      'pnl.scenario.conservative': 'Conservative',
      'pnl.scenario.base': 'Base',
      'pnl.scenario.optimistic': 'Optimistic',
      'pnl.npv': 'NPV',
      'pnl.breakeven': 'Breakeven',
      'pnl.payback': 'Payback',
      'pnl.moShort': 'mo',

      // ─── Financing card ──────────────────────────────────────────
      'fin.structure': 'CAPEX financing structure',
      'fin.equity': 'Equity contribution',
      'fin.loan': 'Bank loan',
      'fin.rate': 'Annual rate',
      'fin.term': 'Term',
      'fin.years': 'yrs',
      'fin.monthlyPmt': 'Monthly payment',
      'fin.totalInterest': 'Total interest 7yr',
      'fin.irrProject': 'Project IRR',
      'fin.irrEquity': 'Equity IRR',
      'fin.irrLabelUnlevered': '(unlevered)',
      'fin.irrLabelLevered': '(levered)',
      'fin.equityShort': 'Equity',
      'fin.loanShort': 'Loan',

      // ─── BP Template card ────────────────────────────────────────
      'bp.revenues': 'Revenue',
      'bp.costRates': 'Costs — Applied rates',
      'bp.rentStepped': 'Stepped rent (Hala Laminor — nego target)',
      'bp.capexFinancing': 'CAPEX & Financing',
      'bp.financialParams': 'Financial params & exit',
      'bp.onairBenchmark': '📊 OnAir Montreuil benchmark (reference)',
      'bp.targetMembersMaturity': 'Member target at maturity',
      'bp.staff': 'Staff (salary + charges)',
      'bp.costOfSales': 'Cost of Sales (merch)',
      'bp.opexY1': 'OPEX ops Y1 (ramp-up)',
      'bp.opexY5': 'OPEX ops Y5+ (cruising)',
      'bp.franchiseRoyalty': 'Franchise royalty',
      'bp.adFund': 'Advertising fund',
      'bp.fpCloud': 'FP Cloud SaaS',
      'bp.leasing': 'Equipment leasing',
      'bp.surfaceType': 'Surface',
      'bp.capexTotal': 'Total CAPEX',
      'bp.loanRate': 'Loan rate',
      'bp.loanTerm': 'Loan term',
      'bp.wacc': 'WACC (discount rate)',
      'bp.cit': 'Romania CIT',
      'bp.exitMultiple': 'Exit EV/EBITDA multiple',
      'bp.pnlHorizon': 'P&L horizon',
      'bp.pnlHorizonVal': '60 months (5 yrs)',
      'bp.growthA4A6': 'Growth A4-A6',
      'bp.growthA7': 'Growth A7+',
      'bp.indexation': 'HICP indexation',
      'bp.indexationVal': '3%/yr from Y2',
      'bp.postMaturity': 'Post-maturity',
      'bp.longTerm': 'Long term (= inflation)',
      'bp.scaledSurface': 'Scaled',
      'bp.refHala': 'Hala ref',
      'bp.perCA': 'of revenue',
      'bp.perCAAdh': 'member rev.',
      'bp.perMonth': '€/mo',

      // ─── FAB secondary sheet ─────────────────────────────────────
      'fab.layers': 'Layers',
      'fab.competitors': 'Competition',
      'fab.mySites': 'My sites',
      'fab.dashboard': 'Dashboard',
      'fab.back': 'Back',
      'fab.close': 'Close',

      // ─── My sites ────────────────────────────────────────────────
      'mysites.allHeader': '⭐ ALL SITES',
      'mysites.badgePriority': 'Priority',
      'mysites.badgeCustom': 'Custom',
      'mysites.addNew': 'Add a site',
      'mysites.address': 'Address',
      'mysites.name': 'Site name',
      'mysites.btnAdd': 'Add',

      // ─── Add-site overlay ────────────────────────────────────────
      'addsite.title': 'Add a site',
      'addsite.subtitle': 'Bucharest and surroundings',
      'addsite.placeholder': 'Search an address…',
      'addsite.hint.bigIcon': '📍',
      'addsite.hint.text': 'Type an address, a building name or a shopping mall',
      'addsite.loading': 'Searching…',
      'addsite.empty': 'No results',
      'addsite.preview.label': 'Selected site',
      'addsite.preview.nameField': 'Display name',
      'addsite.confirm': 'Add this site',
      'addsite.added': 'Site added — running analysis',
      'addsite.error': 'Could not add this site',
      'addsite.footer': 'Powered by Google Places',

      // ─── Competitors ─────────────────────────────────────────────
      'comp.captifs': 'captured',
      'comp.proximityTitle': 'Competitive proximity',
      'comp.topBrands': 'Top brands — potential captured',
      'comp.distance.close': '0-1 km (CLOSE)',
      'comp.distance.medium': '1-2 km (MID)',
      'comp.distance.far': '2-3 km (FAR)',
      'comp.clubsLabel': 'clubs',

      // ─── Desktop: topbar + tabs ──────────────────────────────────
      'dtopbar.subtitle.html': 'Expansion Intelligence Platform <span style="font-weight:600;color:var(--gray);letter-spacing:.3px">Romania</span>',
      'dsearch.placeholder': 'Search a Bucharest address…',
      'dtab.explore': 'Explore',
      'dtab.compete': 'Competition',
      'dtab.mysites': 'My Sites',
      'dtab.dash': 'Dashboard',
      'dtab.site': 'Site Card',
      'dtab.sources': 'Sources',

      // ─── Desktop: layers card ────────────────────────────────────
      'dlayers.title': 'Map layers',
      'dlayers.sectors.label': 'Sectors & SAZ',
      'dlayers.sectors.hint': 'Attractiveness score per sector',
      'dlayers.competitors.label': 'Competitors',
      'dlayers.competitors.hint': 'Real-time via Overpass API',
      'dlayers.heatmap.label': 'Competition heatmap',
      'dlayers.heatmap.hint': 'Saturated zones vs opportunities',
      'dlayers.transport.label': 'Metro & transit',
      'dlayers.transport.hint': 'Metro stations M1-M5 Bucharest',
      'dlayers.pois.label': 'Universities, malls, offices',
      'dlayers.pois.hint': '14 universities, 13 malls, 5 office hubs',
      'dlayers.cartiere.label': 'Neighbourhoods (cartiere)',
      'dlayers.cartiere.hint': '50 neighbourhoods colored by youth score',
      'dlayers.heatDensity.label': 'Density heatmap',
      'dlayers.heatDensity.hint': '397k volumetric buildings, census-calibrated',
      'dlayers.dens.combined': 'Combined',
      'dlayers.dens.night': 'Night',
      'dlayers.dens.day': 'Day',
      'dlayers.youth.label': 'Youth heatmap',
      'dlayers.youth.hint': 'Universities + young neighbourhoods',

      // ─── Desktop: filter + analysis mode ─────────────────────────
      'dfilter.title': 'Filter competitors',
      'common.all': 'All',
      'common.none': 'None',
      'danalysis.mode': 'Analysis mode',
      'danalysis.hint': 'Enable then click on the map',

      // ─── Desktop: catchment zone ─────────────────────────────────
      'dzone.title': 'Catchment zone',
      'diso.walk': '🚶 10min walk',
      'diso.drive': '🚗 10min drive',
      'diso.transit': '🚇 10min transit',
      'diso.circle': '⚪ Circle',

      // ─── Desktop: SAZ weights ────────────────────────────────────
      'dsaz.weights.title': 'SAZ weights (adjustable)',
      'dsaz.flux': 'Flow',
      'dsaz.density': 'Density',
      'dsaz.youth': 'Youth',
      'dsaz.reset': 'Reset 33/33/34',
      'dsaz.preset.flux': 'Flow-first',
      'dsaz.preset.density': 'Density-first',

      // ─── Desktop: sectors + actions + targets ────────────────────
      'dsectors.title': 'Bucharest sectors',
      'dactions.title': 'Actions',
      'dactions.demo': 'Demo mode',
      'dactions.loadComp': 'Load competitors',
      'dactions.analyzeAll': 'Analyze all',
      'dactions.overlap': 'Overlap sites',
      'dtargets.title': 'BP target sites',
      'dtargets.badge': 'Phase 1-2',

      // ─── Desktop: user panel + replay ────────────────────────────
      'duser.title': 'User management',
      'duser.replay': '♫ Replay the intro',
      'duser.logout': 'Log out',
      'duser.close': 'Close',

      // ─── Desktop: map legend ─────────────────────────────────────
      'dlegend.premium': 'Premium',
      'dlegend.mid': 'Mid-range',
      'dlegend.low': 'Low-cost',
      'dlegend.indep': 'Independent',
      'dlegend.target': 'FP target site',

      // ─── Common ──────────────────────────────────────────────────
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.perMonth': '/mo',
      'common.perYear': '/yr',
      'common.offlineHint': 'Offline — search disabled',
      'common.offlineBanner': 'Offline — network features disabled',
      'common.onlineBack': 'Back online',
    },
  };

  function t(key, params) {
    const dict = T[currentLocale] || T[DEFAULT];
    let str = (dict[key] !== undefined) ? dict[key] : (T[DEFAULT][key] !== undefined ? T[DEFAULT][key] : key);
    if (params && typeof str === 'string') {
      for (const k of Object.keys(params)) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
      }
    }
    return str;
  }

  function getLocale() { return currentLocale; }

  function setLocale(loc) {
    if (loc !== 'fr' && loc !== 'en') return;
    if (loc === currentLocale) return;
    currentLocale = loc;
    try { localStorage.setItem(LS_KEY, loc); } catch {}
    try {
      document.documentElement.setAttribute('lang', loc);
    } catch {}
    window.dispatchEvent(new CustomEvent('fp:locale-changed', { detail: { locale: loc } }));
  }

  function toggleLocale() {
    setLocale(currentLocale === 'fr' ? 'en' : 'fr');
  }

  // ─── DOM translator ───────────────────────────────────────────────
  // Applique les traductions à tous les éléments taggés [data-i18n] (textContent
  // ou innerHTML si clé finit par .html) et [data-i18n-placeholder] (placeholder).
  // Tagger le HTML : <span data-i18n="key.path">Défaut FR</span>.
  // Appelé au boot + à chaque fp:locale-changed.
  function applyI18n(root) {
    root = root || document;
    try {
      root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const val = t(key);
        if (key.endsWith('.html')) el.innerHTML = val;
        else el.textContent = val;
      });
      root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (!key) return;
        el.setAttribute('placeholder', t(key));
      });
      root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (!key) return;
        el.setAttribute('title', t(key));
      });
      root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria-label');
        if (!key) return;
        el.setAttribute('aria-label', t(key));
      });
    } catch (e) { console.warn('[fp i18n] applyI18n failed', e); }
  }

  // Triggers re-render pour les contenus générés dynamiquement (fonctions
  // desktop qui interpolent des strings FR dans innerHTML). Appelés au toggle.
  // Chaque fn est optionnelle — si elle n'existe pas, skip silencieusement.
  function triggerDynamicRerenders() {
    const fns = ['renderSectorList', 'renderTargets', 'renderDash', 'renderCustomSites',
                 'renderDemoBanner', 'buildBrandFilters', 'runComparison'];
    fns.forEach(name => {
      try { if (typeof window[name] === 'function') window[name](); } catch {}
    });
  }

  // Listener: au toggle locale, re-applique les tags + re-render dynamiques.
  window.addEventListener('fp:locale-changed', () => {
    applyI18n();
    triggerDynamicRerenders();
    // Met à jour le label du bouton toggle desktop (EN <-> FR).
    const pill = document.getElementById('fpDesktopLocale');
    if (pill) pill.textContent = t('topbar.locale.label');
    if (pill) pill.setAttribute('title', t('topbar.locale.title'));
  });

  // Expose globally
  window.t = t;
  window.getLocale = getLocale;
  window.setLocale = setLocale;
  window.toggleLocale = toggleLocale;
  window.applyI18n = applyI18n;

  try { document.documentElement.setAttribute('lang', currentLocale); } catch {}

  // Apply une première fois dès que le DOM est prêt (boot en FR par défaut, ou
  // EN si localStorage stocke déjà la préférence).
  function bootApply() {
    applyI18n();
    const pill = document.getElementById('fpDesktopLocale');
    if (pill) pill.textContent = t('topbar.locale.label');
    if (pill) pill.setAttribute('title', t('topbar.locale.title'));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApply);
  } else {
    bootApply();
  }
})();
