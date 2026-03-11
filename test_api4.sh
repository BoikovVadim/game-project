#!/bin/bash
cd /var/www/game
TOKEN=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:6,id:6},'OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5',{expiresIn:'30m'});console.log(t);")
echo "=== Clearing log ==="
echo "" > /root/.pm2/logs/game-backend-error-0.log
echo "" > /root/.pm2/logs/game-backend-error-1.log
sleep 1
echo "=== Requesting user 6 training ==="
RESP=$(curl -s -m 30 -w "\nHTTP_CODE:%{http_code}" "http://localhost:3000/tournaments/my?mode=training" -H "Authorization: Bearer $TOKEN")
echo "$RESP" | tail -5
sleep 1
echo "=== Error logs after request ==="
cat /root/.pm2/logs/game-backend-error-0.log
echo "=== err1 ==="
cat /root/.pm2/logs/game-backend-error-1.log
echo "=== FINISHED ==="
