#!/bin/bash
cd /var/www/game
TOKEN=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:6,id:6},'OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5',{expiresIn:'30m'});console.log(t);")
echo "" > /root/.pm2/logs/game-backend-out-0.log
echo "" > /root/.pm2/logs/game-backend-out-1.log
echo "" > /root/.pm2/logs/game-backend-error-0.log
echo "" > /root/.pm2/logs/game-backend-error-1.log
sleep 1
curl -s -m 30 "http://localhost:3000/tournaments/my?mode=training" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
sleep 2
echo "=== OUT-0 ==="
cat /root/.pm2/logs/game-backend-out-0.log | grep -v "^$" | tail -30
echo "=== OUT-1 ==="
cat /root/.pm2/logs/game-backend-out-1.log | grep -v "^$" | tail -30
echo "=== ERR-0 ==="
cat /root/.pm2/logs/game-backend-error-0.log | grep -v "^$" | tail -20
echo "=== ERR-1 ==="
cat /root/.pm2/logs/game-backend-error-1.log | grep -v "^$" | tail -20
echo "=== END ==="
