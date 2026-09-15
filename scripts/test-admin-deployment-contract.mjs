import fs from 'node:fs';
import path from 'node:path';

const vercelPath = 'apps/admin/vercel.json';
const cronDir = 'apps/admin/api/cron';
const config = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
const crons = Array.isArray(config.crons) ? config.crons : [];

const expected = new Map([
  ['/api/cron/admin-config-scheduler', '* * * * *'],
]);

for (const [routePath, schedule] of expected) {
  const matches = crons.filter((entry) => entry?.path === routePath);
  if (matches.length !== 1 || matches[0]?.schedule !== schedule) {
    throw new Error(`Admin cron deployment contract missing ${routePath} @ ${schedule}`);
  }
}

const routeFiles = fs
  .readdirSync(cronDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => entry.name)
  .sort();

for (const fileName of routeFiles) {
  const routePath = `/api/cron/${fileName.slice(0, -3)}`;
  const matches = crons.filter((entry) => entry?.path === routePath);
  if (matches.length !== 1) {
    throw new Error(`Admin cron route ${routePath} must have exactly one Vercel schedule`);
  }
}

const schedulerSource = fs.readFileSync(path.join(cronDir, 'admin-config-scheduler.ts'), 'utf8');
if (!schedulerSource.includes('handleCatalogSchedulerRequest')) {
  throw new Error('Admin config scheduler route must use the shared scheduler auth handler');
}
if (!schedulerSource.includes("process.env['CRON_SECRET']")) {
  throw new Error('Admin config scheduler route must use the CRON_SECRET deployment contract');
}

console.log('Admin deployment cron contract passed.');
