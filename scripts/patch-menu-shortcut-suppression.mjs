import fs from 'node:fs';

const path = 'apps/operations/src/app/OrdersWorkspace.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source was not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: expected source was not unique`);
  }
  source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

replaceOnce(
  'Ctrl/Cmd+K suppression',
  `if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {\n        if (menuEditActive) return;\n        event.preventDefault();`,
  `if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {\n        event.preventDefault();\n        if (menuEditActive) return;`,
);

replaceOnce(
  'slash suppression',
  `if (event.key === '/' && !targetIsEditor && !menuEditActive) {\n        event.preventDefault();\n        setCategoryMode('SEARCH');`,
  `if (event.key === '/' && !targetIsEditor) {\n        event.preventDefault();\n        if (menuEditActive) return;\n        setCategoryMode('SEARCH');`,
);

fs.writeFileSync(path, source);
