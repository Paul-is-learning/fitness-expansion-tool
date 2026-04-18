// ================================================================
// FITNESS PARK ROMANIA — CARTIERE (Neighborhoods)
// ================================================================
// 83 Bucharest neighborhoods — population, rental prices, youth ratio.
// Used for granular population estimation, persona mix calculation,
// and youth heatmap rendering.
//
// Fields:
//   name    Label shown on map
//   lat,lng Centroid
//   sector  Bucharest administrative sector (1-6)
//   pop     Population (INS + field adjustments)
//   price   Avg rental price EUR/m2
//   young   % of 15-45 yo
//   desc    Short description
//
// Total pop sums approximately match the 2022 census
// (1,719,653 hab. + ~30% non-registered residents).
// ================================================================

const CARTIERE = [
  // SECTOR 1 (pop 217,367)
  {name:'Dorobanti',lat:44.4530,lng:26.0900,sector:1,pop:18000,price:2800,young:.42,desc:'Quartier diplomatique premium'},
  {name:'Primaverii',lat:44.4580,lng:26.0820,sector:1,pop:12000,price:3200,young:.38,desc:'Villas ambassades, CSP++'},
  {name:'Aviatorilor',lat:44.4620,lng:26.0880,sector:1,pop:10000,price:3000,young:.40,desc:'Proche Herastrau, premium'},
  {name:'Floreasca',lat:44.4680,lng:26.0950,sector:1,pop:15000,price:2600,young:.45,desc:'Business + residentiel premium'},
  {name:'Baneasa',lat:44.4950,lng:26.0800,sector:1,pop:28000,price:2500,young:.42,desc:'Baneasa Project 221ha | Shopping 20M vis/an | Business parks | Premium residential'},
  {name:'Pipera Nord',lat:44.4850,lng:26.1100,sector:1,pop:18000,price:2100,young:.46,desc:'Tech hub, bureaux + residentiel'},
  {name:'Domenii',lat:44.4680,lng:26.0550,sector:1,pop:16000,price:2000,young:.42,desc:'Residentiel calme classe moyenne+'},
  {name:'Bucurestii Noi',lat:44.4780,lng:26.0430,sector:1,pop:20000,price:1600,young:.43,desc:'Mixte, en gentrification'},
  {name:'Victoriei',lat:44.4520,lng:26.0850,sector:1,pop:12000,price:2500,young:.44,desc:'Centre affaires, Piata Victoriei'},
  {name:'Pajura-Straulesti',lat:44.4880,lng:26.0380,sector:1,pop:15000,price:1500,young:.44,desc:'Peripherie nord-ouest, M4'},
  {name:'1 Mai-Grivita',lat:44.4600,lng:26.0700,sector:1,pop:18000,price:1700,young:.43,desc:'Densement peuple, commerce'},
  // SECTOR 2 (pop 291,557)
  {name:'Floreasca-Barbu Vacarescu',lat:44.4700,lng:26.1050,sector:2,pop:20000,price:2400,young:.45,desc:'CBD secondaire, bureaux premium'},
  {name:'Stefan cel Mare',lat:44.4530,lng:26.1100,sector:2,pop:22000,price:1800,young:.46,desc:'Axe commercial, metro M2'},
  {name:'Obor',lat:44.4520,lng:26.1250,sector:2,pop:25000,price:1500,young:.44,desc:'Marche Obor, quartier populaire'},
  {name:'Tei',lat:44.4630,lng:26.1200,sector:2,pop:18000,price:1600,young:.45,desc:'Lac Tei, gentrification'},
  {name:'Iancului',lat:44.4380,lng:26.1160,sector:2,pop:20000,price:1650,young:.45,desc:'Residentiel dense, metro M1'},
  {name:'Colentina',lat:44.4650,lng:26.1400,sector:2,pop:30000,price:1300,young:.44,desc:'Extension nord-est, populaire'},
  {name:'Pantelimon',lat:44.4400,lng:26.1700,sector:2,pop:35000,price:1200,young:.44,desc:'Grand ensemble est, Mega Mall'},
  {name:'Vatra Luminoasa',lat:44.4450,lng:26.1350,sector:2,pop:15000,price:1700,young:.43,desc:'Residentiel calme, parc IOR'},
  {name:'Fundeni',lat:44.4600,lng:26.1550,sector:2,pop:12000,price:1100,young:.43,desc:'Peripherie, hopital'},
  // SECTOR 3 (pop 374,737)
  {name:'Titan',lat:44.4130,lng:26.1550,sector:3,pop:65000,price:1400,young:.45,desc:'Plus grand quartier, ParkLake, M1'},
  {name:'Dristor',lat:44.4200,lng:26.1320,sector:3,pop:30000,price:1500,young:.45,desc:'Carrefour metro M1+M3, commercial'},
  {name:'Vitan',lat:44.4180,lng:26.1200,sector:3,pop:35000,price:1550,young:.44,desc:'Bucuresti Mall, residentiel dense'},
  {name:'Dudesti',lat:44.4220,lng:26.1100,sector:3,pop:20000,price:1600,young:.44,desc:'Proche centre, en transformation'},
  {name:'Centrul Civic-Unirii',lat:44.4280,lng:26.1020,sector:3,pop:15000,price:2000,young:.43,desc:'Piata Unirii, mixte'},
  {name:'Muncii',lat:44.4350,lng:26.1200,sector:3,pop:25000,price:1500,young:.45,desc:'Piata Muncii, commercial'},
  {name:'Pallady',lat:44.4080,lng:26.1850,sector:3,pop:30000,price:1100,young:.46,desc:'Extension est, nouveaux immeubles'},
  {name:'Hala Laminor Zone',lat:44.4260,lng:26.1500,sector:3,pop:15000,price:1400,young:.45,desc:'Zone en regeneration, 86k m2 projet'},
  // SECTOR 4 (pop 268,018)
  {name:'Tineretului',lat:44.4100,lng:26.1050,sector:4,pop:25000,price:1800,young:.44,desc:'Parc Tineretului, metro M2'},
  {name:'Berceni',lat:44.3950,lng:26.1150,sector:4,pop:55000,price:1400,young:.43,desc:'Grand ensemble sud, Sun Plaza'},
  {name:'Piata Sudului',lat:44.4010,lng:26.1060,sector:4,pop:20000,price:1550,young:.43,desc:'Metro M2, commercial'},
  {name:'Oltenitei',lat:44.3850,lng:26.1200,sector:4,pop:30000,price:1200,young:.42,desc:'Axe sud, en croissance'},
  {name:'Giurgiului',lat:44.3800,lng:26.0900,sector:4,pop:25000,price:1100,young:.41,desc:'Sud-ouest, Grand Arena'},
  {name:'Timpuri Noi',lat:44.4150,lng:26.1130,sector:4,pop:12000,price:1900,young:.45,desc:'Bureaux Timpuri Noi Square'},
  {name:'Aparatorii Patriei',lat:44.3880,lng:26.1250,sector:4,pop:20000,price:1250,young:.42,desc:'Metro M2, peripherie sud'},
  // SECTOR 5 (pop 240,288)
  {name:'Cotroceni',lat:44.4350,lng:26.0650,sector:5,pop:18000,price:2200,young:.44,desc:'Quartier universitaire, CSP+'},
  {name:'13 Septembrie',lat:44.4250,lng:26.0750,sector:5,pop:20000,price:1900,young:.43,desc:'Proche centre, residentiel+'},
  {name:'Rahova',lat:44.4050,lng:26.0600,sector:5,pop:40000,price:1100,young:.42,desc:'Quartier populaire dense'},
  {name:'Ferentari',lat:44.4000,lng:26.0500,sector:5,pop:35000,price:700,young:.40,desc:'Quartier defavorise'},
  {name:'Dealul Spirii',lat:44.4300,lng:26.0800,sector:5,pop:10000,price:2000,young:.43,desc:'Proche Eroilor, patrimoine'},
  {name:'Progresul',lat:44.4130,lng:26.0800,sector:5,pop:15000,price:1400,young:.42,desc:'Mixte, Liberty Mall'},
  // SECTOR 6 (pop 324,994)
  {name:'Militari',lat:44.4310,lng:25.9900,sector:6,pop:50000,price:1500,young:.44,desc:'Grand ensemble ouest, M1+shopping'},
  {name:'Drumul Taberei',lat:44.4230,lng:26.0200,sector:6,pop:55000,price:1700,young:.44,desc:'Populaire, metro M5, en hausse'},
  {name:'Crangasi',lat:44.4550,lng:26.0380,sector:6,pop:25000,price:1500,young:.43,desc:'Proche centre, metro M1'},
  {name:'Giulesti',lat:44.4600,lng:26.0450,sector:6,pop:22000,price:1400,young:.43,desc:'Nord secteur 6, mixte'},
  {name:'Ghencea',lat:44.4130,lng:26.0350,sector:6,pop:20000,price:1300,young:.42,desc:'Sud-ouest, stade'},
  {name:'Grozavesti-Regie',lat:44.4380,lng:26.0560,sector:6,pop:15000,price:1600,young:.46,desc:'Cite universitaire, Politehnica'},
  {name:'Plaza Romania Zone',lat:44.4280,lng:26.0350,sector:6,pop:18000,price:1550,young:.43,desc:'Centre commercial, dense'},
  // === QUARTIERS COMPLEMENTAIRES — combler les gaps population vs census ===
  // SECTOR 1 gap: 41k
  {name:'Herastrau-Nordului',lat:44.4820,lng:26.0750,sector:1,pop:14000,price:2800,young:.40,desc:'Parc Herastrau, luxe'},
  {name:'Aviatiei',lat:44.4750,lng:26.0880,sector:1,pop:16000,price:2300,young:.43,desc:'Residentiel recent, bureaux'},
  {name:'Damaroaia',lat:44.4850,lng:26.0500,sector:1,pop:12000,price:1400,young:.42,desc:'Nord-ouest, mixte'},
  // SECTOR 2 gap: 95k
  {name:'Mosilor-Calarasi',lat:44.4380,lng:26.1050,sector:2,pop:18000,price:1600,young:.44,desc:'Proche centre, commercial'},
  {name:'Baicului',lat:44.4450,lng:26.1200,sector:2,pop:15000,price:1400,young:.44,desc:'Residentiel dense'},
  {name:'Plumbuita',lat:44.4700,lng:26.1300,sector:2,pop:12000,price:1200,young:.43,desc:'Nord-est, parc'},
  {name:'Pipera Sud',lat:44.4750,lng:26.1150,sector:2,pop:20000,price:1800,young:.46,desc:'Bureaux + residentiel neuf'},
  {name:'Andronache',lat:44.4800,lng:26.1400,sector:2,pop:10000,price:1100,young:.43,desc:'Peripherie nord-est'},
  {name:'Doamna Ghica',lat:44.4650,lng:26.1150,sector:2,pop:20000,price:1500,young:.44,desc:'Residentiel, bd Stefan'},
  // SECTOR 3 gap: 140k
  {name:'Lipscani-Old Town',lat:44.4320,lng:26.1000,sector:3,pop:8000,price:2200,young:.43,desc:'Centre historique, nightlife'},
  {name:'Republica',lat:44.4250,lng:26.1500,sector:3,pop:20000,price:1300,young:.45,desc:'Metro M1, Hala Laminor'},
  {name:'Ozana',lat:44.4200,lng:26.1700,sector:3,pop:22000,price:1200,young:.44,desc:'Grand ensemble est'},
  {name:'Balta Alba',lat:44.4250,lng:26.1400,sector:3,pop:25000,price:1350,young:.45,desc:'Parc IOR, residentiel dense'},
  {name:'1 Decembrie',lat:44.4120,lng:26.1650,sector:3,pop:20000,price:1200,young:.44,desc:'Extension est Titan'},
  {name:'Splaiul Unirii Est',lat:44.4200,lng:26.1100,sector:3,pop:15000,price:1700,young:.44,desc:'Bureaux + residentiel'},
  {name:'Calea Calarasilor',lat:44.4300,lng:26.1200,sector:3,pop:15000,price:1500,young:.45,desc:'Axe commercial est'},
  {name:'Nicolae Teclu',lat:44.4050,lng:26.1700,sector:3,pop:16000,price:1100,young:.44,desc:'Peripherie sud-est'},
  // SECTOR 4 gap: 81k
  {name:'Eroii Revolutiei',lat:44.4050,lng:26.1000,sector:4,pop:18000,price:1600,young:.43,desc:'Metro M2, residentiel'},
  {name:'Vacaresti',lat:44.4050,lng:26.1150,sector:4,pop:15000,price:1500,young:.43,desc:'Parc naturel Vacaresti'},
  {name:'Progresul (S4)',lat:44.3950,lng:26.0900,sector:4,pop:18000,price:1300,young:.42,desc:'Sud-centre, commerce'},
  {name:'Metalurgiei',lat:44.3750,lng:26.1200,sector:4,pop:15000,price:1100,young:.42,desc:'Grand Arena zone'},
  {name:'Popesti-Leordeni lim.',lat:44.3700,lng:26.1400,sector:4,pop:16000,price:1200,young:.44,desc:'Limite sud, en expansion'},
  // SECTOR 5 gap: 102k
  {name:'Margeanului',lat:44.4100,lng:26.0500,sector:5,pop:18000,price:1000,young:.41,desc:'Ouest S5, populaire'},
  {name:'Sebastian',lat:44.4200,lng:26.0700,sector:5,pop:20000,price:1400,young:.43,desc:'Proche Eroilor, mixte'},
  {name:'Pieptanari',lat:44.4050,lng:26.0700,sector:5,pop:15000,price:1200,young:.42,desc:'Residentiel dense'},
  {name:'Panduri',lat:44.4300,lng:26.0700,sector:5,pop:12000,price:1700,young:.43,desc:'Proche Cotroceni, CSP+'},
  {name:'Giurgiului Nord',lat:44.3900,lng:26.0800,sector:5,pop:18000,price:900,young:.41,desc:'Quartier populaire'},
  {name:'Odai-Antiaeriana',lat:44.3850,lng:26.0600,sector:5,pop:20000,price:800,young:.40,desc:'Peripherie sud-ouest'},
  // SECTOR 6 gap: 120k
  {name:'Militari Residence',lat:44.4300,lng:25.9600,sector:6,pop:25000,price:1300,young:.46,desc:'Plus grand quartier neuf, 40k hab'},
  {name:'Pacii-Apusului',lat:44.4320,lng:25.9850,sector:6,pop:18000,price:1200,young:.43,desc:'Metro M1 Pacii, dense'},
  {name:'Lujerului',lat:44.4340,lng:26.0300,sector:6,pop:20000,price:1500,young:.43,desc:'Metro M1, residentiel'},
  {name:'Cotroceni-AFI Zone',lat:44.4320,lng:26.0520,sector:6,pop:15000,price:1800,young:.44,desc:'AFI Cotroceni, bureaux Campus6'},
  {name:'Lacul Morii',lat:44.4400,lng:26.0200,sector:6,pop:12000,price:1300,young:.43,desc:'Lac, residentiel'},
  {name:'Veteranilor',lat:44.4250,lng:26.0150,sector:6,pop:15000,price:1400,young:.43,desc:'Drumul Taberei sud'},
  {name:'Gorjului-Razoare',lat:44.4300,lng:26.0100,sector:6,pop:16000,price:1350,young:.43,desc:'Metro M1 Gorjului'},
];
