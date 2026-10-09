// The managed cloud browser prohibits extension installation. This adapter
// lets the exact built scripts run on local pages without altering policies.
// It covers UI/editor behavior and the background bundle, not Chrome's
// installation, isolated worlds, service-worker lifecycle or permission UI.
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { DEFAULTS } from '../src/settings.js';

export async function prepareHarness(context, state) {
  let receiver;
  const local = {
    async get(defaults) {
      if (typeof defaults === 'string') return { [defaults]: state[defaults] };
      if (Array.isArray(defaults)) return Object.fromEntries(defaults.map(name => [name, state[name]]));
      return { ...defaults, ...state };
    },
    async set(update) {
      const changes = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, { oldValue: state[key], newValue: value }]));
      Object.assign(state, update);
      await writeFile('test-results/harness-settings.json', JSON.stringify(state));
      for (const page of context.pages()) page.evaluate(changes => window.__ordklarChanges?.(changes), changes).catch(() => {});
    }
  };
  const source = await readFile('dist/background.js', 'utf8');
  runInNewContext(source, {
    chrome: { runtime: { id: 'local-test-adapter', getURL: path => resolve('dist', path), onMessage: { addListener: listener => { receiver = listener; } } }, storage: { local } },
    fetch: async path => ({ ok: true, text: () => readFile(path, 'utf8') }),
    console, setTimeout, clearTimeout
  });
  await context.exposeBinding('__ordklarStorage', (_source, action, payload) => local[action](payload));
  await context.exposeBinding('__ordklarMessage', (_source, payload) => new Promise(resolve => receiver(payload, { id: 'local-test-adapter' }, resolve)));
  await context.addInitScript(() => {
    const listeners = [];
    window.__ordklarChanges = changes => { for (const listener of listeners) listener(changes, 'local'); };
    window.chrome = {
      storage: { local: { get: defaults => window.__ordklarStorage('get', defaults), set: update => window.__ordklarStorage('set', update) }, onChanged: { addListener: listener => listeners.push(listener) } },
      runtime: { sendMessage: message => window.__ordklarMessage(message), getURL: path => `${location.origin}/${path}`, openOptionsPage: () => window.open('/options.html') }
    };
  });
}

export async function isExtensionInstallationBlocked() {
  try {
    const policy = JSON.parse(await readFile('/etc/chromium/policies/managed/extensions.json', 'utf8'));
    return policy.ExtensionInstallBlocklist?.includes('*') === true;
  } catch { return false; }
}
export function freshState() { return structuredClone(DEFAULTS); }
