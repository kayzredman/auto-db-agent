# Auto DBA Agent

An enterprise-grade autonomous database administration agent supporting multi-database management with encrypted credential storage, health monitoring, backup anomaly detection, tablespace growth predictions, FRA risk analysis, and a responsive web UI. Built for DBAs managing heterogeneous database environments across PostgreSQL, MySQL, SQL Server, and Oracle.

## Tech Stack

### Backend

| Component | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 20+ | Runtime |
| **TypeScript** | 5.9.3 | Language (strict mode) |
| **Express** | 5.2.1 | REST API framework |
| **PostgreSQL** | 16-alpine | Internal metrics database |
| **pg** | 8.19.0 | PostgreSQL driver |
| **mysql2** | 3.18.2 | MySQL driver |
| **mssql** | 12.2.0 | SQL Server driver |
| **oracledb** | 6.10.0 | Oracle driver (Thick + Thin mode) |
| **Docker Compose** | 3.9 | Container orchestration |

### Frontend

| Component | Version | Purpose |
|-----------|---------|---------|
| **Next.js** | 16.1.6 | React framework (App Router, Turbopack) |
| **React** | 19.2.3 | UI library |
| **Tailwind CSS** | 4.x | Utility-first styling |
| **Lucide React** | 0.577.0 | Icon library |

### Security
- **AES-256-GCM** encryption for database credentials at rest
- **bcrypt** for password hashing
- **jsonwebtoken** for API authentication (prepared)
- Connection validation before onboarding

## Project Structure

```
auto-dba-agent/
├── client/                          # Next.js Frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx             # Dashboard — health overview
│   │   │   ├── layout.tsx           # Root layout with sidebar
│   │   │   └── databases/
│   │   │       ├── page.tsx         # Database list (filterable grid)
│   │   │       ├── onboard/
│   │   │       │   └── page.tsx     # 3-step onboard wizard
│   │   │       └── [id]/
│   │   │           ├── page.tsx     # Instance detail + CRUD modals
│   │   │           ├── predictions/
│   │   │           │   └── page.tsx # Tablespace growth predictions
│   │   │           └── fra-risk/
│   │   │               └── page.tsx # FRA / Recovery Area risk analysis
│   │   ├── components/
│   │   │   ├── Sidebar.tsx          # Navigation sidebar
│   │   │   ├── MobileNav.tsx        # Responsive mobile menu
│   │   │   └── ui.tsx               # Shared UI components
│   │   └── lib/
│   │       ├── api.ts               # API client functions
│   │       └── types.ts             # TypeScript types
│   ├── next.config.ts               # API proxy rewrites
│   └── package.json
├── docker/
│   └── postgres/init/               # Database initialization scripts
│       └── 001_internal_metrics_schema.sql
├── src/                             # Express Backend
│   ├── analytics/
│   │   ├── healthEngine.ts              # Health checks & OEM recommendations
│   │   ├── backupAnomalyEngine.ts       # Backup anomaly detection
│   │   ├── tablespacePredictionEngine.ts # Tablespace growth predictions (AWR)
│   │   ├── fraRiskEngine.ts             # FRA / Recovery Area risk analysis
│   │   └── index.ts
│   ├── config/                      # Configuration management
│   ├── connectors/
│   │   ├── postgres.connector.ts    # PostgreSQL connector
│   │   ├── mysql.connector.ts       # MySQL connector
│   │   ├── mssql.connector.ts       # SQL Server connector
│   │   ├── oracle.connector.ts      # Oracle connector (pool + privileged)
│   │   ├── types.ts                 # Shared connector types
│   │   └── index.ts
│   ├── controllers/                 # Request handlers
│   ├── database/
│   │   ├── registry.ts              # Dynamic connector registry
│   │   ├── connector-manager.ts     # Connector lifecycle management
│   │   └── index.ts
│   ├── routes/
│   │   ├── database.routes.ts       # API endpoints
│   │   └── index.ts
│   ├── services/
│   │   ├── crypto.service.ts        # AES-256-GCM credential encryption
│   │   ├── onboarding.service.ts    # Database lifecycle CRUD
│   │   └── index.ts
│   └── app.ts                       # Application entry point
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## Quick Start

### 1. Prerequisites
- Node.js 20+
- Docker & Docker Compose
- (Optional) Oracle Instant Client for Oracle Thick mode

### 2. Setup

```bash
# Clone and install dependencies
git clone https://github.com/kayzredman/auto-db-agent.git
cd auto-db-agent
npm install

