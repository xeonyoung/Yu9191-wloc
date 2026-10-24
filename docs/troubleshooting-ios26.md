# iOS 26.6.1 失效排查手册

适用：Shadowrocket / Surge / Loon / Quantumult X / Stash，iOS 26.x（iOS 27 正式版不支持 MITM 方案）。

## 0. 先分清三件事

WLOC 是一条四段链路，任何一段断掉，现象都是"地图上位置没变"：

```
① 代理在跑 + MITM 打开 + 证书被信任
        ↓
② /clls/wloc 请求被拦到，wloc.js 被执行
        ↓
③ wloc.js 解析响应 → 改写成目标坐标（日志 patched）
        ↓
④ 系统 locationd 接受新坐标（iOS 26 有内存缓存，需重启）
```

"快捷指令提示成功"只代表**写坐标那一步**（`/wloc-settings/save`）走通了，连 ② 都不能证明。

## 1. 一条 URL 定位断点

代理开着、模块启用的情况下，Safari 打开：

```
https://gs-loc.apple.com/wloc-settings/save?action=probe
```

正常会返回一段 JSON：

```json
{
  "success": true,
  "engine": "Shadowrocket",
  "hasSaved": true,
  "saved": { "longitude": 121.4737, "latitude": 31.2304 },
  "last": { "evt": "patched", "at": "2026-10-24T10:00:00Z", "offset": 0, "locations": 2, "wifi": 1, "cell": 1 }
}
```

对照 `last.evt` 判断：

| 现象 | 断点 | 处理 |
|------|------|------|
| 页面打不开 / 超时 / 返回 404、非 JSON | ① | 证书没信任 / MITM 关着 / 模块没启用 / 当前网络没走代理 |
| `"last": null` 或字段缺失 | ②（从未拦到过 `/clls/wloc`） | 看代理日志有没有 `gs-loc` 请求；关掉 QUIC/HTTP3；确认 5 个域名都在 MITM |
| `evt: "passthrough"` | ③ 之前：设备里没有坐标 | 重跑快捷指令；看 `saved` 是否 null |
| `evt: "patched"` | ①②③ 全通 | 只剩 ④ → **重启设备** |
| `evt: "parse-fail"` | ③：响应格式不兼容 | 见第 4 节，换 patcher |
| `evt: "error"` | ③：脚本异常 | 把 `message` 原文贴出来 |

### 不想用这条 URL 的话

代理日志里搜 `[wloc]`：

- `[wloc] Response https://gs-loc.apple.com/clls/wloc` → 拦到了
- `[wloc] patched at offset=0 locations=N` → 改写成功
- `[wloc] no patchable wloc payload found; ...` → 格式不兼容
- 一条都没有 → ① 或 ② 断了

## 2. iOS 26.6.1 的生效流程

iOS 26 起 `locationd` 会把上一次的真实定位长时间缓存在内存里。**脚本改写成功 ≠ 系统会用**，开关定位服务、开关飞行模式都不清这个缓存。

### 方案 A：重启法（成功率最高）

1. 先在快捷指令 / 选点页面把目标坐标存好（probe 里 `hasSaved: true`）
2. 开飞行模式 → 关闭定位服务 → **重启设备**
3. 重启后：关飞行模式（Wi-Fi 先别开）→ 连代理（确认 VPN 图标出现）→ 打开定位服务
4. 打开地图 App 验证

### 方案 B：不重启时的刷新法

1. 关闭定位服务
2. 开飞行模式，确认 Wi-Fi、蓝牙也真的关闭（iOS 会保留手动开启状态，别只看图标）
3. 等 10 秒
4. 关飞行模式，等网络和代理完全恢复（VPN 图标出现）
5. 最后才打开定位服务 → 开地图

若方案 B 反复不生效，回到方案 A。iOS 26.x 上这属于系统行为，不是配置错。

## 3. 客户端检查清单

- 模块是"已启用"，不是只导入
- HTTPS 解密 / MITM 总开关打开；证书在「设置 → 通用 → 关于本机 → 证书信任设置」里完全信任
- MITM 主机名包含全部 5 个：
  ```
  gs-loc.apple.com
  gs-loc-cn.apple.com
  gsp-ssl.ls.apple.com
  bluedot.is.autonavi.com
  bluedot.is.autonavi.com.gds.alibabadns.com
  ```
