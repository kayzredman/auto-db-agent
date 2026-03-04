import {
  PostgresConnector,
  MysqlConnector,
  MssqlConnector,
  OracleConnector,
  DatabaseConnector,
  HealthCheckResult
} from "../connectors";

export type ConnectorName = "postgres" | "mysql" | "mssql" | "oracle";

export type ConnectorHealthSummary = {
  overall: "up" | "degraded" | "down";
  connectors: Record<ConnectorName, HealthCheckResult | null>;
  checkedAt: string;
};

export class ConnectorManager {
  private connectors: Map<ConnectorName, DatabaseConnector> = new Map();

  public register(name: ConnectorName, connector: DatabaseConnector): void {
    this.connectors.set(name, connector);
  }

  public get<T extends DatabaseConnector>(name: ConnectorName): T | undefined {
    return this.connectors.get(name) as T | undefined;
  }

  public async connectAll(): Promise<void> {
    const tasks = Array.from(this.connectors.values()).map((c) => c.connect());
    await Promise.all(tasks);
  }

  public async disconnectAll(): Promise<void> {
    const tasks = Array.from(this.connectors.values()).map((c) => c.disconnect());
    await Promise.all(tasks);
  }

  public async healthSummary(): Promise<ConnectorHealthSummary> {
    const results: Record<ConnectorName, HealthCheckResult | null> = {
      postgres: null,
      mysql: null,
      mssql: null,
      oracle: null
    };

    const checks = Array.from(this.connectors.entries()).map(async ([name, connector]) => {
      results[name] = await connector.healthCheck();
    });

    await Promise.all(checks);

    const statuses = Object.values(results).filter((r): r is HealthCheckResult => r !== null);
    const upCount = statuses.filter((r) => r.status === "up").length;
    const total = statuses.length;

    let overall: "up" | "degraded" | "down";
    if (total === 0 || upCount === 0) {
      overall = "down";
    } else if (upCount === total) {
      overall = "up";
    } else {
      overall = "degraded";
    }

    return {
      overall,
      connectors: results,
      checkedAt: new Date().toISOString()
    };
  }
}

export function createConnectorManagerFromEnv(): ConnectorManager {
  const manager = new ConnectorManager();

  if (process.env.PG_HOST || process.env.PG_DATABASE) {
    manager.register("postgres", new PostgresConnector());
  }

  if (process.env.MYSQL_HOST || process.env.MYSQL_DATABASE) {
    manager.register("mysql", new MysqlConnector());
  }

  if (process.env.MSSQL_HOST || process.env.MSSQL_DATABASE) {
    manager.register("mssql", new MssqlConnector());
  }

  if (process.env.ORACLE_HOST || process.env.ORACLE_SERVICE) {
    manager.register("oracle", new OracleConnector());
  }

  return manager;
}
