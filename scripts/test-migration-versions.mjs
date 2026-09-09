import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();

const byVersion = new Map();
for (const migration of migrations) {
  const separator = migration.indexOf('_');
  const version = migration.slice(0, separator);
  const existing = byVersion.get(version);
  if (existing !== undefined) {
    throw new Error(
      `Duplicate Supabase migration version ${version}: ${existing} and ${migration}`,
    );
  }
  byVersion.set(version, migration);
}

process.stdout.write('Supabase migration versions are unique.\n');
