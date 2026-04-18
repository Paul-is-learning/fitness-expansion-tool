// ================================================================
// FITNESS PARK ROMANIA — CANONICAL USERS
// ================================================================
// Authorized users for the platform. Stored here so adding a user
// is a 2-line diff (vs editing a 7000-line file).
//
// HOW TO ADD A USER:
//   1. Add a line below with email + role + name + simpleHash(password)
//   2. git commit + git push → Vercel redeploys
//   3. User opens https://fitnesspark.isseo-dev.com in their browser
//   4. Auto-migration adds them to existing users' localStorage
//
// HOW TO REMOVE A USER:
//   1. Remove their line below
//   2. git commit + git push
//   NOTE: existing localStorage copies still hold the entry until
//   MODEL_VERSION is bumped in config.js (forces full reseed).
//
// PASSWORD ROTATION:
//   Change the simpleHash('xxxxx') call. They'll be unable to log in
//   until they use the new password.
//
// Roles:
//   admin → full access + can see admin-only UI
//   user  → standard access
//
// Depends on: src/utils.js (simpleHash)
// ================================================================

const CANONICAL_USERS = [
  {email:'paulbecaud@isseo-dev.com',role:'admin',name:'Paul Becaud',pwHash:simpleHash('FP2026!')},
  {email:'pbecaud@isseo-dev.com',role:'admin',name:'Paul Becaud',pwHash:simpleHash('FP2026!')},
  {email:'ulysse.gaspard0@gmail.com',role:'user',name:'Ulysse Gaspard',pwHash:simpleHash('FP2026')},
  {email:'tomescumh@yahoo.com',role:'user',name:'Tomescu MH',pwHash:simpleHash('FP2026')},
];
