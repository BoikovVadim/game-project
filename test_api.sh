#!/bin/bash
cd /var/www/game
TOKEN=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:6,id:6},'OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5',{expiresIn:'30m'});console.log(t);")
echo "Testing user 6 training..."
curl -s "http://localhost:3001/tournaments/my?mode=training" -H "Authorization: Bearer $TOKEN" > /tmp/my6_training.json
python3 -c "
import json
d=json.load(open('/tmp/my6_training.json'))
if 'active' in d:
    print('TRAINING active:', len(d['active']), 'completed:', len(d['completed']))
    for t in d['active'][:3]:
        print('  active id:', t['id'], 'status:', t.get('resultLabel','?'))
    for t in d['completed'][:3]:
        print('  completed id:', t['id'], 'status:', t.get('resultLabel','?'))
else:
    print('ERROR:', json.dumps(d)[:300])
"
echo "Testing user 6 money..."
curl -s "http://localhost:3001/tournaments/my?mode=money" -H "Authorization: Bearer $TOKEN" > /tmp/my6_money.json
python3 -c "
import json
d=json.load(open('/tmp/my6_money.json'))
if 'active' in d:
    print('MONEY active:', len(d['active']), 'completed:', len(d['completed']))
else:
    print('ERROR:', json.dumps(d)[:300])
"
echo "Testing user 3..."
TOKEN3=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:3,id:3},'OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5',{expiresIn:'30m'});console.log(t);")
curl -s "http://localhost:3001/tournaments/my?mode=training" -H "Authorization: Bearer $TOKEN3" > /tmp/my3_training.json
python3 -c "
import json
d=json.load(open('/tmp/my3_training.json'))
if 'active' in d:
    print('TRAINING active:', len(d['active']), 'completed:', len(d['completed']))
else:
    print('ERROR:', json.dumps(d)[:300])
"
echo "DONE"
