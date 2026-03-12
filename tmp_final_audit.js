const { Client } = require("pg");
const c = new Client({
  host: "localhost", port: 5432, user: "legend", password: "legend", database: "legendgames",
});
c.connect().then(async () => {
  const now = new Date();
  console.log("=== FINAL AUDIT ===");
  console.log("Current time:", now.toISOString(), "\n");

  // 1. completedAt in the future
  const f = await c.query(`SELECT "tournamentId", "userId", "completedAt" FROM tournament_result WHERE "completedAt" > NOW()`);
  console.log(`completedAt in future: ${f.rows.length}`);
  for (const r of f.rows) console.log(`  T:${r.tournamentId} U:${r.userId} ${new Date(r.completedAt).toISOString()}`);

  // 2. completedAt < roundStartedAt
  const b = await c.query(`
    SELECT tr."tournamentId", tr."userId", tr."completedAt", tp."roundStartedAt"
    FROM tournament_result tr
    JOIN tournament_progress tp ON tp."tournamentId" = tr."tournamentId" AND tp."userId" = tr."userId"
    WHERE tr."completedAt" IS NOT NULL AND tp."roundStartedAt" IS NOT NULL
      AND tr."completedAt" < tp."roundStartedAt"
  `);
  console.log(`completedAt < roundStartedAt: ${b.rows.length}`);
  for (const r of b.rows) console.log(`  T:${r.tournamentId} U:${r.userId}`);

  // 3. roundStartedAt > leftAt
  const s = await c.query(`
    SELECT "tournamentId", "userId", "roundStartedAt", "leftAt"
    FROM tournament_progress
    WHERE "roundStartedAt" IS NOT NULL AND "leftAt" IS NOT NULL
      AND "roundStartedAt" > "leftAt"
  `);
  console.log(`roundStartedAt > leftAt: ${s.rows.length}`);
  for (const r of s.rows) console.log(`  T:${r.tournamentId} U:${r.userId}`);

  // 4. Summary of all records
  const all = await c.query(`
    SELECT tr."tournamentId" tid, tr."userId" uid,
           tp."roundStartedAt", tp."leftAt", tr."completedAt", tr.passed, t.status
    FROM tournament_result tr
    JOIN tournament t ON t.id = tr."tournamentId"
    LEFT JOIN tournament_progress tp ON tp."tournamentId" = tr."tournamentId" AND tp."userId" = tr."userId"
    ORDER BY tr."tournamentId", tr."userId"
  `);
  console.log(`\nTotal tournament_result records: ${all.rows.length}`);
  console.log("\n=== ALL DATA ===");
  for (const r of all.rows) {
    const st = r.roundStartedAt ? new Date(r.roundStartedAt).toISOString().slice(0,16) : 'NULL';
    const la = r.leftAt ? new Date(r.leftAt).toISOString().slice(0,16) : 'NULL';
    const ca = r.completedAt ? new Date(r.completedAt).toISOString().slice(0,16) : 'NULL';
    console.log(`T:${r.tid} U:${r.uid} status=${r.status} started=${st} left=${la} completed=${ca} passed=${r.passed ?? '-'}`);
  }

  console.log("\n=== AUDIT COMPLETE ===");
  await c.end();
}).catch(e => { console.error(e); process.exit(1); });
