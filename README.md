# Auto DBA Agent

An enterprise-grade autonomous database administration agent supporting multi-database management with encrypted credential storage, health monitoring, and OEM-aligned recommendations.

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 20+ | Runtime |
| **TypeScript** | 5.9.3 | Language |
| **Express** | 5.2.1 | REST API framework |
| **PostgreSQL** | 16-alpine | Internal metrics database |
| **pg** | 8.19.0 | PostgreSQL driver |
| **mysql2** | 3.18.2 | MySQL driver |
| **mssql** | 12.2.0 | SQL Server driver |
| **oracledb** | 6.10.0 | Oracle driver |
| **Docker Compose** | 3.9 | Container orchestration |

### Security
- **AES-256-GCM** encryption for database credentials
- **bcrypt** for password hashing
- **jsonwebtoken** for API authentication (prepared)

## Project Structure

```
auto-dba-agent/
├── docker/
│   └── postgres/init/           # Database initialization scripts
├── src/
│   ├── analytics/
│   │   ├── healthEngine.ts      # Health checks & recommendations
│   │   └── backupAnomalyEngine.ts # Backup anomaly detection
│   ├── config/                  # Configuration management
│   ├── connectors/              # Database connectors
│   │   ├── postgres.connector.ts
│   │   ├── mysql.connector.ts
│   │   ├── mssql.connector.ts
│   │   ├── oracle.connector.ts
│   │   └── types.ts
│   ├── controllers/             # Request handlers
│   ├── database/
│   │   └── registry.ts          # Dynamic connector registry
│   ├── routes/
│   │   └── database.routes.ts   # API endpoints
│   ├── services/
│   │   ├── crypto.service.ts    # Credential encryption
│   │   └── onboarding.service.ts
│   └── app.ts                   # Application entry point
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## Quick Start

### 1. Prerequisites
- Node.js 20+
- Docker & Docker Compose
- (Optional) Oracle Instant Client for Oracle support

### 2. Setup

```bash
# Clone and install dependencies
npm install

# Copy environment template
cp .env.example .env

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Add output to DB_CREDENTIALS_KEY in .env

# Start internal metrics database
docker compose up -d

# Start development server
npm run dev
```

### 3. Verify Installation

```bash
# Check agent health
curl http://localhost:3000/health

# Check database registry health
curl http://localhost:3000/health/databases
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API server port |
| `PG_HOST` | `localhost` | Metrics DB host |
| `PG_PORT` | `5433` | Metrics DB port |
| `PG_USER` | `metrics_admin` | Metrics DB user |
| `PG_PASSWORD` | `metrics_admin_change_me` | Metrics DB password |
| `PG_DATABASE` | `internal_metrics` | Metrics DB name |
| `DB_CREDENTIALS_KEY` | - | 64-char hex key for AES-256-GCM |
| `TZ` | `UTC` | Timezone |

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
| `fra_growth_history` | Flash Recovery Area tracking |
| `action_logs` | Action audit logs |

## Security Considerations

1. **Credential Encryption**: All database credentials stored with AES-256-GCM
2. **Environment Protection**: Production/DR environments require elevated roles
3. **Audit Logging**: All operations logged with user, IP, and timestamp
4. **Connection Validation**: Credentials tested before onboarding

## Supported Databases

| Database | Version | Driver |
|----------|---------|--------|
| PostgreSQL | 12+ | pg |
| MySQL | 8.0+ | mysql2 |
| SQL Server | 2017+ | mssql |
| Oracle | 19c+ | oracledb |

## Scripts

```bash
npm run dev      # Development with hot reload
npm run build    # Compile TypeScript
npm run start    # Run compiled JS
```

## Roadmap

- [ ] Authentication middleware (JWT)
- [ ] Role-based access control
- [ ] Scheduled health checks
- [ ] Alerting integrations (PagerDuty, Slack)
- [ ] Performance metrics collection
- [ ] Query analysis tools
- [ ] Backup automation

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

ISC
