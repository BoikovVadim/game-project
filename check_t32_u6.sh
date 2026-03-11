#!/bin/bash
cd /var/www/game
SECRET='OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5'

echo "=== Training state API for user 6 ==="
TOKEN6=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:6,id:6},'$SECRET',{expiresIn:'5m'});console.log(t);")
curl -s -m 15 "http://localhost:3000/tournaments/32/training-state" -H "Authorization: Bearer $TOKEN6" | python3 -m json.tool 2>/dev/null || echo "JSON parse failed"

echo "=== DONE ==="
