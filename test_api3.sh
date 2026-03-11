#!/bin/bash
cd /var/www/game
TOKEN=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:6,id:6},'OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5',{expiresIn:'30m'});console.log(t);")
echo "Testing user 6 training on port 3000..."
curl -s -m 30 "http://localhost:3000/tournaments/my?mode=training" -H "Authorization: Bearer $TOKEN" > /tmp/my6_training.json
python3 -c "
import json
d=json.load(open('/tmp/my6_training.json'))
if 'active' in d:
    print('TRAINING active:', len(d['active']), 'completed:', len(d['completed']))
    for t in d['active'][:5]:
        print('  active id:', t['id'], 'resultLabel:', t.get('resultLabel','?'), 'stage:', t.get('stage','?'))
    for t in d['completed'][:5]:
        print('  completed id:', t['id'], 'resultLabel:', t.get('resultLabel','?'))
else:
    print('ERROR:', json.dumps(d)[:500])
"
echo "---"
echo "Testing user 3 training..."
TOKEN3=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:3,id:3},'OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5',{expiresIn:'30m'});console.log(t);")
curl -s -m 30 "http://localhost:3000/tournaments/my?mode=training" -H "Authorization: Bearer $TOKEN3" > /tmp/my3_training.json
python3 -c "
import json
d=json.load(open('/tmp/my3_training.json'))
if 'active' in d:
    print('TRAINING active:', len(d['active']), 'completed:', len(d['completed']))
    for t in d['active'][:5]:
        print('  active id:', t['id'], 'resultLabel:', t.get('resultLabel','?'), 'stage:', t.get('stage','?'))
else:
    print('ERROR:', json.dumps(d)[:500])
"
echo "ALL_DONE"
