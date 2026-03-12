const { Client } = require("pg");
const c = new Client({
  host: "localhost", port: 5432, user: "legend", password: "legend", database: "legendgames",
});

c.connect().then(async () => {
  console.log("=== Fix roundStartedAt where it is later than leftAt (player already finished) ===\n");

  const res = await c.query(`
    SELECT tp.id, tp."tournamentId", tp."userId", tp."roundStartedAt", tp."leftAt",
           tp."questionsAnsweredCount",
           t."createdAt", t.status,
           te."joinedAt"
    FROM tournament_progress tp
    JOIN tournament t ON t.id = tp."tournamentId"
    LEFT JOIN tournament_entry te ON te."tournamentId" = tp."tournamentId" AND te."userId" = tp."userId"
    WHERE tp."roundStartedAt" IS NOT NULL 
      AND tp."leftAt" IS NOT NULL
      AND tp."roundStartedAt" > tp."leftAt"
    ORDER BY tp."tournamentId", tp."userId"
  `);

  let fixes = 0;
  for (const row of res.rows) {
    const started = new Date(row.roundStartedAt);
    const left = new Date(row.leftAt);
    const created = new Date(row.createdAt);
    const joined = row.joinedAt ? new Date(row.joinedAt) : null;

    // Best estimate: joinedAt if available, else createdAt (tournament creation)
    const bestStart = joined && joined <= left ? joined : (created <= left ? created : left);

    console.log(`FIX T:${row.tournamentId} U:${row.userId}: roundStartedAt ${started.toISOString().slice(0,16)} → ${bestStart.toISOString().slice(0,16)} (leftAt=${left.toISOString().slice(0,16)}, joined=${joined?.toISOString()?.slice(0,16) ?? 'NULL'}, created=${created.toISOString().slice(0,16)})`);

    await c.query(
      `UPDATE tournament_progress SET "roundStartedAt" = $1 WHERE id = $2`,
      [bestStart, row.id]
    );
    fixes++;
  }

  console.log(`\nFixed ${fixes} records.`);

  // Now also fix completedAt that is STILL before roundStartedAt after this fix
  console.log("\n=== Verification: completedAt vs roundStartedAt ===");
  const v = await c.query(`
    SELECT tr."tournamentId", tr."userId", tr."completedAt",
           tp."roundStartedAt", tp."leftAt"
    FROM tournament_result tr
    LEFT JOIN tournament_progress tp ON tp."tournamentId" = tr."tournamentId" AND tp."userId" = tr."userId"
    WHERE tr."completedAt" IS NOT NULL AND tp."roundStartedAt" IS NOT NULL
      AND tr."completedAt" < tp."roundStartedAt"
    ORDER BY tr."tournamentId"
  `);
  if (v.rows.length === 0) {
    console.log("No remaining completedAt < roundStartedAt issues!");
  } else {
    for (const row of v.rows) {
      console.log(`STILL: T:${row.tournamentId} U:${row.userId} completed=${new Date(row.completedAt).toISOString().slice(0,16)} started=${new Date(row.roundStartedAt).toISOString().slice(0,16)}`);
    }
  }

  // Final check: any completedAt in the future?
  console.log("\n=== Verification: completedAt in future ===");
  const v2 = await c.query(`SELECT "tournamentId", "userId", "completedAt" FROM tournament_result WHERE "completedAt" > NOW()`);
  if (v2.rows.length === 0) {
    console.log("No future completedAt!");
  } else {
    for (const row of v2.rows) {
      console.log(`FUTURE: T:${row.tournamentId} U:${row.userId} ${new Date(row.completedAt).toISOString()}`);
    }
  }

  console.log("\n=== DONE ===");
  await c.end();
}).catch(e => { console.error(e); process.exit(1); });