- 关掉 QUIC / HTTP3（部分版本叫「HTTP/3 加速」），重连代理
- 不要同时启用两个改定位的模块（另一个 wloc 衍生模块、或独立的定位模拟模块），会互相覆盖
- 模块 `argument` 里没填死别的经纬度（填了就优先于快捷指令存的坐标）
- 快捷指令 / 选点页面必须走代理：Safari 关掉「无痕」以外的限制无所谓，但 VPN 必须在连
- 只改网络定位（Wi-Fi / 基站），GPS 信号强时系统会用 GPS 覆盖，测试尽量在室内

## 4. 出现 parse-fail 怎么办

`parse-fail` 表示 Apple 的响应封装又变了，当前 patcher 认不出来（会原样放行，所以不影响上网，只是定位不变）。

想继续用本仓库：把 `last.detail` 原文发出来，按里面的 `@offset:错误` 补偏移/封装解析。

想立刻能用：换一个对多封装（ARPC / marker / synthetic / bare）做了兜底的开源实现，例如 `mekos2772/ios-location-spoofer`（同样走 MITM + `/clls/wloc`，支持 Surge / Loon / QX / Stash / 小火箭，iOS 26/27 有对应说明）。两者**不要同时启用**。

## 5. 恢复真实定位

1. 快捷指令「wloc 清理恢复位置」，或在 probe 里确认 `saved: null`
2. 模块参数保持默认（113.94114, 22.544577），否则会继续用参数里的坐标
3. 重启设备（iOS 26 必须）
4. 仍不恢复：关闭模块 → 重启

## 6. 本仓库改了什么

| 文件 | 改动 |
|------|------|
| `modules/*` | 脚本、图标、订阅地址从已删除的 `Yu9191/wloc` 改为本仓库 |
| `dist/wloc.js` | 增加 `wloc_last` 打点（hit / empty-body / passthrough / patched / patched-raw / parse-fail / error），改写逻辑不变 |
| `dist/wloc-settings.js` | 增加 `action=probe`，返回 `saved` + `last`，响应加 `Cache-Control: no-store` |
| `dist/orig/*` | 原版脚本备份，可随时回滚 |
| `test/test-wloc.mjs`、`test/test-settings.mjs` | 离线回归测试（伪造 wloc 响应 / 伪造 probe 请求），不需要真机 |

回滚：

```bash
cp dist/orig/wloc.js dist/wloc.js
cp dist/orig/wloc-settings.js dist/wloc-settings.js
```

## 7. 自托管服务（已上线，模块与脚本都从这里取）

| 项 | 值 |
|---|---|
| 选点页面 | `https://wloc.bybot.si/` |
| 链接解析 | `https://wloc.bybot.si/api/parse?u=<链接>&format=json` |
| 定位脚本 | `https://wloc.bybot.si/dist/wloc.js` |
| 设置脚本 | `https://wloc.bybot.si/dist/wloc-settings.js` |
| 模块订阅 | `https://wloc.bybot.si/modules/wloc.sgmodule`（Surge/小火箭）、`.conf`（QX）、`.lpx`（Loon）、`.stoverride`（Stash） |
| 运行方式 | 本机 Node 跑 Hono（`worker/server.mjs`），端口 8788 |
| 对外通道 | cloudflared 隧道 `monitor`，ingress `wloc.bybot.si → 127.0.0.1:8788` |
| 进程管理 | `systemctl status/restart wloc-worker` |
| 日志 | `/var/log/wloc-worker.log` |

模块里的 `script-path` 已全部指向本服务，**不依赖 GitHub raw**，所以推不推 fork 都能用。

运维：

```bash
systemctl status wloc-worker        # 看状态
systemctl restart wloc-worker       # 改完 dist/modules 后（其实每次请求都读文件，改了立即生效）
tail -f /var/log/wloc-worker.log
```

回滚：快捷指令与模块换回公共地址即可；服务端 `systemctl disable --now wloc-worker`；隧道配置备份 `/etc/cloudflared/config.yml.bak-wloc-*`。
