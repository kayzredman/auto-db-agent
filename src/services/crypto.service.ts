import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export type EncryptedData = {
  encrypted: Buffer;
  iv: Buffer;
  tag: Buffer;
};

export type DatabaseCredentials = {
  username: string;
  password: string;
  additionalOptions?: Record<string, unknown> | undefined;
};

function getEncryptionKey(): Buffer {
  const keyHex = process.env.DB_CREDENTIALS_KEY;
  
  if (!keyHex) {
    throw new Error(
      "DB_CREDENTIALS_KEY environment variable is required. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  if (keyHex.length !== KEY_LENGTH * 2) {
    throw new Error(`DB_CREDENTIALS_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`);
  }

  return Buffer.from(keyHex, "hex");
}

export function encryptCredentials(credentials: DatabaseCredentials): EncryptedData {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const plaintext = JSON.stringify(credentials);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return { encrypted, iv, tag };
}

export function decryptCredentials(data: EncryptedData): DatabaseCredentials {
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, data.iv);
  decipher.setAuthTag(data.tag);

  const decrypted = Buffer.concat([
    decipher.update(data.encrypted),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8")) as DatabaseCredentials;
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString("hex");
}

export function hashForComparison(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
