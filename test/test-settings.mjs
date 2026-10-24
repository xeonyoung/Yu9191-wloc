import fs from 'fs';
import vm from 'vm';
const store = new Map([
  ['wloc_settings', JSON.stringify({ longitude: 121.4737, latitude: 31.2304, accuracy: 25 })],
  ['wloc_last', JSON.stringify({ evt: 'patched', at: '2026-10-24T10:00:00Z', offset: 0, locations: 2, wifi: 1, cell: 1 })],
]);
let doneArg = null;
const sandbox = {
  console: { log: () => {}, error: () => {} },
  $rocket: {},
  $persistentStore: { write: (v, k) => { store.set(k, v); return true; }, read: k => store.get(k) ?? null },
  $request: { url: 'https://gs-loc.apple.com/wloc-settings/save?action=probe' },
  $done: r => { doneArg = r; },
  setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), sandbox, { filename: 'wloc-settings.js' });
await new Promise(r => setTimeout(r, 300));
const body = doneArg?.response?.body ?? doneArg?.body;
console.log('done:', JSON.stringify(doneArg)?.slice(0, 200));
console.log('body:', body);
const j = JSON.parse(body);
console.log(j.success && j.hasSaved && j.last?.evt === 'patched' ? 'PASS probe' : 'FAIL probe');
