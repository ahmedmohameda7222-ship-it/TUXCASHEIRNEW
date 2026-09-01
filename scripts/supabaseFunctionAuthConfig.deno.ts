import { parse } from 'jsr:@std/toml@1.0.11';

const EXPECTED_VERIFY_JWT = {
  'device-bootstrap': false,
  'device-enroll': false,
  'operations-config': true,
  'operations-sync': true,
  'worker-auth': true,
} as const;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a TOML table.`);
  }
  return value as Record<string, unknown>;
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

Deno.test('Supabase Edge Function JWT deployment contract matches the audited auth matrix', async () => {
  let source: string;
  try {
    source = await Deno.readTextFile('supabase/config.toml');
  } catch (cause) {
    throw new Error(
      'supabase/config.toml is required so Edge Function JWT verification cannot drift at deploy time.',
      { cause },
    );
  }

  const parsed = parse(source);
  const functions = object(parsed['functions'], 'functions');

  const deployedFunctions: string[] = [];
  for await (const entry of Deno.readDir('supabase/functions')) {
    if (entry.isDirectory) deployedFunctions.push(entry.name);
  }
  deployedFunctions.sort();

  const expectedFunctions = Object.keys(EXPECTED_VERIFY_JWT).sort();
  assertEqual(
    JSON.stringify(deployedFunctions),
    JSON.stringify(expectedFunctions),
    'Every Edge Function directory must have an explicit audited JWT policy.',
  );

  const configuredFunctions = Object.keys(functions).sort();
  assertEqual(
    JSON.stringify(configuredFunctions),
    JSON.stringify(expectedFunctions),
    'supabase/config.toml must explicitly configure every current Edge Function and no stale function entries.',
  );

  for (const [functionName, expectedVerifyJwt] of Object.entries(EXPECTED_VERIFY_JWT)) {
    const configuration = object(functions[functionName], `functions.${functionName}`);
    const verifyJwt = configuration['verify_jwt'];
    if (typeof verifyJwt !== 'boolean') {
      throw new Error(`functions.${functionName}.verify_jwt must be an explicit boolean.`);
    }
    assertEqual(
      verifyJwt,
      expectedVerifyJwt,
      `functions.${functionName}.verify_jwt violates the audited caller authentication contract.`,
    );
  }
});
