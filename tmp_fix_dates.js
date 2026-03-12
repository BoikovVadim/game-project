const { Client } = require("pg");
const c = new Client({
  host: "localhost", port: 5432, user: "legend", password: "legend", database: "legendgames",
});

c.connect().then(async () => {
  const now = new Date();
  console.log("Current time:", now.toISOString());
  console.log();

  // Get all data
  const allRes = await c.query(`
    SELECT tr.id as rid, tr."tournamentId", tr."userId", tr."completedAt", tr.passed,
           tp."roundStartedAt", tp."leftAt", tp."questionsAnsweredCount",
           t.status, t."createdAt"
    FROM tournament_result tr
    JOIN tournament t ON t.id = tr."tournamentId"
    LEFT JOIN tournament_progress tp ON tp."tournamentId" = tr."tournamentId" AND tp."userId" = tr."userId"
    ORDER BY tr."tournamentId", tr."userId"
  `);

  let fixes = 0;
  
  for (const row of allRes.rows) {
    const completed = row.completedAt ? new Date(row.completedAt) : null;
    const started = row.roundStartedAt ? new Date(row.roundStartedAt) : null;
    const left = row.leftAt ? new Date(row.leftAt) : null;
    const created = new Date(row.createdAt);

    let issue = null;
    let newCompleted = null;

    if (completed && completed > now) {
      issue = 'FUTURE';
    } else if (completed && started && completed < started) {
      issue = 'BEFORE_START';
    }

    if (!issue) continue;

    // Compute correct completedAt: use leftAt (best), then roundStartedAt, then createdAt. Clamp to now.
    if (left) {
      newCompleted = left > now ? now : left;
    } else if (started) {
      newCompleted = started > now ? now : started;
    } else {
      newCompleted = created > now ? now : created;
    }

    console.log(`FIX T:${row.tournamentId} U:${row.userId} [${issue}]: completedAt ${completed?.toISOString()?.slice(0,16) ?? 'NULL'} → ${newCompleted.toISOString().slice(0,16)} (leftAt=${left?.toISOString()?.slice(0,16) ?? 'NULL'}, started=${started?.toISOString()?.slice(0,16) ?? 'NULL'})`);

    await c.query(
      `UPDATE tournament_result SET "completedAt" = $1 WHERE id = $2`,
      [newCompleted, row.rid]
    );
    fixes++;
  }

  console.log(`\nFixed ${fixes} records.`);
  
  // Verify
  console.log("\n=== VERIFICATION ===");
  const verRes = await c.query(`
    SELECT tr."tournamentId", tr."userId", tr."completedAt",
           tp."roundStartedAt", tp."leftAt"
    FROM tournament_result tr
    LEFT JOIN tournament_progress tp ON tp."tournamentId" = tr."tournamentId" AND tp."userId" = tr."userId"
    WHERE tr."completedAt" > NOW()
       OR (tr."completedAt" IS NOT NULL AND tp."roundStartedAt" IS NOT NULL AND tr."completedAt" < tp."roundStartedAt")
    ORDER BY tr."tournamentId", tr."userId"
  `);
  
  if (verRes.rows.length === 0) {
    console.log("No remaining issues found!");
  } else {
    for (const row of verRes.rows) {
      console.log(`STILL BAD: T:${row.tournamentId} U:${row.userId} completedAt=${row.completedAt} started=${row.roundStartedAt}`);
    }
  }
  
  await c.end();
}).catch(e => { console.error(e); process.exit(1); });
