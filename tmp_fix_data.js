const { Client } = require("pg");
const c = new Client({
  host: "localhost", port: 5432, user: "legend", password: "legend", database: "legendgames",
});

c.connect().then(async () => {
  // 1. Find all finished tournaments with incomplete brackets
  const res = await c.query(`
    SELECT t.id, t.status, t."playerOrder"
    FROM tournament t
    WHERE t.status = 'finished'
  `);

  const singlePlayerTids = [];
  const multiAutoWinners = []; // {tid, userId}

  for (const t of res.rows) {
    let po = t.playerOrder || [];
    if (typeof po === 'string') { try { po = JSON.parse(po); } catch { po = []; } }
    const real = po.filter(id => id > 0);

    if (real.length === 1) {
      singlePlayerTids.push(t.id);
    } else if (real.length >= 2) {
      // Check each pair for missing opponents
      for (const pair of [[0,1],[2,3]]) {
        const id1 = pair[0] < po.length ? po[pair[0]] : -1;
        const id2 = pair[1] < po.length ? po[pair[1]] : -1;
        if ((id1 > 0 && id2 <= 0)) multiAutoWinners.push({ tid: t.id, userId: id1 });
        if ((id2 > 0 && id1 <= 0)) multiAutoWinners.push({ tid: t.id, userId: id2 });
      }
    }
  }

  console.log("=== SINGLE-PLAYER TOURNAMENTS TO REACTIVATE ===");
  console.log("IDs:", singlePlayerTids);
  console.log("Count:", singlePlayerTids.length);

  console.log("\n=== MULTI-PLAYER AUTO-WINNERS TO FIX ===");
  console.log(multiAutoWinners);
  console.log("Count:", multiAutoWinners.length);

  // 2. Reactivate single-player tournaments: status → waiting, delete tournament_result
  if (singlePlayerTids.length > 0) {
    const delResult = await c.query(
      `DELETE FROM tournament_result WHERE "tournamentId" = ANY($1::int[]) RETURNING *`,
      [singlePlayerTids]
    );
    console.log("\nDeleted tournament_result rows:", delResult.rowCount);

    const updResult = await c.query(
      `UPDATE tournament SET status = 'waiting' WHERE id = ANY($1::int[]) RETURNING id, status`,
      [singlePlayerTids]
    );
    console.log("Updated tournament status to waiting:", updResult.rowCount);
  }

  // 3. Fix auto-winners in multi-player incomplete brackets: set passed=0
  for (const aw of multiAutoWinners) {
    const upd = await c.query(
      `UPDATE tournament_result SET passed = 0 WHERE "tournamentId" = $1 AND "userId" = $2 RETURNING *`,
      [aw.tid, aw.userId]
    );
    console.log(`T:${aw.tid} U:${aw.userId} — updated passed to 0: ${upd.rowCount > 0 ? 'YES' : 'no result row found'}`);
  }

  console.log("\n=== DATA FIX DONE ===");
  await c.end();
}).catch(e => { console.error(e); process.exit(1); });