# Install frontend dependencies
cd client && npm install && cd ..

# Copy environment template
cp .env.example .env

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Add output to DB_CREDENTIALS_KEY in .env

# Start internal metrics database
docker compose up -d

# Start backend server
npm run dev

# Start frontend (in a separate terminal)
npm run dev:client
```

### 3. Access

| Service | URL |
|---------|-----|
| **Web UI** | http://localhost:3001 |
| **API** | http://localhost:3000 |

### 4. Verify Installation

```bash
# Check agent health
curl http://localhost:3000/health

# Check database registry health
curl http://localhost:3000/health/databases
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Backend API server port |
| `PG_HOST` | `localhost` | Metrics DB host |
| `PG_PORT` | `5433` | Metrics DB port |
| `PG_USER` | `metrics_admin` | Metrics DB user |
| `PG_PASSWORD` | `metrics_admin_change_me` | Metrics DB password |
| `PG_DATABASE` | `internal_metrics` | Metrics DB name |
| `DB_CREDENTIALS_KEY` | - | 64-char hex key for AES-256-GCM |
| `TZ` | `UTC` | Timezone |
| `ORACLE_CLIENT_PATH` | - | Path to Oracle Instant Client (Thick mode) |

## API Endpoints

### Health & Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Agent health status |
| `GET` | `/health/databases` | All managed database health summary |
| `GET` | `/health/databases?environment=production` | Filter by environment |

### Database Instance Management

Base path: `/api/databases`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | List all database instances |
| `POST` | `/` | Onboard new database instance |
| `GET` | `/:id` | Get instance details |
| `PATCH` | `/:id` | Update instance metadata |
| `DELETE` | `/:id` | Permanently delete instance |
| `PUT` | `/:id/credentials` | Update credentials |
| `POST` | `/:id/deactivate` | Deactivate instance |
| `POST` | `/:id/reactivate` | Reactivate instance |
| `GET` | `/:id/health` | Instance health check |
| `GET` | `/:id/predictions` | Tablespace growth predictions |
| `POST` | `/:id/predictions/snapshot` | Record tablespace snapshot |
| `GET` | `/:id/fra-risk` | FRA / Recovery Area risk analysis |
| `POST` | `/:id/fra-risk/snapshot` | Record FRA snapshot |

### Query Parameters (GET /)

| Parameter | Type | Description |
|-----------|------|-------------|
| `environment` | `production\|staging\|development\|dr` | Filter by environment |
| `dbType` | `postgres\|mysql\|mssql\|oracle` | Filter by database type |
| `status` | `pending\|active\|inactive\|failed` | Filter by status |
| `application` | `string` | Filter by application name |
| `team` | `string` | Filter by team |

## Request/Response Examples

### Onboard New Database

```bash
curl -X POST http://localhost:3000/api/databases \
  -H "Content-Type: application/json" \
  -H "X-User-Id: admin@company.com" \
  -d '{
    "name": "prod-orders-db",
    "displayName": "Production Orders Database",
    "dbType": "postgres",
    "environment": "production",
    "host": "db-prod-01.internal",
    "port": 5432,
    "databaseName": "orders",
    "username": "app_user",
    "password": "secure_password",
    "application": "OrderService",
    "team": "Platform",
    "ownerEmail": "platform-team@company.com",
    "tags": {"tier": "1", "pci": "true"}
  }'
```

**Response:**
```json
{
  "success": true,
  "instanceId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Database instance onboarded successfully"
}
```

### Get Health Summary

```bash
curl http://localhost:3000/health/databases
```

**Response:**
```json
{
  "overall": "degraded",
  "healthy": 8,
  "unhealthy": 1,
  "total": 9,
  "instances": [
    {
      "instanceId": "550e8400-e29b-41d4-a716-446655440000",
      "name": "prod-orders-db",
      "dbType": "postgres",
      "environment": "production",
      "health": {
        "status": "up",
        "latencyMs": 12
      }
    }
  ],
  "checkedAt": "2026-03-04T10:30:00.000Z"
}
```

