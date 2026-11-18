# 团队任务台 · 前端（React）

给一个小组看今天有哪些事、谁在做、做到哪了。登录后看任务列表，可以搜索、新建任务、点开任务编辑标题 / 负责人 / 优先级 / 状态，也可以把任务指派给自己、在任务里讨论、复制任务链接分享给同事。列表里会显示截止日期，逾期未完成的任务会标红，也可以打开「只看逾期」让接口只返回这部分任务。

技术栈：React 19 + Vite 6，样式是原来的纯 CSS（`src/styles.css`），没有 UI 框架依赖。

## 跑起来

```bash
npm install
npm run dev      # http://localhost:5173
```

构建与预览：

```bash
npm run build    # 产物在 dist/
npm run preview  # 预览 dist/
```

> 本机如果默认的 node 加载不了 rollup 的原生模块（`ERR_DLOPEN_FAILED` / 签名不一致），用 `/opt/homebrew/bin/node` 跑：
> `/opt/homebrew/bin/node node_modules/vite/bin/vite.js build`。

接口地址的取值规则（`src/api.js` 的 `resolveApiBase`）：

- **线上（非本机地址）**：只走同源相对路径 `/api`。URL 参数、环境变量和旧版本写在 localStorage 里的地址一律忽略并清掉，避免有人发一条 `?api=https://自己的服务器` 的链接就把账号和 token 骗走。
- **本地（`localhost` / `127.0.0.1` / `file:` 打开）**：可用 `?api=http://host:port`（不会持久化）或构建时注入 `VITE_API_BASE` 指向测试服，都没有时连 `http://47.108.60.176`。

地址只接受 `http:` / `https:`，带用户名密码的 URL 会被丢弃。

## 测试

```bash
npm test         # Vitest + jsdom + Testing Library，44 个用例（含安全回归）
```

用例在 `src/App.test.jsx`，走真实的 `src/api.js`，用 `src/test/backend.js` 里的假后端模拟接口语义（登录 / 注册 / 401 / q 搜索 / overdue 过滤 / 任务 CRUD / 评论 / 权限）。`src/due.test.js` 单独覆盖截止日期和逾期判断的边界。

真实浏览器端到端（Playwright，对着本地 mock 后端 + `dist` 静态服务）：

```bash
npm run build
python3 tmp/react-e2e/mock_and_test.py
```

覆盖登录 / 注册 / 退出、列表计数、搜索与 `q` 参数、状态筛选、新建、详情编辑、指派、评论、深链接、删除二次确认、登录过期、移动端布局，截图写到 `screenshots/`。

## 部署

前端是纯静态产物，`dist/` 整个目录同步到后端提供的静态目录即可（同源访问 `/api`，不需要反向代理规则）：

```bash
./deploy-frontend.sh            # 构建并同步到 47.108.60.176:/var/www/team-tasks
TARGET=/some/dir ./deploy-frontend.sh
DRY_RUN=1 ./deploy-frontend.sh  # 只打印要改的文件
```

脚本用 `rsync --delete`，目标目录里多余的文件会被清掉（老的 `app.js` / `styles.css` 也会被移除），所以不要指向和别的站点共用的目录。需要本机有到服务器的 SSH 权限；脚本会拒绝 `/`、`/var` 这类系统目录，首次连接用 `StrictHostKeyChecking=accept-new` 记主机指纹，指纹变了会直接失败。发布前还会检查 `dist/index.html` 里有没有 CSP，缺失就不发。

## 安全

安全审计与整改记录见 [SECURITY-AUDIT.md](SECURITY-AUDIT.md)。前端侧已经做了：

- 线上强制同源 `/api`，不再接受 `?api=` 外部地址（防凭据钓鱼）；
- 登录 token 只放 `sessionStorage`，启动时清理旧版 `localStorage` 里的会话；
- 构建时给 `dist/index.html` 注入 CSP（`script-src 'self'`、`connect-src 'self'` 等）和 `no-referrer`；
- 依赖 `npm audit` 清零（Vitest 升到 5.1.0）。

