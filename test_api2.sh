#!/bin/bash
cd /var/www/game
TOKEN=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:6,id:6},'OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5',{expiresIn:'30m'});console.log(t);")
echo "TOKEN=$TOKEN"
echo "---"
curl -v -m 10 "http://localhost:3001/tournaments/my?mode=training" -H "Authorization: Bearer $TOKEN" 2>&1
echo "---DONE---"