## Health Engine

The Health Engine performs automated checks aligned with OEM best practices:

### Checks Performed

| Check | Warning | Critical | Applies To |
|-------|---------|----------|------------|
| Tablespace Usage | ≥85% | ≥90% | All |
| FRA Usage | ≥80% | ≥85% | Oracle |
| Invalid Objects | ≥1 | - | All |
| Failed Jobs | ≥1 | - | All |
| Backup Age | ≥24h | ≥48h | All |

### Response Structure

```json
{
  "instanceId": "uuid",
  "dbType": "oracle",
  "overallStatus": "WARNING",
  "checkedAt": "2026-03-04T10:30:00.000Z",
  "checkDurationMs": 234,
  "issues": [
    {
      "severity": "WARNING",
      "category": "Storage",
      "code": "TABLESPACE_WARNING",
      "message": "Tablespace USERS is 87.3% full",
      "affectedObject": "USERS",
      "currentValue": 87.3,
      "threshold": 85,
      "detectedAt": "2026-03-04T10:30:00.000Z"
    }
  ],
  "recommendations": [
    {
      "priority": "MEDIUM",
      "category": "Storage",
      "title": "High Tablespace Usage",
      "description": "Tablespace usage exceeds 85%. Plan for capacity expansion.",
      "action": "Schedule datafile addition during maintenance window. Review data retention policies.",
      "reference": "Oracle MOS Doc ID 1.1 - Tablespace Management Best Practices",
      "relatedIssueCode": "TABLESPACE_WARNING"
    }
  ],
  "metrics": {
    "tablespaces": [...],
    "backups": {...}
  }
}
```

## Tablespace Prediction Engine

Predicts tablespace growth and estimates days-to-full using linear regression over historical snapshots.

### Oracle AWR Integration

For Oracle databases, the engine leverages **Oracle's built-in AWR** (`DBA_HIST_TBSPC_SPACE_USAGE`) for both current usage and historical growth data. This eliminates the need for manual snapshot recording and delivers sub-second response times — avoiding the 50-180 second queries against `dba_segments` that are typical on large production databases.

| Data Source | View | Purpose |
|-------------|------|----------|
| Current usage | `DBA_HIST_TBSPC_SPACE_USAGE` (latest snap) | Tablespace used bytes |
| Historical growth | `DBA_HIST_TBSPC_SPACE_USAGE` (grouped by day) | Daily usage trend |
| Tablespace metadata | `dba_data_files`, `dba_tablespaces` | Total size, auto-extensible, max size |

For non-Oracle databases, the engine uses live queries for current usage and internal PostgreSQL snapshots (`ts_growth_snapshots`) for historical growth.

### Risk Classification

| Risk | Days to Full |
|------|--------------|
| CRITICAL | ≤ 7 days |
| HIGH | ≤ 15 days |
| WARNING | ≤ 30 days |
| OK | > 30 days or no growth |

### Response Structure

```json
{
  "instanceId": "uuid",
  "dbType": "oracle",
  "analyzedAt": "2026-03-05T10:00:35.419Z",
  "snapshotWindowDays": 7,
  "predictions": [
    {
      "name": "TBS_USER",
      "dbType": "oracle",
      "currentUsedBytes": 1092211376128,
      "currentTotalBytes": 1166008123392,
      "currentUsedPercent": 93.67,
      "freeBytes": 73796747264,
      "autoExtensible": true,
      "maxSizeBytes": 1166009155584,
      "effectiveCapacityBytes": 1166009155584,
      "effectiveFreeBytes": 73797779456,
      "growthPerDayBytes": 3375684461,
      "daysToFull": 21.86,
      "risk": "WARNING",
      "message": "TBS_USER: WARNING — estimated full in 21.9 days (growing ~3219.30 MB/day). Monitor closely.",
      "snapshots": [
        { "date": "2026-02-26T00:00:00.000Z", "usedBytes": 1068581584896 },
        { "date": "2026-03-05T00:00:00.000Z", "usedBytes": 1092211376128 }
      ]
    }
  ],
  "highestRisk": "WARNING"
}
```

