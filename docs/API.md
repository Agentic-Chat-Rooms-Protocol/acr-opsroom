# REST & SSE API Reference - ACR OpsRoom

**Default Base URL:** `http://localhost:20447`

---

## 1. System Endpoints

### `GET /health`
Returns service status, active incident count, and timestamp.

**Response:**
```json
{
  "status": "online",
  "service": "acr-opsroom",
  "version": "1.0.0",
  "activeIncidents": 1,
  "squadsAvailable": 3,
  "timestamp": 1726456000000
}
```

### `GET /api/v1/opsroom/battlecard`
Returns the competitive battlecard comparing ACR OpsRoom to Salesforce Agentforce.

---

## 2. Real-Time Streaming

### `GET /api/v1/opsroom/stream`
Server-Sent Events (SSE) connection streaming real-time operational events.
- `INCIDENT_TRIGGERED`
- `DELIBERATION_TURN`
- `CONSENSUS_BALLOT`
- `QUORUM_EVALUATED`
- `EXECUTION_COMPLETED`

---

## 3. Incident Management

### `POST /api/v1/opsroom/incidents/trigger`
Triggers an autonomous operational incident with ML anomaly routing.

**Request Body:**
```json
{
  "title": "Postgres Replication Lag Spike",
  "description": "Follower db-replica-03 lagging by 8,420ms",
  "telemetry": [15, 14, 18, 16, 8420]
}
```

### `POST /api/v1/opsroom/incidents/:id/deliberate`
Submits a specialized agent deliberation turn.

### `POST /api/v1/opsroom/incidents/:id/vote`
Submits an Ed25519-signed consensus ballot.

### `POST /api/v1/opsroom/incidents/:id/evaluate-quorum`
Evaluates the Byzantine Quorum (checks for 67% supermajority and flags anomalies).

### `POST /api/v1/opsroom/incidents/:id/execute`
Executes the approved plan inside zero-trust ToolHive sandboxes.

**Request Body:**
```json
{
  "humanApproved": true
}
```

### `GET /api/v1/opsroom/incidents/:id/audit-cert`
Generates and downloads a cryptographically chained SOC2 / ISO27001 audit certificate.
