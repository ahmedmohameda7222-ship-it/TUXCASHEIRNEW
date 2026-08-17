import { readRuntimeConfig } from '@tux/config';

const runtimeConfig = readRuntimeConfig(import.meta.env);

export function App() {
  const runtime = window.tuxDesktop === undefined ? 'Browser fallback' : 'Electron desktop';

  return (
    <main className="foundation-shell">
      <section className="foundation-panel" aria-labelledby="foundation-title">
        <span className="brand-mark" aria-hidden="true">
          TUX
        </span>
        <h1 id="foundation-title">TUX Operations</h1>
        <p>Engineering foundation</p>
        <dl className="foundation-status">
          <div>
            <dt>Runtime</dt>
            <dd>{runtime}</dd>
          </div>
          <div>
            <dt>Remote backend</dt>
            <dd>{runtimeConfig.remoteBackendMode}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
