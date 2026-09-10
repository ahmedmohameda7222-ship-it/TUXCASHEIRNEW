#!/usr/bin/env node

import { createHmac, pbkdf2 as pbkdf2Callback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);
const CANONICAL_TUX_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const PIN_PATTERN = /^\d{4,12}$/;
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

function usage() {
  process.stdout.write('Usage: node scripts/bootstrap-admin-owner.mjs --name "<display name>"\n');
}

function parseArguments(argv) {
  let displayName = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true, displayName: '' };
    if (arg === '--name') {
      displayName = argv[index + 1]?.trim() ?? '';
      index += 1;
      continue;
    }
    throw new Error(`unknown_argument:${arg}`);
  }
  if (!displayName || displayName.length > 120) throw new Error('owner_name_required');
  return { help: false, displayName };
}

function requiredSecret(value, name) {
  const secret = value?.trim() ?? '';
  if (secret.length < 16) throw new Error(`${name}_missing_or_too_short`);
  return secret;
}

function projectUrl() {
  const raw = process.env.TUX_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim() ?? '';
  if (!raw) throw new Error('supabase_url_missing');
  const url = new URL(raw);
  const local = new Set(['localhost', '127.0.0.1', '::1']).has(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('supabase_url_invalid');
  }
  return url.origin;
}

async function readPipedPin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk.toString();
  return text.split(/\r?\n/, 1)[0]?.trim() ?? '';
}

async function readHiddenPin(prompt = 'Owner PIN: ') {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return readPipedPin();
  }

  process.stdout.write(prompt);
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          finish();
          reject(new Error('bootstrap_cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(value.trim());
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (/\d/.test(character) && value.length < 12) value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function encodePin(enteredPin, lookupSecret) {
  if (!PIN_PATTERN.test(enteredPin)) throw new Error('pin_must_be_4_to_12_digits');
  const salt = randomBytes(SALT_BYTES);
  const digest = await pbkdf2(
    enteredPin,
    salt,
    PBKDF2_ITERATIONS,
    DERIVED_KEY_BYTES,
    'sha256',
  );
  return {
    pinLookupHash: createHmac('sha256', lookupSecret)
      .update(`tux-admin-pin-v1:${enteredPin}`)
      .digest('hex'),
    pinHash: `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${digest.toString('hex')}`,
  };
}

async function callBootstrap({ url, serviceRoleKey, displayName, pinLookupHash, pinHash }) {
  const response = await fetch(`${url}/rest/v1/rpc/bootstrap_tux_admin_owner_v1`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_business_id: CANONICAL_TUX_BUSINESS_ID,
      p_display_name: displayName,
      p_pin_lookup_hash: pinLookupHash,
      p_pin_hash: pinHash,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    if (body.includes('TUX_ADMIN_OWNER_ALREADY_EXISTS')) throw new Error('owner_already_exists');
    if (body.includes('TUX_ADMIN_PIN_ALREADY_IN_USE')) throw new Error('pin_already_in_use');
    throw new Error(`owner_bootstrap_failed:${response.status}`);
  }
  const employeeId = JSON.parse(body);
  if (typeof employeeId !== 'string' || !employeeId) throw new Error('owner_bootstrap_invalid_response');
  return employeeId;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const url = projectUrl();
  const serviceRoleKey = requiredSecret(
    process.env.TUX_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    'service_role_key',
  );
  const lookupSecret = requiredSecret(
    process.env.TUX_ADMIN_PIN_LOOKUP_SECRET,
    'admin_pin_lookup_secret',
  );

  let enteredPin = await readHiddenPin();
  const credential = await encodePin(enteredPin, lookupSecret);
  enteredPin = '';

  const employeeId = await callBootstrap({
    url,
    serviceRoleKey,
    displayName: args.displayName,
    pinLookupHash: credential.pinLookupHash,
    pinHash: credential.pinHash,
  });
  process.stdout.write(`Created first TUX Admin OWNER: ${employeeId}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'owner_bootstrap_failed';
  process.stderr.write(`Admin OWNER bootstrap failed: ${message}\n`);
  process.exitCode = 1;
});