## FRA Risk Engine

Analyzes Flash Recovery Area (FRA) / Recovery Area usage and risk across all database types.

### Checks Performed

| Check | Source | Applies To |
|-------|--------|------------|
| Recovery area usage | `v$recovery_file_dest` | Oracle |
| Archive generation rate | `v$archived_log` | Oracle |
| Flashback space usage | `v$flashback_database_log` | Oracle |
| Transaction log usage | `sys.dm_db_log_space_usage` | SQL Server |
| WAL directory size | `pg_ls_waldir()` | PostgreSQL |
| Binary log space | `performance_schema` | MySQL |

### Risk Classification

| Risk | Condition |
|------|-----------|
| CRITICAL | FRA > 90% full |
| HIGH | FRA > 85% AND high archive generation growth |
| WARNING | FRA > 70% |
| OK | FRA < 70% |

## Backup Anomaly Engine

Detects backup anomalies by comparing today's metrics against a 7-day rolling average.

### Algorithm

1. Calculate average metrics from last 7 days
2. Compare today's values to the average
3. Flag anomalies when deviation exceeds thresholds

### Deviation Thresholds

| Severity | Deviation |
|----------|-----------|
| LOW | 40-60% |
| MEDIUM | 60-80% |
| HIGH | 80-94% |
| CRITICAL | 95%+ |

### Metrics Analyzed

- **Backup Count** - Number of backups (lower is concerning)
- **Total Size** - Backup size in MB (both directions)
- **Average Duration** - Backup duration (higher is concerning)
- **Failure Count** - Failed backups (any increase is flagged)

### Response Structure

```json
{
  "instanceId": "uuid",
  "dbType": "oracle",
  "analyzedAt": "2026-03-04T10:30:00.000Z",
  "analysisPeriodDays": 7,
  "todayStats": {
    "date": "2026-03-04",
    "backupCount": 2,
    "totalSizeMb": 1250.5,
    "avgDurationSeconds": 3600,
    "successCount": 2,
    "failureCount": 0
  },
  "historicalAvg": {
    "backupCount": 4.2,
    "totalSizeMb": 1180.3,
    "avgDurationSeconds": 2100,
    "successCount": 4.1,
    "failureCount": 0.1
  },
  "anomalies": [
    {
      "severity": "MEDIUM",
      "metricName": "backup_count",
      "currentValue": 2,
      "expectedValue": 4.2,
      "deviationPercent": 52.4,
      "direction": "below",
      "message": "Backup Count: 2.00 is 52.4% lower than expected 4.20",
      "detectedAt": "2026-03-04T10:30:00.000Z"
    },
    {
      "severity": "HIGH",
      "metricName": "avg_duration_seconds",
      "currentValue": 3600,
      "expectedValue": 2100,
      "deviationPercent": 71.4,
      "direction": "above",
      "message": "Average Backup Duration: 3600.00 is 71.4% higher than expected 2100.00",
      "detectedAt": "2026-03-04T10:30:00.000Z"
    }
  ],
  "overallSeverity": "HIGH"
}
```

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `database_instances` | Registered database inventory |
| `environments` | Environment definitions (production, staging, etc.) |
| `onboarding_audit` | Audit trail for all operations |
| `health_check_results` | Historical health check data |
| `backup_history` | Backup tracking |
| `tablespace_snapshots` | Tablespace usage history |
| `ts_growth_snapshots` | Daily tablespace growth data points per instance |
| `fra_snapshots` | FRA / Recovery Area snapshots per instance |
| `fra_growth_history` | Flash Recovery Area tracking |
| `action_logs` | Action audit logs |

## Security Considerations

1. **Credential Encryption**: All database credentials stored with AES-256-GCM
2. **Environment Protection**: Production/DR environments require elevated roles
3. **Audit Logging**: All operations logged with user, IP, and timestamp
4. **Connection Validation**: Credentials tested before onboarding

## Supported Databases

| Database | Version | Driver | Privileged Connections |
|----------|---------|--------|----------------------|
| PostgreSQL | 12+ | pg | N/A |
| MySQL | 8.0+ | mysql2 | N/A |
| SQL Server | 2017+ | mssql | N/A |
| Oracle | 19c+ | oracledb | SYSDBA, SYSOPER, SYSASM, SYSBACKUP, SYSDG, SYSKM, SYSRAC |

