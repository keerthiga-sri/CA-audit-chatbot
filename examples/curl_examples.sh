#!/bin/bash
# CA Audit Desk API - cURL Examples
# Replace http://localhost:3000 with your deployment domain or tunnel URL

BASE_URL="http://localhost:3000"
API_KEY="ca_live_541c806cb70ae18dab3721e1e6740c5b"

AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
  AUTH_HEADER="-H \"X-API-Key: $API_KEY\""
fi

echo "=== 1. API Health & Status ==="
curl -s -X GET "$BASE_URL/api/health" | jq .

echo -e "\n=== 2. List All Audit Clients ==="
curl -s -X GET "$BASE_URL/api/clients?stats=true" $AUTH_HEADER | jq .

echo -e "\n=== 3. Register a New Client ==="
curl -s -X POST "$BASE_URL/api/clients" \
  -H "Content-Type: application/json" \
  $AUTH_HEADER \
  -d '{"name": "Vertex Holdings", "email": "audit@vertex.com"}' | jq .

echo -e "\n=== 4. Ask a Financial Audit Question (RAG) ==="
curl -s -X POST "$BASE_URL/api/chat" \
  -H "Content-Type: application/json" \
  $AUTH_HEADER \
  -d '{"clientName": "Apex Enterprises", "message": "What was the total profit across all audited years?"}' | jq .

echo -e "\n=== 5. Schedule a Google Meet via Chat ==="
curl -s -X POST "$BASE_URL/api/chat" \
  -H "Content-Type: application/json" \
  $AUTH_HEADER \
  -d '{"clientName": "Apex Enterprises", "message": "Schedule a Google Meet tomorrow at 4 PM for 30 minutes with palanitce@gmail.com"}' | jq .

echo -e "\n=== 6. Get 10-Year Financial Ledger ==="
curl -s -X GET "$BASE_URL/api/financials?clientName=Apex%20Enterprises&order=asc" $AUTH_HEADER | jq .

echo -e "\n=== 7. Direct Calendar Event Creation ==="
curl -s -X POST "$BASE_URL/api/calendar/sync" \
  -H "Content-Type: appgit initlication/json" \
  $AUTH_HEADER \
  -d '{
    "topic": "Tax Due Diligence Review",
    "start": "2026-10-10T15:00:00",
    "durationMinutes": 45,
    "attendees": ["client@apex.com", "palanitce@gmail.com"]
  }' | jq .
