// Ambient type declaration for `embedded-postgres`. Written by hand
// instead of relying on TS to resolve the package's own dist/index.d.ts,
// because that package is ESM-only ("type": "module", a single "exports"
// entry with no "types"/"main" field) — this project's moduleResolution
// ("node", paired with module: "CommonJS" for Electron's main process)
// predates package.json "exports" support and can't see through it. See
// postgres.ts for how the package is actually loaded at runtime (a real
// dynamic import(), not a static one).
declare module "embedded-postgres" {
  export interface PostgresOptions {
    databaseDir?: string;
    port?: number;
    user?: string;
    password?: string;
    authMethod?: "password" | "md5" | "scram-sha-256";
    persistent?: boolean;
    initdbFlags?: string[];
    postgresFlags?: string[];
    createPostgresUser?: boolean;
    onLog?: (message: string) => void;
    onError?: (message: string) => void;
  }

  export default class EmbeddedPostgres {
    constructor(options?: PostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
    getPgClient(database?: string, host?: string): unknown;
  }
}
