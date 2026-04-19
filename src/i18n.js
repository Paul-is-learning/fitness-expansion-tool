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

      // ─── Desktop: tab-compete ────────────────────────────────────
      'dcompete.summary': 'Synthèse concurrentielle',
      'dcompete.placeholder': 'Cliquez sur un point de la carte ou lancez "Charger concurrents" pour démarrer l\'analyse.',
      'dcompete.filterBrand': 'Filtrer par marque',
      'dcompete.detected': 'Concurrents détectés',
      'dcompete.segment': 'Répartition par segment',
      'dcompete.gap': 'Gap Analysis par secteur',

      // ─── Desktop: tab-mysites ────────────────────────────────────
      'dmysites.title': "Mes sites d'implantation",
      'dmysites.addBtn': '+ Ajouter',
      'dmysites.hint': 'Cliquez "Ajouter" puis cliquez sur la carte pour positionner un site. Ou entrez une adresse ci-dessous.',
      'dmysites.addrPlaceholder': 'Adresse (ex: Bd. Iuliu Maniu 100)',
      'dmysites.geocode': 'Géocoder',
      'dmysites.analysisTitle': 'Analyse détaillée du site',
      'dmysites.closeAnalysis': '× Fermer',

      // ─── Desktop: captage widget ─────────────────────────────────
      'dcapt.title': 'Potentiel de captage',
      'dcapt.radius': 'Rayon de captage',
      'dcapt.captureRates': 'TAUX DE CAPTURE (ajustables)',
      'dcapt.premWC': 'Premium (WC)',
      'dcapt.midPrem': 'Mid-premium',
      'dcapt.midSF': 'Mid (SF/18G)',
      'dcapt.indep': 'Indépendant',
      'dcapt.low': 'Low-cost',
      'dcannibal.title': 'Risque de cannibalisation',

      // ─── Desktop: tab-dash ───────────────────────────────────────
      'ddash.zones': 'Zones analysées',
      'ddash.export': '📥 Export CSV',
      'ddash.col.zone': 'Zone',
      'ddash.col.pop': 'Pop.',
      'ddash.col.young': '15-45',
      'ddash.col.saz': 'SAZ ▲',
      'ddash.col.conc': 'Conc.',
      'ddash.col.closest': '+ proche',
      'ddash.col.potCA': 'Pot. CA',
      'ddash.col.reco': 'Reco',
      'ddash.compare': 'Comparaison sites',
      'ddash.siteA': '-- Site A --',
      'ddash.siteB': '-- Site B --',
      'ddash.trajectory': 'Trajectoire financière réseau',
      'ddash.bpParams': 'Paramètres clés BP',
      'ddash.pricing': 'Pricing benchmark Roumanie',

      // ─── Desktop: tab-site + sources ─────────────────────────────
      'dsitecard.placeholder.html': 'Cliquez sur un point de la carte<br>pour générer une fiche de due diligence',
      'dsources.title': 'Sources de données',
      'dsources.limits': 'Limites & avertissements',
      'dsector.row.pop': 'Pop',
      'dsector.row.youngRange': '15-45',

      // ─── Desktop: demo button (map overlay bottom-left) ──────────
      'ddemo.btn': '▶ Démonstration',
      'ddemo.title': "Lancer la présentation de l'outil",

      // ─── Desktop: demo panel (showDemoPanel modal) ───────────────
      'demopanel.title': "Démonstration de l'outil",
      'demopanel.sub': "Comprends en 2 minutes comment on transforme une intuition immobilière en décision chiffrée.",
      'demopanel.tour.title': "Visite guidée",
      'demopanel.tour.desc': "8 slides Apple-style, animations live. Tu découvres la map, les pins, les sliders, le SAZ, le P&L et le financement. Durée ~90s.",
      'demopanel.tour.cta': "▶ Lancer",
      'demopanel.how.title': "Comment ça marche ?",
      'demopanel.s1.title': "Tu cliques sur la carte",
      'demopanel.s1.desc.html': "Un cercle apparaît autour du site candidat. C'est la <b>zone de chalandise</b> (rayon 1-5 km, slider). Tout ce qui tombe dedans devient ton bassin d'opportunité.",
      'demopanel.s2.title': "3 sources de data se croisent",
      'demopanel.s2.desc': "La plateforme interroge en temps réel ou depuis sa base calibrée les sources publiques les plus fiables pour Bucharest.",
      'demopanel.s2.src1.title': "Population",
      'demopanel.s2.src1.desc': "OSM + Census INS 2021. 397k bâtiments volumétriques, 83 quartiers, population réelle ×1.7 (navetteurs Ilfov).",
      'demopanel.s2.src2.title': "Concurrents",
      'demopanel.s2.src2.desc': "Overpass API live + base vérifiée 92 clubs (WC, StayFit, 18GYM, Downtown, Nr1…).",
      'demopanel.s2.src3.title': "Flux & POI",
      'demopanel.s2.src3.desc': "Google Routes + OSM. Isochrones 10min marche/voiture/métro, 14 universités, 13 malls, 5 pôles bureaux.",
      'demopanel.s3.title': "Le SAZ pondère 3 piliers",
      'demopanel.s3.desc': "Score d'Attractivité de Zone 0-100, calibré sur les critères clés de succès d'un club fitness urbain à fort traffic. Poids ajustables par slider.",
      'demopanel.s3.flux': 'FLUX',
      'demopanel.s3.fluxDet': 'métro · malls · bureaux · universités · piétons',
      'demopanel.s3.dens': 'DENSITÉ',
      'demopanel.s3.densDet': "pop 15-45 · pouvoir d'achat · concurrence inverse",
      'demopanel.s3.youth': 'JEUNESSE',
      'demopanel.s3.youthDet': 'universités · âge quartier · nouveaux résidentiels',
      'demopanel.s3.verdict.html': "<b>Verdict</b> : GO (70+) · GO COND (45-69) · WATCH (30-44) · NO-GO (&lt;30)",
      'demopanel.s4.title': "Le captage projette les membres",
      'demopanel.s4.desc': "Pour chaque club concurrent dans le rayon, 4 facteurs calculent combien de membres switchent vers FP.",
      'demopanel.s5.title': "Le P&L tombe directement",
      'demopanel.s5.desc': "Membres × 28€/mois × ramp-up (A1 70% / A2 90% / A3 100%) → CA, EBITDA, IRR projet, IRR equity, NPV, breakeven, payback en 3 scénarios (conservateur / base / optimiste).",
      'demopanel.s6.title': "Tu compares et tu décides",
      'demopanel.s6.desc.html': "Dashboard avec tableau triable · export CSV · comparaison 2 sites côte à côte · détection cannibalisation (&lt;1,5 km = critique). Tu arbitres avec des chiffres, pas avec des intuitions.",

      // ─── Desktop: HIW carousel (How It Works) eyebrows + nav ─────
      'hiw.s1.eyebrow': 'ÉTAPE 1 · CHALANDISE',
      'hiw.s2.eyebrow': 'ÉTAPE 2 · DATA',
      'hiw.s3.eyebrow': 'ÉTAPE 3 · SCORE',
      'hiw.s4.eyebrow': 'ÉTAPE 4 · CAPTAGE',
      'hiw.s5.eyebrow': 'ÉTAPE 5 · P&L',
      'hiw.s6.eyebrow': 'ÉTAPE 6 · DÉCISION',
      'hiw.s5.conservative': 'CONSERVATEUR',
      'hiw.s5.base': 'BASE',
      'hiw.s5.optimistic': 'OPTIMISTE',
      'hiw.s5.footnote': 'Modèle calibré OnAir Montreuil (franchise FP auditée Fiteco). CA 2,24 M€ · EBITDA 44,7% à maturité.',
      'hiw.next': 'Suivant',
      'hiw.restart': 'Rejouer',

      // ─── HIW formule captage (simplifiée) ────────────────────────
      'hiw.capt.captifs': 'Captifs',
      'hiw.capt.captifsF': 'taux switch × proximité × qualité (Google) × écart de prix',
      'hiw.capt.natifs': 'Natifs',
      'hiw.capt.natifsF': 'pop non-inscrite × taux de conversion',
      'hiw.capt.walkinF': '0,7% × visiteurs mall (si en CC)',
      'hiw.capt.bonus': 'Dest. bonus',
      'hiw.capt.bonusF': 'proximité POI premium (malls, bureaux)',

      // ─── DemoPanel: 2 nouveaux CTAs (BP + Sources) ───────────────
      'demopanel.bp.title': 'Construction du BP',
      'demopanel.bp.desc': "7 étapes Apple-style. Hypothèses clés, courbe revenus 10 ans, structure de coûts % CA, CAPEX 1,2M€, méthodologie Monte Carlo (1 000 simulations), verdict chiffré. ~80s.",
      'demopanel.bp.cta': '▶ Lancer',
      'demopanel.sources.title': 'Sources de données',
      'demopanel.sources.desc': "6 étapes didactiques. INS census + OSM volumétrique, 92 clubs vérifiés, flux métro/tram/malls/bureaux, prix immobilier par quartier, rigueur et limites assumées. ~60s.",
      'demopanel.sources.cta': '▶ Lancer',

      // ─── Onboarding tour (8 slides + nav) ────────────────────────
      'tour.skip': 'Passer',
      'tour.cta.next': 'Suivant',
      'tour.skipConfirm.question': 'Passer le tour ?',
      'tour.skipConfirm.yes': 'Oui',
      'tour.skipConfirm.no': 'Non',
      // Slide 1 BIENVENUE
      'tour.s1.eyebrow': 'BIENVENUE',
      'tour.s1.title': 'FP Romania Expansion Intelligence',
      'tour.s1.subtitle': "L'outil d'expansion qui transforme une opportunité foncière en BP. En 30 secondes par site, tu as un go / no-go défendable et un pitch banquier prêt.",
      'tour.s1.cta': 'Découvrir',
      // Slide 2 CARTE LIVE
      'tour.s2.eyebrow': 'CARTE LIVE',
      'tour.s2.title': 'Identification des opportunités prioritaires',
      'tour.s2.subtitle': 'Hala Laminor, Unirea, Militari, Grand Arena, Baneasa. Pins numérotés, swipe pour comparer, analyse auto en 1 tap.',
      // Slide 3 SIMULATION TEMPS RÉEL
      'tour.s3.eyebrow': 'SIMULATION TEMPS RÉEL',
      'tour.s3.title': 'Sliders loyer · charges · surface',
      'tour.s3.subtitle': 'Ajuste les 3 paramètres par site. IRR, NPV, CAF, EBITDA recalculent en 90ms. Persistance par site, survit au reload.',
      // Slide 4 SCORE ATTRACTIVITÉ
      'tour.s4.eyebrow': 'SCORE ATTRACTIVITÉ',
      'tour.s4.title': 'SAZ · flux · densité · jeunesse',
      'tour.s4.subtitle': '3 anneaux animés qui résument la zone. Population captage 3 km + concurrents + démographie 15-45 ans.',
      // Slide 5 P&L 3 SCÉNARIOS
      'tour.s5.eyebrow': 'P&L 3 SCÉNARIOS',
      'tour.s5.title': 'Conservateur · Base · Optimiste',
      'tour.s5.subtitle': 'CA annuel, EBITDA, IRR projet, NPV, breakeven, payback. Modèle calibré OnAir Montreuil (franchise audité Fiteco).',
      // Slide 6 FINANCEMENT
      'tour.s6.eyebrow': 'FINANCEMENT',
      'tour.s6.title': 'IRR Projet vs IRR Equity',
      'tour.s6.subtitle': '30/70 equity/loan, 6,5% sur 7 ans. Effet levier calculé, intérêts cumulés modélisés, pitch banquier ready.',
      // Slide 7 SITES CUSTOM
      'tour.s7.eyebrow': 'SITES CUSTOM',
      'tour.s7.title': 'Ajoute une adresse, analyse auto',
      'tour.s7.subtitle': "Recherche une adresse → sélectionne → confirme. Captage, P&L, verdict IRR s'affichent en 2 secondes.",
      // Slide 8 PRÊT
      'tour.s8.eyebrow': 'PRÊT',
      'tour.s8.title': 'À toi la décision',
      'tour.s8.subtitle': 'Slide en carousel, ajuste les variables, compare, défends ton dossier. Bon pitch.',
      'tour.s8.cta': 'Commencer',

      // ─── TOUR BP cible pays (7 slides) ───────────────────────────
      'bp.s1.eyebrow': 'BP CIBLE PAYS · V17',
      'bp.s1.title': 'Business Plan FP Romania',
      'bp.s1.subtitle': "Modèle consolidé sur 10 ans. 40 clubs à maturité (A8), mix 18 propres / 22 franchises. Chiffres calibrés sur OnAir Montreuil (audit Fiteco) et ajustés au marché roumain.",
      'bp.s2.eyebrow': 'ÉTAPE 1 · HYPOTHÈSES',
      'bp.s2.title': '5 hypothèses clés qui pilotent tout',
      'bp.s2.subtitle': 'Prix, cible membres, ramp-up, churn, redevance MF. Chaque variable est documentée, sourcée, et stressée en Monte Carlo (voir étape 6).',
      'bp.s3.eyebrow': 'ÉTAPE 2 · REVENUS',
      'bp.s3.title': 'Courbe de revenus A1 → A10',
      'bp.s3.subtitle': 'Ouvertures progressives, montée en charge par cohorte. CA enseigne consolidé : 440 k€ A1 → 51,3 M€ A10. Ramp-up par club : 70% / 90% / 100% en 3 ans.',
      'bp.s4.eyebrow': 'ÉTAPE 3 · COÛTS',
      'bp.s4.title': 'Structure de coûts % CA',
      'bp.s4.subtitle': 'Staff, loyer, OPEX ops, royalties MF, fonds pub, impôts locaux RO. Total OPEX ~42% CA à maturité → EBITDA 53%+. Calibré sur OnAir (44,7% observé) avec 2% impôts locaux v6.25 (taxa pe clădiri).',
      'bp.s5.eyebrow': 'ÉTAPE 4 · CAPEX',
      'bp.s5.title': 'Investissement 1 176 k€ par club',
      'bp.s5.subtitle': "Fit-out 840 k€ (600€/m² × 1 400 m²) + équipement 336 k€ dont 60% en leasing 5 ans (504 k€ lissés). Financement 30% equity / 70% dette bancaire 6,5% sur 7 ans.",
      'bp.s6.eyebrow': 'ÉTAPE 5 · MONTE CARLO',
      'bp.s6.title': 'Distribution IRR simulée',
      'bp.s6.subtitle': "1 000 simulations Monte Carlo avec variables stochastiques : prix (±10%), membres (±15%), loyer (±20%), churn (±5pp), délai ouverture (±6 mois). Résultat : médiane 57% IRR, P10 38%, P90 79%.",
      'bp.s7.eyebrow': 'VERDICT',
      'bp.s7.title': 'BP robuste et défendable',
      'bp.s7.subtitle': 'IRR équité +57,6% · NPV 3,9 M€ · Payback 38 mois. Scénarios stress-tested, sources documentées, méthodologie Monte Carlo auditable. Prêt pour pitch banquier.',

      // ─── TOUR Sources de données (6 slides) ──────────────────────
      'data.s1.eyebrow': 'SOURCES · TRANSPARENCE',
      'data.s1.title': "D'où viennent les données ?",
      'data.s1.subtitle': "6 sources publiques et vérifiables, cross-référencées. Aucune black box. Chaque chiffre est traçable jusqu'à sa source officielle.",
      'data.s2.eyebrow': 'POPULATION',
      'data.s2.title': 'Census INS + volumétrie OSM',
      'data.s2.subtitle': "Recensement 2021 officiel (1,72 M hab. déclarés) × 1,7 pour intégrer les navetteurs Ilfov, expats et non-déclarés → 2,9 M pop effective. Ventilation par quartier via volumétrie OSM (emprise × étages).",
      'data.s3.eyebrow': 'CONCURRENTS',
      'data.s3.title': '92 clubs vérifiés manuellement',
      'data.s3.subtitle': "Overpass API (OpenStreetMap) en live + base vérifiée 92 clubs (World Class, Stay Fit, 18GYM, Downtown, Nr1, boutiques). Surfaces et effectifs cross-référencés avec sites officiels et Google Reviews.",
      'data.s4.eyebrow': 'FLUX & TRANSPORT',
      'data.s4.title': 'Métro, tram, malls, bureaux',
      'data.s4.subtitle': "Metrorex 53 stations M1-M5 (750k pax/jour), STB 2,7 M pax tram/bus, 12 malls (AFI Cotroceni 60k visiteurs/jour), 340k employés en bureaux (Cushman & Wakefield H1 2025). Isochrones Google Routes.",
      'data.s5.eyebrow': 'IMMOBILIER',
      'data.s5.title': 'Prix m² par quartier',
      'data.s5.subtitle': "imobiliare.ro et investropa.com 2025 · de 700 €/m² (Ferentari) à 3 200 €/m² (Primaverii). Proxy de revenu utilisé pour pondérer l'élasticité prix et le pouvoir d'achat local.",
      'data.s6.eyebrow': 'RIGUEUR',
      'data.s6.title': 'Cross-vérification et limites assumées',
      'data.s6.subtitle': "Chaque donnée est triangulée (OSM × INS × Google). 92 clubs concurrents validés manuellement. Modèle financier calibré sur OnAir Montreuil (franchise FP auditée par Fiteco). Limites documentées dans l'onglet Sources de l'outil.",

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

      // ─── Desktop: tab-compete ────────────────────────────────────
      'dcompete.summary': 'Competitive overview',
      'dcompete.placeholder': 'Click on a map point or hit "Load competitors" to start the analysis.',
      'dcompete.filterBrand': 'Filter by brand',
      'dcompete.detected': 'Competitors detected',
      'dcompete.segment': 'Segment distribution',
      'dcompete.gap': 'Gap analysis per sector',

      // ─── Desktop: tab-mysites ────────────────────────────────────
      'dmysites.title': 'My target sites',
      'dmysites.addBtn': '+ Add',
      'dmysites.hint': 'Click "Add" then click on the map to place a site. Or enter an address below.',
      'dmysites.addrPlaceholder': 'Address (e.g. Bd. Iuliu Maniu 100)',
      'dmysites.geocode': 'Geocode',
      'dmysites.analysisTitle': 'Detailed site analysis',
      'dmysites.closeAnalysis': '× Close',

      // ─── Desktop: captage widget ─────────────────────────────────
      'dcapt.title': 'Capture potential',
      'dcapt.radius': 'Capture radius',
      'dcapt.captureRates': 'CAPTURE RATES (adjustable)',
      'dcapt.premWC': 'Premium (WC)',
      'dcapt.midPrem': 'Mid-premium',
      'dcapt.midSF': 'Mid (SF/18G)',
      'dcapt.indep': 'Independent',
      'dcapt.low': 'Low-cost',
      'dcannibal.title': 'Cannibalisation risk',

      // ─── Desktop: tab-dash ───────────────────────────────────────
      'ddash.zones': 'Zones analyzed',
      'ddash.export': '📥 Export CSV',
      'ddash.col.zone': 'Zone',
      'ddash.col.pop': 'Pop.',
      'ddash.col.young': '15-45',
      'ddash.col.saz': 'SAZ ▲',
      'ddash.col.conc': 'Comp.',
      'ddash.col.closest': 'Nearest',
      'ddash.col.potCA': 'Rev. pot.',
      'ddash.col.reco': 'Reco',
      'ddash.compare': 'Site comparison',
      'ddash.siteA': '-- Site A --',
      'ddash.siteB': '-- Site B --',
      'ddash.trajectory': 'Network financial trajectory',
      'ddash.bpParams': 'Key BP parameters',
      'ddash.pricing': 'Romania pricing benchmark',

      // ─── Desktop: tab-site + sources ─────────────────────────────
      'dsitecard.placeholder.html': 'Click on a point on the map<br>to generate a due diligence sheet',
      'dsources.title': 'Data sources',
      'dsources.limits': 'Limitations & caveats',
      'dsector.row.pop': 'Pop',
      'dsector.row.youngRange': '15-45',

      // ─── Desktop: demo button (map overlay bottom-left) ──────────
      'ddemo.btn': '▶ Demo tour',
      'ddemo.title': 'Launch the product walkthrough',

      // ─── Desktop: demo panel (showDemoPanel modal) ───────────────
      'demopanel.title': 'Product demo',
      'demopanel.sub': 'Understand in 2 minutes how we turn a real-estate hunch into a data-backed decision.',
      'demopanel.tour.title': 'Guided tour',
      'demopanel.tour.desc': '8 Apple-style slides with live animations. Covers the map, pins, sliders, SAZ, P&L and financing. ~90s.',
      'demopanel.tour.cta': '▶ Launch',
      'demopanel.how.title': 'How it works',
      'demopanel.s1.title': 'Click on the map',
      'demopanel.s1.desc.html': "A circle appears around the candidate site. That's the <b>catchment zone</b> (1-5 km radius, slider). Everything inside becomes your opportunity pool.",
      'demopanel.s2.title': '3 data sources cross-reference',
      'demopanel.s2.desc': 'The platform queries in real-time or from its calibrated base the most reliable public sources for Bucharest.',
      'demopanel.s2.src1.title': 'Population',
      'demopanel.s2.src1.desc': 'OSM + INS Census 2021. 397k volumetric buildings, 83 neighbourhoods, real population ×1.7 (Ilfov commuters).',
      'demopanel.s2.src2.title': 'Competitors',
      'demopanel.s2.src2.desc': 'Overpass API live + verified base of 92 clubs (WC, StayFit, 18GYM, Downtown, Nr1…).',
      'demopanel.s2.src3.title': 'Flow & POI',
      'demopanel.s2.src3.desc': 'Google Routes + OSM. 10min walk/drive/transit isochrones, 14 universities, 13 malls, 5 office hubs.',
      'demopanel.s3.title': 'SAZ weights 3 pillars',
      'demopanel.s3.desc': "Zone Attractiveness Score 0-100, calibrated on the key success factors of a high-traffic urban fitness club. Weights adjustable via sliders.",
      'demopanel.s3.flux': 'FLOW',
      'demopanel.s3.fluxDet': 'metro · malls · offices · universities · pedestrians',
      'demopanel.s3.dens': 'DENSITY',
      'demopanel.s3.densDet': 'pop 15-45 · purchasing power · inverse competition',
      'demopanel.s3.youth': 'YOUTH',
      'demopanel.s3.youthDet': 'universities · neighbourhood age · new residential',
      'demopanel.s3.verdict.html': '<b>Verdict</b>: GO (70+) · GO COND (45-69) · WATCH (30-44) · NO-GO (&lt;30)',
      'demopanel.s4.title': 'Capture projects the members',
      'demopanel.s4.desc': 'For each competitor club in the radius, 4 factors compute how many members switch to FP.',
      'demopanel.s5.title': 'The P&L drops instantly',
      'demopanel.s5.desc': 'Members × 28€/mo × ramp-up (Y1 70% / Y2 90% / Y3 100%) → Revenue, EBITDA, project IRR, equity IRR, NPV, breakeven, payback in 3 scenarios (conservative / base / optimistic).',
      'demopanel.s6.title': 'Compare and decide',
      'demopanel.s6.desc.html': 'Sortable dashboard table · CSV export · side-by-side comparison · cannibalisation detection (&lt;1.5 km = critical). You decide with numbers, not hunches.',

      // ─── Desktop: HIW carousel eyebrows + nav ────────────────────
      'hiw.s1.eyebrow': 'STEP 1 · CATCHMENT',
      'hiw.s2.eyebrow': 'STEP 2 · DATA',
      'hiw.s3.eyebrow': 'STEP 3 · SCORE',
      'hiw.s4.eyebrow': 'STEP 4 · CAPTURE',
      'hiw.s5.eyebrow': 'STEP 5 · P&L',
      'hiw.s6.eyebrow': 'STEP 6 · DECISION',
      'hiw.s5.conservative': 'CONSERVATIVE',
      'hiw.s5.base': 'BASE',
      'hiw.s5.optimistic': 'OPTIMISTIC',
      'hiw.s5.footnote': 'Calibrated on OnAir Montreuil (FP franchise audited by Fiteco). Revenue 2.24M€ · EBITDA 44.7% at maturity.',
      'hiw.next': 'Next',
      'hiw.restart': 'Replay',

      // ─── HIW capture formula (simplified) ────────────────────────
      'hiw.capt.captifs': 'Captive',
      'hiw.capt.captifsF': 'switch rate × proximity × quality (Google) × price gap',
      'hiw.capt.natifs': 'Native',
      'hiw.capt.natifsF': 'non-registered pop × conversion rate',
      'hiw.capt.walkinF': '0.7% × mall visitors (if in CC)',
      'hiw.capt.bonus': 'Dest. bonus',
      'hiw.capt.bonusF': 'proximity to premium POI (malls, offices)',

      // ─── DemoPanel: 2 new CTAs (BP + Sources) ────────────────────
      'demopanel.bp.title': 'BP construction',
      'demopanel.bp.desc': '7 Apple-style steps. Key assumptions, 10-year revenue curve, cost structure % revenue, 1.2M€ CAPEX, Monte Carlo methodology (1,000 simulations), quantified verdict. ~80s.',
      'demopanel.bp.cta': '▶ Launch',
      'demopanel.sources.title': 'Data sources',
      'demopanel.sources.desc': '6 didactic steps. INS census + OSM volumetrics, 92 verified clubs, metro/tram/malls/offices flow, real-estate prices by neighbourhood, rigor and assumed limits. ~60s.',
      'demopanel.sources.cta': '▶ Launch',

      // ─── Onboarding tour (8 slides + nav) ────────────────────────
      'tour.skip': 'Skip',
      'tour.cta.next': 'Next',
      'tour.skipConfirm.question': 'Skip the tour?',
      'tour.skipConfirm.yes': 'Yes',
      'tour.skipConfirm.no': 'No',
      // Slide 1 WELCOME
      'tour.s1.eyebrow': 'WELCOME',
      'tour.s1.title': 'FP Romania Expansion Intelligence',
      'tour.s1.subtitle': 'The expansion tool that turns a real-estate opportunity into a BP. In 30 seconds per site, you get a defensible go/no-go and a bank-ready pitch.',
      'tour.s1.cta': 'Discover',
      // Slide 2 LIVE MAP
      'tour.s2.eyebrow': 'LIVE MAP',
      'tour.s2.title': 'Identify priority opportunities',
      'tour.s2.subtitle': 'Hala Laminor, Unirea, Militari, Grand Arena, Baneasa. Numbered pins, swipe to compare, auto-analysis in 1 tap.',
      // Slide 3 LIVE SIMULATION
      'tour.s3.eyebrow': 'LIVE SIMULATION',
      'tour.s3.title': 'Rent · charges · surface sliders',
      'tour.s3.subtitle': 'Tune the 3 params per site. IRR, NPV, CAF, EBITDA recalc in 90ms. Per-site persistence, survives reload.',
      // Slide 4 ATTRACTIVENESS SCORE
      'tour.s4.eyebrow': 'ATTRACTIVENESS SCORE',
      'tour.s4.title': 'SAZ · flow · density · youth',
      'tour.s4.subtitle': '3 animated rings that summarize the zone. Catchment population 3 km + competitors + demographics 15-45.',
      // Slide 5 P&L 3 SCENARIOS
      'tour.s5.eyebrow': 'P&L 3 SCENARIOS',
      'tour.s5.title': 'Conservative · Base · Optimistic',
      'tour.s5.subtitle': 'Annual revenue, EBITDA, project IRR, NPV, breakeven, payback. Calibrated on OnAir Montreuil (franchise audited by Fiteco).',
      // Slide 6 FINANCING
      'tour.s6.eyebrow': 'FINANCING',
      'tour.s6.title': 'Project IRR vs Equity IRR',
      'tour.s6.subtitle': '30/70 equity/loan, 6.5% over 7 years. Leverage effect computed, cumulative interest modeled, bank-pitch ready.',
      // Slide 7 CUSTOM SITES
      'tour.s7.eyebrow': 'CUSTOM SITES',
      'tour.s7.title': 'Add an address, auto-analysis',
      'tour.s7.subtitle': 'Search an address → select → confirm. Catchment, P&L, IRR verdict appear in 2 seconds.',
      // Slide 8 READY
      'tour.s8.eyebrow': 'READY',
      'tour.s8.title': 'Your call',
      'tour.s8.subtitle': 'Swipe the carousel, tune the variables, compare, defend your case. Have a great pitch.',
      'tour.s8.cta': 'Start',

      // ─── BP country-target tour (7 slides) ───────────────────────
      'bp.s1.eyebrow': 'COUNTRY BP · V17',
      'bp.s1.title': 'FP Romania Business Plan',
      'bp.s1.subtitle': 'Consolidated 10-year model. 40 clubs at maturity (Y8), mix of 18 owned / 22 franchises. Figures calibrated on OnAir Montreuil (Fiteco audit) and adjusted for the Romanian market.',
      'bp.s2.eyebrow': 'STEP 1 · ASSUMPTIONS',
      'bp.s2.title': '5 key assumptions that drive everything',
      'bp.s2.subtitle': 'Price, member target, ramp-up, churn, MF royalty. Every variable is documented, sourced, and stress-tested via Monte Carlo (see step 6).',
      'bp.s3.eyebrow': 'STEP 2 · REVENUE',
      'bp.s3.title': 'Revenue curve Y1 → Y10',
      'bp.s3.subtitle': 'Progressive openings, cohort-based ramp. Consolidated brand revenue: 440 k€ Y1 → 51.3 M€ Y10. Per-club ramp: 70% / 90% / 100% over 3 years.',
      'bp.s4.eyebrow': 'STEP 3 · COSTS',
      'bp.s4.title': 'Cost structure % revenue',
      'bp.s4.subtitle': 'Staff, rent, OpEx, MF royalties, marketing fund, RO local taxes. Total OpEx ~42% revenue at maturity → EBITDA 53%+. Calibrated on OnAir (44.7% observed) with 2% RO local taxes added in v6.25 (taxa pe clădiri).',
      'bp.s5.eyebrow': 'STEP 4 · CAPEX',
      'bp.s5.title': '1,176 k€ investment per club',
      'bp.s5.subtitle': 'Fit-out 840 k€ (600€/m² × 1,400 m²) + equipment 336 k€ of which 60% leased over 5 years (504 k€ smoothed). Financing 30% equity / 70% bank debt at 6.5% over 7 years.',
      'bp.s6.eyebrow': 'STEP 5 · MONTE CARLO',
      'bp.s6.title': 'Simulated IRR distribution',
      'bp.s6.subtitle': '1,000 Monte Carlo simulations with stochastic variables: price (±10%), members (±15%), rent (±20%), churn (±5pp), opening delay (±6 months). Result: median IRR 57%, P10 38%, P90 79%.',
      'bp.s7.eyebrow': 'VERDICT',
      'bp.s7.title': 'Robust, defensible BP',
      'bp.s7.subtitle': 'Equity IRR +57.6% · NPV 3.9 M€ · Payback 38 months. Stress-tested scenarios, documented sources, auditable Monte Carlo methodology. Ready for the bank pitch.',

      // ─── Data sources tour (6 slides) ────────────────────────────
      'data.s1.eyebrow': 'SOURCES · TRANSPARENCY',
      'data.s1.title': 'Where does the data come from?',
      'data.s1.subtitle': '6 public, verifiable sources, cross-referenced. No black box. Every number is traceable back to its official source.',
      'data.s2.eyebrow': 'POPULATION',
      'data.s2.title': 'INS census + OSM volumetrics',
      'data.s2.subtitle': 'Official 2021 census (1.72 M declared residents) × 1.7 to account for Ilfov commuters, expats and undeclared → 2.9 M effective pop. Neighbourhood breakdown via OSM volumetrics (footprint × floors).',
      'data.s3.eyebrow': 'COMPETITORS',
      'data.s3.title': '92 manually verified clubs',
      'data.s3.subtitle': 'Live Overpass API (OpenStreetMap) + verified base of 92 clubs (World Class, Stay Fit, 18GYM, Downtown, Nr1, boutiques). Surfaces and headcounts cross-referenced with official websites and Google Reviews.',
      'data.s4.eyebrow': 'FLOW & TRANSIT',
      'data.s4.title': 'Metro, tram, malls, offices',
      'data.s4.subtitle': 'Metrorex 53 stations M1-M5 (750k pax/day), STB 2.7 M tram/bus pax, 12 malls (AFI Cotroceni 60k visitors/day), 340k employees in modern offices (Cushman & Wakefield H1 2025). Google Routes isochrones.',
      'data.s5.eyebrow': 'REAL ESTATE',
      'data.s5.title': 'Price per m² by neighbourhood',
      'data.s5.subtitle': 'imobiliare.ro and investropa.com 2025 · from 700 €/m² (Ferentari) to 3,200 €/m² (Primaverii). Used as a proxy for income to weight price elasticity and local purchasing power.',
      'data.s6.eyebrow': 'RIGOR',
      'data.s6.title': 'Cross-verification and assumed limits',
      'data.s6.subtitle': "Every data point is triangulated (OSM × INS × Google). 92 competitor clubs manually validated. Financial model calibrated on OnAir Montreuil (FP franchise audited by Fiteco). Limits documented in the tool's Sources tab.",

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
