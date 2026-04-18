// ================================================================
// FITNESS PARK ROMANIA — POIs (Points of Interest)
// ================================================================
// 37 key Bucharest points of interest split across 4 categories:
//   - university  (14) — students count
//   - mall        (13) — GLA m2
//   - office       (6) — employees count
//   - residential  (4) — inhabitants count
//
// Used for proximity analysis, flux scoring, youth heatmap,
// and catchment volume estimation in the analysis engine.
// ================================================================

const POIS = [
  // UNIVERSITIES (14) — Source: universityguru.com, official uni websites
  {name:'Universitatea din Bucuresti (UB)',lat:44.435139,lng:26.080362,type:'university',students:33000,icon:'🎓'},
  {name:'Politehnica Bucuresti (UPB)',lat:44.439368,lng:26.050603,type:'university',students:23000,icon:'🎓'},
  {name:'ASE Bucuresti',lat:44.447677,lng:26.097152,type:'university',students:22000,icon:'🎓'},
  {name:'UMF Carol Davila',lat:44.442020,lng:26.101938,type:'university',students:10000,icon:'🎓'},
  {name:'SNSPA',lat:44.449603,lng:26.094087,type:'university',students:5000,icon:'🎓'},
  {name:'Ion Mincu (Arhitectura)',lat:44.436173,lng:26.100374,type:'university',students:3000,icon:'🎓'},
  {name:'USAMV Bucuresti',lat:44.471028,lng:26.066426,type:'university',students:8000,icon:'🎓'},
  {name:'UNARTE Bucuresti',lat:44.444761,lng:26.087031,type:'university',students:2000,icon:'🎓'},
  {name:'UNATC (Theatre & Film)',lat:44.437909,lng:26.130389,type:'university',students:1500,icon:'🎓'},
  {name:'Spiru Haret University',lat:44.433381,lng:26.101018,type:'university',students:15000,icon:'🎓'},
  {name:'Romanian-American University',lat:44.472984,lng:26.065692,type:'university',students:6000,icon:'🎓'},
  {name:'Titu Maiorescu University',lat:44.411007,lng:26.115159,type:'university',students:8000,icon:'🎓'},
  {name:'Hyperion University',lat:44.432737,lng:26.125487,type:'university',students:4000,icon:'🎓'},
  {name:'Nicolae Titulescu University',lat:44.404416,lng:26.121035,type:'university',students:5000,icon:'🎓'},
  // MALLS (13) — Source: romania-insider.com, official mall websites
  {name:'AFI Cotroceni',lat:44.431500,lng:26.052000,type:'mall',gla:90000,icon:'🛒'},
  {name:'Baneasa Shopping City',lat:44.507259,lng:26.089485,type:'mall',gla:90000,icon:'🛒'},// 55k GLA + 35k extension = 90k total | 20M visits/an
  {name:'Mega Mall',lat:44.441776,lng:26.152213,type:'mall',gla:75000,icon:'🛒'},
  {name:'ParkLake Mall',lat:44.420665,lng:26.149631,type:'mall',gla:70000,icon:'🛒'},
  {name:'Sun Plaza',lat:44.395444,lng:26.123051,type:'mall',gla:81000,icon:'🛒'},
  {name:'Promenada Mall',lat:44.478191,lng:26.103413,type:'mall',gla:45000,icon:'🛒'},
  {name:'Bucuresti Mall',lat:44.420262,lng:26.126688,type:'mall',gla:50000,icon:'🛒'},
  {name:'Plaza Romania',lat:44.428482,lng:26.035172,type:'mall',gla:55000,icon:'🛒'},
  {name:'Militari Shopping',lat:44.436707,lng:25.982650,type:'mall',gla:54000,icon:'🛒'},
  {name:'Veranda Mall',lat:44.452127,lng:26.129041,type:'mall',gla:30000,icon:'🛒'},
  {name:'Grand Arena Mall',lat:44.374227,lng:26.120416,type:'mall',gla:50000,icon:'🛒'},
  {name:'Unirea Shopping Center',lat:44.427541,lng:26.101922,type:'mall',gla:40000,icon:'🛒'},
  {name:'Liberty Mall',lat:44.415067,lng:26.080094,type:'mall',gla:25000,icon:'🛒'},
  // OFFICE DISTRICTS (6) — Source: Cushman & Wakefield, romania-insider.com
  {name:'Pipera Business District',lat:44.478813,lng:26.112428,type:'office',employees:45000,icon:'🏢'},
  {name:'Floreasca-Barbu Vacarescu',lat:44.471986,lng:26.108830,type:'office',employees:25000,icon:'🏢'},
  {name:'Center-West (Cotroceni)',lat:44.433000,lng:26.055000,type:'office',employees:15000,icon:'🏢'},
  {name:'Timpuri Noi Square',lat:44.411499,lng:26.115091,type:'office',employees:15000,icon:'🏢'},
  {name:'Sema Parc',lat:44.442909,lng:26.048414,type:'office',employees:10000,icon:'🏢'},
  {name:'Baneasa Business & Technology Park',lat:44.5050,lng:26.0870,type:'office',employees:12000,icon:'🏢'},// Part of 221ha Baneasa Project mixed-use (PPTX officiel)
  // MAJOR RESIDENTIAL (4) — Source: romania-insider.com
  {name:'Militari Residence',lat:44.430000,lng:25.960000,type:'residential',inhabitants:25000,icon:'🏠'},
  {name:'Cosmopolis',lat:44.530000,lng:26.115000,type:'residential',inhabitants:7500,icon:'🏠'},
  {name:'Greenfield Baneasa',lat:44.490189,lng:26.084950,type:'residential',inhabitants:5000,icon:'🏠'},
  {name:'One Herastrau',lat:44.488000,lng:26.078000,type:'residential',inhabitants:3000,icon:'🏠'},
];
