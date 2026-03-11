#!/bin/bash
cd /var/www/game
SECRET='OmtHelNPIIGH1XOwZYQcp3tjo08FzRBg877PcqQZXzNunq4Pj53GqPleOfryC_p5'

echo "=== Tournament 32 data ==="
sudo -u postgres psql legendgames --pset=pager=off -t -A -c "SELECT id, status, \"playerOrder\", \"gameType\" FROM tournament WHERE id = 32;"

echo "=== Progress for tournament 32 ==="
sudo -u postgres psql legendgames --pset=pager=off -c "SELECT \"userId\", \"questionsAnsweredCount\", \"correctAnswersCount\", \"semiFinalCorrectCount\", \"currentQuestionIndex\", \"tiebreakerRoundsCorrect\", \"answersChosen\", \"lockedAnswerCount\" FROM tournament_progress WHERE \"tournamentId\" = 32 ORDER BY \"userId\";"

echo "=== Questions for tournament 32 ==="
sudo -u postgres psql legendgames --pset=pager=off -c "SELECT id, \"roundIndex\", question FROM question WHERE \"tournamentId\" = 32 ORDER BY \"roundIndex\", id;"

echo "=== Training state API for user 4 (who needs tiebreaker) ==="
TOKEN4=$(node -e "const jwt=require('jsonwebtoken');const t=jwt.sign({sub:4,id:4},'$SECRET',{expiresIn:'5m'});console.log(t);")
curl -s -m 15 "http://localhost:3000/tournaments/32/training-state" -H "Authorization: Bearer $TOKEN4" | python3 -m json.tool 2>/dev/null || echo "JSON parse failed"

echo "=== DONE ==="
