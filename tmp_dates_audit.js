const { Client } = require("pg");
const c = new Client({
  host: "localhost", port: 5432, user: "legend", password: "legend", database: "legendgames",
});
c.connect().then(async () => {
  const now = new Date();
  console.log("Current time:", now.toISOString());
  console.log();

  // 1. Check roundStartedAt in tournament_progress
  const progRes = await c.query(`
    SELECT tp."tournamentId", tp."userId", tp."roundStartedAt", tp."questionsAnsweredCount",
           tp."leftAt", t.status, t."createdAt"
    FROM tournament_progress tp
    JOIN tournament t ON t.id = tp."tournamentId"
    ORDER BY tp."tournamentId", tp."userId"
  `);
  
  console.log("=== ROUND STARTED AT ISSUES ===");
  let startIssues = 0;
  for (const row of progRes.rows) {
    const started = row.roundStartedAt;
    const q = row.questionsAnsweredCount || 0;
    // Issue: roundStartedAt is null but player answered questions
    if (!started && q > 0) {
      console.log(`T:${row.tournamentId} U:${row.userId} - roundStartedAt=NULL but q=${q}`);
      startIssues++;
    }
    // Issue: roundStartedAt is in the future
    if (started && new Date(started) > now) {
      console.log(`T:${row.tournamentId} U:${row.userId} - roundStartedAt IN FUTURE: ${started}`);
      startIssues++;
    }
  }
  if (startIssues === 0) console.log("No issues found");

  // 2. Check completedAt in tournament_result
  const resRes = await c.query(`
    SELECT tr."tournamentId", tr."userId", tr."completedAt", tr.passed,
           t.status, t."createdAt"
    FROM tournament_result tr
    JOIN tournament t ON t.id = tr."tournamentId"
    ORDER BY tr."tournamentId", tr."userId"
  `);

  console.log("\n=== COMPLETED AT ISSUES ===");
  let completedIssues = 0;
  for (const row of resRes.rows) {
    const completed = row.completedAt;
    if (completed && new Date(completed) > now) {
      console.log(`T:${row.tournamentId} U:${row.userId} - completedAt IN FUTURE: ${new Date(completed).toISOString()} (passed=${row.passed})`);
      completedIssues++;
    }
    if (!completed && row.passed !== null) {
      console.log(`T:${row.tournamentId} U:${row.userId} - completedAt=NULL but passed=${row.passed}`);
      completedIssues++;
    }
  }
  if (completedIssues === 0) console.log("No issues found");

  // 3. Show ALL data for review
  console.log("\n=== ALL TOURNAMENT DATA (roundStartedAt, completedAt, leftAt) ===");
  const allRes = await c.query(`
    SELECT tp."tournamentId" AS tid, tp."userId" AS uid,
           tp."roundStartedAt", tp."leftAt", tp."questionsAnsweredCount" AS q,
           tr."completedAt", tr.passed,
           t.status, t."createdAt" AS t_created
    FROM tournament_progress tp
    JOIN tournament t ON t.id = tp."tournamentId"
    LEFT JOIN tournament_result tr ON tr."tournamentId" = tp."tournamentId" AND tr."userId" = tp."userId"
    ORDER BY tp."tournamentId", tp."userId"
  `);
  
  for (const row of allRes.rows) {
    const started = row.roundStartedAt ? new Date(row.roundStartedAt).toISOString() : 'NULL';
    const left = row.leftAt ? new Date(row.leftAt).toISOString() : 'NULL';
    const completed = row.completedAt ? new Date(row.completedAt).toISOString() : 'NULL';
    const created = new Date(row.t_created).toISOString();
    const flags = [];
    if (row.roundStartedAt && new Date(row.roundStartedAt) > now) flags.push('START_FUTURE');
    if (row.completedAt && new Date(row.completedAt) > now) flags.push('COMPLETED_FUTURE');
    if (!row.roundStartedAt && row.q > 0) flags.push('NO_START');
    if (row.completedAt && row.roundStartedAt && new Date(row.completedAt) < new Date(row.roundStartedAt)) flags.push('COMPLETED_BEFORE_START');
    
    const flagStr = flags.length > 0 ? ` *** ${flags.join(', ')} ***` : '';
    console.log(`T:${row.tid} U:${row.uid} q=${row.q} status=${row.status} created=${created.slice(0,16)} started=${started.slice(0,16)} left=${left.slice(0,16)} completed=${completed.slice(0,16)} passed=${row.passed ?? '-'}${flagStr}`);
  }
  
  console.log("\n=== AUDIT DONE ===");
  await c.end();
}).catch(e => { console.error(e); process.exit(1); });
