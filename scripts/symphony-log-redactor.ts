import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const MARKER = Buffer.from('[REDACTED]');

function normalizeSecrets(
  secrets: Buffer | readonly Buffer[]
): readonly Buffer[] {
  const values = Buffer.isBuffer(secrets) ? [secrets] : secrets;
  if (values.length === 0 || values.some((secret) => secret.length === 0)) {
    throw new Error('redaction secrets must not be empty');
  }
  return values;
}

export function redactBytes(
  input: Buffer,
  secrets: Buffer | readonly Buffer[]
): Buffer {
  let output = input;
  for (const secret of normalizeSecrets(secrets)) {
    output = redactOneSecret(output, secret);
  }
  return output;
}

function redactOneSecret(input: Buffer, secret: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < input.length) {
    const match = input.indexOf(secret, offset);
    if (match < 0) {
      chunks.push(input.subarray(offset));
      break;
    }
    chunks.push(input.subarray(offset, match), MARKER);
    offset = match + secret.length;
  }
  return Buffer.concat(chunks);
}

function assertDirectory(path: string, label: string): string {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
  return absolute;
}

export function redactTree(
  rawRoot: string,
  outputRoot: string,
  secrets: Buffer | readonly Buffer[],
  excludedPath?: string
): void {
  const raw = assertDirectory(rawRoot, 'raw log root');
  const output = assertDirectory(outputRoot, 'redacted log root');
  const excluded =
    excludedPath === undefined ? undefined : resolve(excludedPath);
  if (raw === output) {
    throw new Error('raw and redacted log roots must differ');
  }

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      if (source === excluded) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        throw new Error(`raw log tree must not contain symlinks: ${source}`);
      }
      if (entry.isDirectory()) {
        visit(source);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `raw log tree contains an unsupported entry: ${source}`
        );
      }

      const destination = join(output, relative(raw, source));
      const redacted = redactBytes(readFileSync(source), secrets);
      if (
        normalizeSecrets(secrets).some(
          (secret) => redacted.indexOf(secret) >= 0
        )
      ) {
        throw new Error(`redaction verification failed: ${source}`);
      }
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, redacted, { mode: 0o600 });
    }
  };

  visit(raw);
}

async function redactStream(secretsInput: readonly Buffer[]): Promise<void> {
  const secrets = normalizeSecrets(secretsInput);
  const maxSecretLength = Math.max(...secrets.map((secret) => secret.length));
  let pending = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    while (pending.length >= maxSecretLength) {
      const matches = secrets
        .map((secret) => ({ index: pending.indexOf(secret), secret }))
        .filter(({ index }) => index >= 0)
        .sort((left, right) => left.index - right.index);
      const first = matches[0];
      if (first !== undefined) {
        process.stdout.write(pending.subarray(0, first.index));
        process.stdout.write(MARKER);
        pending = pending.subarray(first.index + first.secret.length);
        continue;
      }

      const safeLength = pending.length - maxSecretLength + 1;
      process.stdout.write(pending.subarray(0, safeLength));
      pending = pending.subarray(safeLength);
      break;
    }
  }
  process.stdout.write(redactBytes(pending, secrets));
}

function collectStringValues(value: unknown, output: string[]): void {
  if (typeof value === 'string' && value.length > 0) {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, output);
  }
}

function prepareSecrets(authPath: string, outputPath: string): void {
  const trackerSecret = process.env.SYMPHONY_REDACTION_SECRET ?? '';
  if (!/^[A-Za-z0-9_]+$/.test(trackerSecret)) {
    throw new Error(
      'SYMPHONY_REDACTION_SECRET must be a non-empty tracker token'
    );
  }
  const authStat = lstatSync(authPath);
  if (!authStat.isFile() || authStat.isSymbolicLink()) {
    throw new Error('model auth input must be a regular non-symlink file');
  }
  const values = [trackerSecret];
  collectStringValues(JSON.parse(readFileSync(authPath, 'utf8')), values);
  const unique = [...new Set(values)].sort(
    (left, right) => right.length - left.length
  );
  if (unique.length < 2) {
    throw new Error('model auth input contains no string value to redact');
  }
  writeFileSync(outputPath, JSON.stringify(unique), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

function loadSecrets(): readonly Buffer[] {
  const file = process.env.SYMPHONY_REDACTION_SECRETS_FILE;
  if (file !== undefined) {
    const values = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.some((value) => typeof value !== 'string' || value.length === 0)
    ) {
      throw new Error('redaction secrets file must contain non-empty strings');
    }
    return [...new Set(values)].map((value) => Buffer.from(value));
  }
  const fallback = process.env.SYMPHONY_REDACTION_SECRET ?? '';
  if (fallback.length === 0) {
    throw new Error('SYMPHONY_REDACTION_SECRETS_FILE is required');
  }
  return [Buffer.from(fallback)];
}

async function main(): Promise<void> {
  if (process.argv[2] === '--prepare' && process.argv.length === 5) {
    prepareSecrets(process.argv[3] ?? '', process.argv[4] ?? '');
    return;
  }
  const secrets = loadSecrets();
  if (process.argv[2] === '--stream' && process.argv.length === 3) {
    await redactStream(secrets);
    return;
  }
  if (process.argv[2] === '--tree' && process.argv.length === 5) {
    redactTree(
      process.argv[3] ?? '',
      process.argv[4] ?? '',
      secrets,
      process.env.SYMPHONY_REDACTION_SECRETS_FILE
    );
    return;
  }
  throw new Error(
    'usage: tenkacloud-symphony-redact-logs --prepare AUTH OUTPUT | --stream | --tree RAW_ROOT OUTPUT_ROOT'
  );
}

if (import.meta.main) {
  await main();
}
