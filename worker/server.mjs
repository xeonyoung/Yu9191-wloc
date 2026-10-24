// 本机运行入口：Cloudflare Worker 的 Hono app + 脚本/模块静态分发
// 目的：模块的 script-path 不再依赖 GitHub raw（原作者仓库已 404），
// 统一走 https://wloc.bybot.si/dist/*.js，由本机直接提供。
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // 仓库根目录

const FILES = {
  '/dist/wloc.js': ['dist/wloc.js', 'application/javascript; charset=utf-8'],
  '/dist/wloc-settings.js': ['dist/wloc-settings.js', 'application/javascript; charset=utf-8'],
  '/modules/wloc.sgmodule': ['modules/wloc.sgmodule', 'text/plain; charset=utf-8'],
  '/modules/wloc.conf': ['modules/wloc.conf', 'text/plain; charset=utf-8'],
  '/modules/wloc.lpx': ['modules/wloc.lpx', 'text/plain; charset=utf-8'],
  '/modules/wloc.stoverride': ['modules/wloc.stoverride', 'text/plain; charset=utf-8'],
  '/modules/wloc.module': ['modules/wloc.module', 'text/plain; charset=utf-8'],
  '/modules/wloc-migrate.sgmodule': ['modules/wloc-migrate.sgmodule', 'text/plain; charset=utf-8'],
  '/modules/wloc-migrate.conf': ['modules/wloc-migrate.conf', 'text/plain; charset=utf-8'],
  '/modules/wloc-migrate.lpx': ['modules/wloc-migrate.lpx', 'text/plain; charset=utf-8'],
  '/modules/wloc-migrate.stoverride': ['modules/wloc-migrate.stoverride', 'text/plain; charset=utf-8'],
  '/modules/wloc-all.sgmodule': ['modules/wloc-all.sgmodule', 'text/plain; charset=utf-8'],
  '/modules/wloc-all.conf': ['modules/wloc-all.conf', 'text/plain; charset=utf-8'],
  '/modules/wloc-all.lpx': ['modules/wloc-all.lpx', 'text/plain; charset=utf-8'],
  '/modules/wloc-all.stoverride': ['modules/wloc-all.stoverride', 'text/plain; charset=utf-8'],
  '/wloc.jpg': ['wloc.jpg', 'image/jpeg'],
};

const server = new Hono();
// 访问日志：用于确认手机请求到底有没有落到本服务（而不是还在走公共 worker）
server.use('*', async (c, next) => {
  const t0 = Date.now();
  await next();
  const u = new URL(c.req.url);
  const ua = (c.req.header('user-agent') || '-').replace(/"/g, "'").slice(0, 70);
  console.log(
    `[access] ${new Date().toISOString()} ${c.req.method} ${u.pathname}${u.search.slice(0, 160)} ${c.res.status} ${Date.now() - t0}ms ua="${ua}"`
  );
});



server.get('*', async (c, next) => {
  const p = new URL(c.req.url).pathname;
  const hit = FILES[p];
  if (!hit) return next();
  try {
    const buf = fs.readFileSync(path.join(ROOT, hit[0]));
    return c.body(buf, 200, {
      'Content-Type': hit[1],
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
  } catch (e) {
    return c.text('not found: ' + hit[0], 404);
  }
});

server.route('/', app);

const port = Number(process.env.PORT || 8788);
const hostname = process.env.HOST || '127.0.0.1';
serve({ fetch: server.fetch, port, hostname }, (info) => {
  console.log(`[wloc-worker] listening on http://${hostname}:${info.port}`);
});
