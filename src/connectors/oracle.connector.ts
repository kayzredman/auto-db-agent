import oracledb = require("oracledb");
import { ConnectionConfig, DatabaseConnector, HealthCheckResult, toPort } from "./types";

type Pool = oracledb.Pool;

// Attempt to initialize Thick mode for broader Oracle version compatibility.
// Thin mode (default in node-oracledb 6+) does not support older Oracle DB versions
// which raises NJS-138. Thick mode requires Oracle Instant Client to be installed.
let thickModeInitialized = false;

function initThickMode(): void {
  if (thickModeInitialized) return;
  try {
    const clientPath = process.env.ORACLE_CLIENT_PATH;
    if (clientPath) {
      oracledb.initOracleClient({ libDir: clientPath });
    } else {
      oracledb.initOracleClient();
    }
    thickModeInitialized = true;
    console.log("[OracleConnector] Thick mode initialized successfully");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If already initialized or client not available, continue in Thin mode
    if (msg.includes("already initialized")) {
      thickModeInitialized = true;
    } else {
      console.warn(
        `[OracleConnector] Thick mode unavailable (${msg}). ` +
        `Falling back to Thin mode — older Oracle DB versions may not be supported. ` +
        `Set ORACLE_CLIENT_PATH env var to the Oracle Instant Client directory to enable Thick mode.`
      );
    }
  }
}

type OraclePrivilege = "default" | "sysdba" | "sysoper" | "sysasm" | "sysbackup" | "sysdg" | "syskm" | "sysrac";

const PRIVILEGE_MAP: Record<string, number> = {
  sysdba: oracledb.SYSDBA,
  sysoper: oracledb.SYSOPER,
  sysasm: oracledb.SYSASM,
  sysbackup: oracledb.SYSBACKUP,
  sysdg: oracledb.SYSDG,
  syskm: oracledb.SYSKM,
  sysrac: oracledb.SYSRAC,
};

type OracleConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  serviceName: string;
  poolMin: number;
  poolMax: number;
  privilege?: OraclePrivilege | undefined;
};

export class OracleConnector implements DatabaseConnector {
  public readonly name = "oracle";
  public readonly instanceId: string | undefined;
  private readonly config: OracleConfig;
  private pool: Pool | null = null;
  private standaloneConn: oracledb.Connection | null = null;

  /** Whether this connector uses privileged (SYSDBA/SYSOPER) standalone connections instead of a pool */
  private readonly privileged: boolean;

  constructor(config?: Partial<OracleConfig>, instanceId?: string) {
    this.instanceId = instanceId;
    this.config = {
      host: config?.host ?? process.env.ORACLE_HOST ?? "localhost",
      port: config?.port ?? toPort(process.env.ORACLE_PORT, 1521),
      user: config?.user ?? process.env.ORACLE_USER ?? "system",
      password: config?.password ?? process.env.ORACLE_PASSWORD ?? "oracle",
      serviceName: config?.serviceName ?? process.env.ORACLE_SERVICE ?? "XEPDB1",
      poolMin: config?.poolMin ?? toPort(process.env.ORACLE_POOL_MIN, 1),
      poolMax: config?.poolMax ?? toPort(process.env.ORACLE_POOL_MAX, 10),
      privilege: config?.privilege
    };
    this.privileged = !!this.config.privilege && this.config.privilege !== "default";
  }

  public static fromConnectionConfig(config: ConnectionConfig, instanceId?: string): OracleConnector {
    const additionalOpts = config.additionalOptions ?? {};
    // Auto-detect: SYS user requires SYSDBA privilege
    let privilege = (additionalOpts.role as OraclePrivilege) ?? undefined;
    if (!privilege || privilege === "default") {
      if (config.username.toUpperCase() === "SYS") {
        privilege = "sysdba";
      }
    }
    return new OracleConnector({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      serviceName: additionalOpts.serviceName as string ?? config.database,
      poolMin: config.poolMin ?? 1,
      poolMax: config.poolMax ?? 10,
      privilege
    }, instanceId);
  }

  public async connect(): Promise<void> {
    // Initialize Thick mode before first connection for older Oracle DB support
    initThickMode();

    const connectString = `${this.config.host}:${this.config.port}/${this.config.serviceName}`;

    if (this.privileged) {
      // ── Privileged mode: use standalone connection (SYSDBA, SYSOPER, etc.) ──
      // Oracle does not allow privileged connections through standard pool creation
      if (this.standaloneConn) return;

      const priv = PRIVILEGE_MAP[this.config.privilege!];
      this.standaloneConn = await oracledb.getConnection({
        user: this.config.user,
        password: this.config.password,
        connectString,
        privilege: priv,
      });

      // Validate the connection
      await this.standaloneConn.execute("SELECT 1 FROM dual");
      console.log(`[OracleConnector] Connected as ${this.config.user} with ${this.config.privilege!.toUpperCase()} privilege`);
    } else {
      // ── Standard mode: use connection pool ──
      if (this.pool) return;

      this.pool = await oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString,
        poolMin: this.config.poolMin,
        poolMax: this.config.poolMax,
      });

      const connection = await this.pool.getConnection();
      await connection.execute("SELECT 1 FROM dual");
      await connection.close();
    }
  }

  public async disconnect(): Promise<void> {
    if (this.standaloneConn) {
      await this.standaloneConn.close();
      this.standaloneConn = null;
    }
    if (this.pool) {
      await this.pool.close(5);
      this.pool = null;
    }
  }

  public async healthCheck(): Promise<HealthCheckResult> {
    const started = Date.now();

    try {
      if (!this.isConnected()) {
        await this.connect();
      }

      if (this.privileged) {
        await this.standaloneConn!.execute("SELECT 1 FROM dual");
      } else {
        const connection = await this.pool!.getConnection();
        await connection.execute("SELECT 1 FROM dual");
        await connection.close();
      }

      return {
        status: "up",
        latencyMs: Date.now() - started
      };
    } catch (error) {
      return {
        status: "down",
        latencyMs: Date.now() - started,
        details: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  public isConnected(): boolean {
    return this.privileged ? this.standaloneConn !== null : this.pool !== null;
  }

  public getPool(): Pool {
    if (!this.pool) {
      throw new Error("Oracle pool not initialized. Call connect() first.");
    }

    return this.pool;
  }

  public async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.isConnected()) {
      await this.connect();
    }

    if (this.privileged) {
      // Use the standalone privileged connection directly
      const result = await this.standaloneConn!.execute(sql, params ?? [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return (result.rows ?? []) as T[];
    }

    // Use pool connection
    const connection = await this.pool!.getConnection();
    try {
      const result = await connection.execute(sql, params ?? [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return (result.rows ?? []) as T[];
    } finally {
      await connection.close();
    }
  }
}

export function createOracleConnector(config?: Partial<OracleConfig>, instanceId?: string): OracleConnector {
  return new OracleConnector(config, instanceId);
}