页面本身没法设置 HTTP 响应头，下面这几项需要服务器（nginx 或 Java 静态资源层）补：

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
# 上 HTTPS 后再加
add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;
```

## 对齐的接口

### 用户

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册，入参 `{username, password, display_name?}`，返回 201 + `{token, user}`（只返回 `user` 时前端会切回登录页） |
| POST | `/api/auth/login` | 登录，入参 `{username, password}`，返回 200 + `{token, user}` |
| GET | `/api/auth/me` | 取当前登录用户，返回 200 + `user`；未登录 / token 失效返回 401 |
| POST | `/api/auth/logout` | 退出，返回 204（没实现也不影响前端清登录态） |

登录后前端在任务接口上带 `Authorization: Bearer <token>`。`user` 字段按 `{id, username, display_name, role}` 取，`token` 也兼容 `access_token`；后端定稿后如果字段不同，只需要改 `src/session.js` 里的 `pickToken` / `pickUser`。

登录态存在 `sessionStorage` 的 `ttb.session`（`{token, user}`）：刷新还在，关掉标签页就失效，也不和同源其它页面共享。旧版本留在 `localStorage` 里的 token 和接口地址会在启动时清掉。刷新页面先用 `/api/auth/me` 校验，401 就清掉会话回登录页；任务接口中途返回 401 也会直接回登录页并提示「登录已过期」（403 是没权限，不会踢下线）。

后端用户接口还没上线时（`/api/auth/*` 返回 404/405/501），页面会以匿名方式打开任务台并显示一条提示，接口一上线刷新即恢复强制登录，不会把现有任务台锁死。

### 任务

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/tasks` | 列表，返回 `{ items, total }`；可带 `q` 做服务端搜索（后端还没实现时会被忽略，前端仍会本地过滤） |
| GET | `/api/tasks/{id}` | 单条任务 |
| POST | `/api/tasks` | 新建，返回 201 + Task |
| PATCH | `/api/tasks/{id}` | 编辑，可传 `title` / `assignee` / `priority` / `status` 的任意子集，返回 200 + Task |
| DELETE | `/api/tasks/{id}` | 删除，返回 204；只允许创建人或管理员 |
| GET | `/api/users` | 团队成员，返回 `{ items, total }`；用于负责人候选 |

字段：`title`（必填，≤200）、`assignee`（必填，≤50）、`priority`（`low` / `medium` / `high`，默认 `medium`）、`status`（`todo` / `doing` / `done`，默认 `todo`）、`note`（选填，≤200，不填就不存），另有服务端生成的 `id`、`created_by`、`creator`、`created_at`、`updated_at`。

搜索：输入框提示写的是「搜标题、备注或负责人」，实际匹配标题 / 备注 / 负责人 / 创建人，关键词先去掉首尾空格、忽略大小写。输入框防抖 260 ms 后带 `q` 请求一次列表，同时始终在前端按这几个字段过滤。后端支持 `q` 时以服务端结果为准；不支持时（参数被忽略，或返回 4xx）本地过滤照样工作，不会把列表搜空。`/` 聚焦搜索框，Esc 清空。

「我负责的」按当前登录人的显示名（或账号名）匹配 `assignee`，纯前端筛选。

### 讨论（协作）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/tasks/{id}/comments` | 讨论列表，返回 `{ items, total }` |
| POST | `/api/tasks/{id}/comments` | 发一条讨论，入参 `{body}`（1–1000 字），返回 201 + Comment |

Comment 字段：`id`、`task_id`、`user_id`、`author`（账号）、`author_name`（显示名）、`body`、`created_at`。线上接口只认 `body`，传旧字段 `content` 会返回 422；前端读取时兼容 `content` / `text` 以及嵌套的 `user` 对象。

这两个接口还没上线时（404/405/501），任务详情里的讨论区会显示一条占位说明并隐藏输入框；后端上线后刷新即可用，不需要改前端。

### 删除与分享

- 详情里的「删除任务」需要点两次确认；只有创建人或 `admin` 能看到按钮，后端仍会再校验一次。
- 「复制链接」复制 `#task-{id}` 深链接，打开后自动定位到这条任务的详情。

## 行为说明

- 没登录只显示登录 / 注册页，登录后才拉任务；右上角显示当前用户，「退出」清掉本地会话回登录页。
- 点状态胶囊前进一格：待办 → 进行中 → 完成；完成后不能再前进。
- 误点可以用行尾的「↺」退回一格（只在鼠标悬停或聚焦时出现）。
- 状态更新、指派、删除都是乐观更新，接口失败会回滚并提示。
- 点任务标题或行尾的铅笔打开详情：可以改标题、负责人、优先级、状态，负责人支持从团队成员里选或直接输入；也可以一键「指派给我」。
- 详情底部是讨论区：Enter 发送、Shift+Enter 换行；评论接口未上线时显示占位说明。
- 新建任务的标题、负责人在前端先做非空和长度校验，后端返回的 `fields` 错误也会落到对应输入框下面；负责人默认填当前登录的人。
- 任务详情支持 `#task-{id}` 深链接，复制链接发给同事可以直接打开。

## 文件

- `index.html` — Vite 入口（挂载 `#root`）
- `src/main.jsx` — 挂载 React 应用，引入全局样式
- `src/App.jsx` — 登录态、任务列表状态、搜索 / 筛选、增删改、深浅链接
- `src/api.js` — 接口封装（超时、401 处理、错误字段规整）
- `src/session.js` — localStorage 会话、字段兼容、时间 / 头像等格式化
- `src/constants.js` — 状态、优先级、长度限制、存储 key
- `src/components/` — `AuthScreen`、`TaskBoard`、`TaskRow`、`NewTaskDialog`、`TaskDetailDialog`、`Toasts`
- `src/styles.css` — 全部样式，含登录页和移动端布局
- `src/App.test.jsx`、`src/test/` — 单元 / 交互测试与假后端
- `tmp/react-e2e/mock_and_test.py` — Playwright 真实浏览器端到端脚本（mock 后端 + 静态服务）
