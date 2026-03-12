const { Client } = require("pg");
const c = new Client({
  host: "localhost", port: 5432, user: "legend", password: "legend", database: "legendgames",
});
c.connect().then(async () => {
  const res = await c.query(`
    SELECT t.id AS tid, t.status, t."playerOrder", t."gameType",
           tp."userId", tp."questionsAnsweredCount", tp."semiFinalCorrectCount",
           tp."tiebreakerRoundsCorrect", tp."correctAnswersCount",
           tr.passed, tr."completedAt"
    FROM tournament t
    LEFT JOIN tournament_progress tp ON tp."tournamentId" = t.id
    LEFT JOIN tournament_result tr ON tr."tournamentId" = t.id AND tr."userId" = tp."userId"
    ORDER BY t.id, tp."userId"
  `);

  const byTid = {};
  for (const row of res.rows) {
    (byTid[row.tid] = byTid[row.tid] || []).push(row);
  }

  console.log("=== TOURNAMENTS WITH INCOMPLETE BRACKETS (< 4 real players or opponent didn't answer) ===\n");

  for (const [tidStr, rows] of Object.entries(byTid)) {
    const tid = Number(tidStr);
    let po = rows[0].playerOrder || [];
    if (typeof po === 'string') { try { po = JSON.parse(po); } catch { po = []; } }
    const status = rows[0].status;
    const gameType = rows[0].gameType;
    const realPlayers = po.filter(id => id > 0);

    // Check each pair
    const issues = [];
    for (const pair of [[0,1],[2,3]]) {
      const id1 = pair[0] < po.length ? po[pair[0]] : -1;
      const id2 = pair[1] < po.length ? po[pair[1]] : -1;
      if (id1 <= 0 && id2 <= 0) continue;

      const p1 = rows.find(r => r.userId === id1);
      const p2 = rows.find(r => r.userId === id2);
      const q1 = p1 ? (p1.questionsAnsweredCount || 0) : 0;
      const q2 = p2 ? (p2.questionsAnsweredCount || 0) : 0;

      if (id1 <= 0 || id2 <= 0) {
        const activeId = id1 > 0 ? id1 : id2;
        const activeQ = id1 > 0 ? q1 : q2;
        const activeResult = rows.find(r => r.userId === activeId);
        issues.push(`  Pair [${pair}]: slot${pair[0]}=U:${id1}, slot${pair[1]}=U:${id2} — MISSING OPPONENT. Active U:${activeId} q=${activeQ} passed=${activeResult?.passed}`);
      } else if (q1 > 0 && q2 === 0) {
        const p1r = rows.find(r => r.userId === id1);
        issues.push(`  Pair [${pair}]: U:${id1} q=${q1} vs U:${id2} q=${q2} — OPPONENT DIDN'T START. U:${id1} passed=${p1r?.passed}`);
      } else if (q2 > 0 && q1 === 0) {
        const p2r = rows.find(r => r.userId === id2);
        issues.push(`  Pair [${pair}]: U:${id1} q=${q1} vs U:${id2} q=${q2} — OPPONENT DIDN'T START. U:${id2} passed=${p2r?.passed}`);
      }
    }

    // Also check if < 4 real players
    const hasMissing = realPlayers.length < 4 && po.length > 0;

    if (issues.length > 0 || hasMissing) {
      console.log(`T:${tid} status=${status} type=${gameType} playerOrder=[${po}] realPlayers=${realPlayers.length}`);
      for (const row of rows) {
        if (row.userId) {
          console.log(`  U:${row.userId} q=${row.questionsAnsweredCount || 0} semi=${row.semiFinalCorrectCount ?? '-'} tb=${JSON.stringify(row.tiebreakerRoundsCorrect || [])} passed=${row.passed ?? '-'}`);
        }
      }
      for (const iss of issues) console.log(iss);
      console.log();
    }
  }

  console.log("=== DONE ===");
  await c.end();
}).catch(e => { console.error(e); process.exit(1); });
