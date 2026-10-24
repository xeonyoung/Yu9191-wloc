import fs from 'fs';
import vm from 'vm';
import zlib from 'zlib';
import assert from 'assert';

function varint(n) {
  const out = [];
  let v = Math.floor(n);
  while (v >= 128) { out.push((v % 128) | 128); v = Math.floor(v / 128); }
  out.push(v);
  return Buffer.from(out);
}
const tag = (f, w) => varint(f * 8 + w);
const lenField = (f, buf) => Buffer.concat([tag(f, 2), varint(buf.length), buf]);
const varField = (f, v) => Buffer.concat([tag(f, 0), varint(v)]);

function buildBody(lat, lon, acc = 25) {
  const loc = Buffer.concat([varField(1, Math.round(lat * 1e8)), varField(2, Math.round(lon * 1e8)), varField(3, acc)]);
  const wifi = Buffer.concat([lenField(1, Buffer.from('aa:bb:cc:dd:ee:ff')), lenField(2, loc)]);
  const payload = lenField(2, wifi);
  const head = Buffer.from([0, 0, 0, 1, 0, 0, 0, 0, payload.length >> 8 & 255, payload.length & 255]);
  return Buffer.concat([head, payload]);
}

function decodeCoord(buf) {
  // 粗略扫描：找 field1 varint（lat*1e8）与 field2 varint（lon*1e8）
  const found = [];
  for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] !== 0x08) continue;
    let p = i + 1, v = 0, mul = 1, b;
    do { b = buf[p++]; v += (b & 127) * mul; mul *= 128; } while (b & 128);
    if (buf[p] === 0x10) {
      let p2 = p + 1, v2 = 0, mul2 = 1, b2;
      do { b2 = buf[p2++]; v2 += (b2 & 127) * mul2; mul2 *= 128; } while (b2 & 128);
      found.push([v / 1e8, v2 / 1e8]);
    }
  }
  return found;
}

function runScript(scriptPath, { url, body, argument, encoding = 'identity' }) {
  const store = new Map();
  let doneArg = null;
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const sandbox = {
    console: { log: () => {}, error: () => {} },
    $rocket: {},
    $persistentStore: {
      write: (v, k) => { store.set(k, v); return true; },
      read: (k) => (store.has(k) ? store.get(k) : null),
    },
    $argument: argument || {},
    $request: { url },
    $response: { body: raw, bodyBytes: raw, headers: { 'Content-Encoding': encoding }, status: 200 },
    $done: (r) => { doneArg = r; },
    setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });
  return new Promise(res => setTimeout(() => res({ doneArg, store }), 400));
}

const SCRIPT = process.argv[2] || '/tmp/wloc.diag.min.js';
const CASES = [];

// 1. 正例：原始响应 → 目标坐标
{
  const body = buildBody(22.544577, 113.94114);
  const { doneArg, store } = await runScript(SCRIPT, {
    url: 'https://gs-loc.apple.com/clls/wloc', body,
    argument: { longitude: '121.4737', latitude: '31.2304', accuracy: '25' },
  });
  const out = Buffer.from(doneArg.response.bodyBytes);
  const last = JSON.parse(store.get('wloc_last'));
  const coords = decodeCoord(out);
  CASES.push(['patch-plain', last.evt === 'patched' && coords.some(([a, b]) => Math.abs(a - 31.2304) < 1e-6 && Math.abs(b - 121.4737) < 1e-6), JSON.stringify({ evt: last.evt, coords: coords.slice(-1) })]);
}

// 2. gzip 输入
{
  const body = zlib.gzipSync(buildBody(22.544577, 113.94114));
  const { doneArg, store } = await runScript(SCRIPT, {
    url: 'https://gs-loc.apple.com/clls/wloc', body,
    argument: { longitude: '116.3975', latitude: '39.9087', accuracy: '25' },
  });
  const last = JSON.parse(store.get('wloc_last'));
  const coords = decodeCoord(Buffer.from(doneArg.response.bodyBytes));
  CASES.push(['patch-gzip', last.evt === 'patched' && coords.some(([a, b]) => Math.abs(a - 39.9087) < 1e-6), JSON.stringify(last) + ' ' + JSON.stringify(coords.slice(-1))]);
}

// 3. 透传（无坐标）
{
  const { doneArg, store } = await runScript(SCRIPT, {
    url: 'https://gs-loc.apple.com/clls/wloc', body: buildBody(22.544577, 113.94114), argument: {},
  });
  const last = JSON.parse(store.get('wloc_last'));
  CASES.push(['passthrough', last.evt === 'passthrough' && Buffer.from(doneArg.response.bodyBytes).equals(buildBody(22.544577, 113.94114)), last.evt]);
}

// 4. 无法解析的响应 → parse-fail 被记录且放行
{
  const junk = Buffer.from('this-is-not-a-wloc-frame-at-all-0123456789');
  const { doneArg, store } = await runScript(SCRIPT, {
    url: 'https://gs-loc.apple.com/clls/wloc', body: junk,
    argument: { longitude: '121.4737', latitude: '31.2304' },
  });
  const last = JSON.parse(store.get('wloc_last'));
  CASES.push(['parse-fail-recorded', (last.evt === 'parse-fail' || last.evt === 'error') && Buffer.from(doneArg.response.bodyBytes).equals(junk), last.evt + ' ' + (last.detail || last.message || '').slice(0, 80)]);
}

let ok = true;
for (const [name, pass, info] of CASES) {
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + '   ' + info);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
