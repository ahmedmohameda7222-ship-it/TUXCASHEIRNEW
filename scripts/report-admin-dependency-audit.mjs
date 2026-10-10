import { spawnSync } from 'node:child_process';

function audit(args) {
  const result = spawnSync('npm', ['audit', '--json', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error('npm audit did not return valid JSON', { status: result.status });
    process.exitCode = 1;
    return null;
  }
  if (report.error || !report.vulnerabilities) {
    console.error('npm audit could not obtain current registry advisories', {
      error: report.error?.code ?? 'missing vulnerability summary',
    });
    process.exitCode = 1;
    return null;
  }
  return report;
}

const complete = audit([]);
const production = audit(['--omit=dev']);
if (!complete || !production) process.exit(1);

for (const [name, report] of [
  ['All dependencies', complete],
  ['Production dependencies (--omit=dev)', production],
]) {
  const findings = Object.entries(report.vulnerabilities)
    .filter(([, item]) => ['moderate', 'high', 'critical'].includes(item.severity))
    .sort((left, right) => left[0].localeCompare(right[0]));
  console.log(`=== ${name} ===`);
  console.log('Audit totals:', JSON.stringify(report.metadata?.vulnerabilities ?? {}));
  for (const [pkg, item] of findings) {
    const advisories = item.via
      .filter((entry) => typeof entry === 'object')
      .map((entry) => ({
        id: entry.source,
        title: entry.title,
        url: entry.url,
      }));
    console.log(JSON.stringify({
      package: pkg,
      severity: item.severity,
      direct: item.isDirect,
      range: item.range,
      fixAvailable: item.fixAvailable,
      advisories,
    }));
  }
}
console.log('Audit classification completed; vulnerabilities are not silently treated as clean.');