### Oracle Connection Modes

The Oracle connector supports two connection strategies:

- **Standard mode** (connection pool): Used for regular users. Connections are managed via `oracledb.createPool()` for efficient connection reuse.
- **Privileged mode** (standalone connection): Used for SYSDBA/SYSOPER and other privileged roles. Uses `oracledb.getConnection()` with the `privilege` flag, since `createPool()` does not reliably pass privilege flags to connections.

The connector also supports **Thick mode** for compatibility with older Oracle DB versions. Set the `ORACLE_CLIENT_PATH` environment variable to the Oracle Instant Client directory. If unavailable, the connector falls back to Thin mode gracefully.

When connecting as `SYS`, the SYSDBA privilege is auto-detected even if not explicitly selected.

## Web UI

The frontend is a responsive Next.js application at `client/`.

### Pages

| Route | Description |
|-------|-------------|
| `/` | **Dashboard** — Health overview with stat cards, environment breakdown, instance health table |
| `/databases` | **Database List** — Filterable, searchable grid with prediction & FRA risk quick links |
| `/databases/onboard` | **Onboard Wizard** — 3-step form: Connection → Credentials → Options |
| `/databases/[id]` | **Instance Detail** — Full details with edit, credentials, deactivate/reactivate, and delete modals |
| `/databases/[id]/predictions` | **Predictions** — Tablespace growth trends, days-to-full, risk classification per tablespace |
| `/databases/[id]/fra-risk` | **FRA Risk** — Recovery area usage, archive generation stats, flashback metrics, risk issues |

### Features

- Responsive sidebar navigation with mobile hamburger menu
- Real-time health status badges and stat cards
- Filter by environment, database type, and status
- Search across instance names
- Oracle role/privilege selection in onboard and credentials forms
- Auto-detect SYS → SYSDBA privilege
- Inline credential updates with role support
- Deactivate/reactivate and permanent delete workflows
- Tablespace prediction cards with usage bars, growth/day, days-to-full, and risk badges
- FRA risk dashboard with recovery area usage, archive generation charts, and flashback metrics
- API proxy via Next.js rewrites (frontend `:3001` → backend `:3000`)
- 120-second client-side timeout with user-friendly error messages for long-running operations

### Shared UI Components

Defined in `client/src/components/ui.tsx`:

- `StatusBadge` — Color-coded status indicators
- `Card` — Content container with optional header/footer
- `StatCard` — Metric display with icon, label, value, and trend
- `Button` — Primary/secondary/danger variants with loading state
- `Modal` — Accessible overlay dialog
- `Spinner` — Loading indicator
- `EmptyState` — Placeholder for empty data sets

## Scripts

```bash
# Backend
npm run dev          # Development with hot reload (ts-node-dev)
npm run build        # Compile TypeScript
npm run start        # Run compiled JS (production)

# Frontend
npm run dev:client   # Next.js dev server (port 3001)
npm run build:client # Next.js production build
```

## Roadmap

- [x] Multi-database connectors (PostgreSQL, MySQL, MSSQL, Oracle)
- [x] Encrypted credential storage (AES-256-GCM)
- [x] Database onboarding / lifecycle API
- [x] Health Engine with OEM-aligned recommendations
- [x] Backup Anomaly Detection Engine
- [x] Responsive Next.js Web UI
- [x] Oracle Thick mode support
- [x] Oracle privileged connections (SYSDBA/SYSOPER)
- [x] Tablespace Prediction Engine with linear regression
- [x] Oracle AWR integration (`DBA_HIST_TBSPC_SPACE_USAGE`) for sub-second predictions
- [x] FRA / Recovery Area Risk Engine
- [x] Prediction & FRA Risk UI pages
- [ ] Authentication middleware (JWT)
- [ ] Role-based access control
- [ ] Scheduled health checks (cron-based)
- [ ] Alerting integrations (PagerDuty, Slack, email)
- [ ] Performance metrics collection & trending
- [ ] Query analysis tools
- [ ] Backup automation
- [ ] Dashboard charts & visualizations

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

ISC
