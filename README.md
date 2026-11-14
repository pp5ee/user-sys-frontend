# 团队任务台 · 前端（React）

给一个小组看今天有哪些事、谁在做、做到哪了。登录后看任务列表，可以搜索、新建任务、点开任务编辑标题 / 负责人 / 优先级 / 状态，也可以把任务指派给自己、在任务里讨论、复制任务链接分享给同事。

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

接口地址的取值顺序（`src/api.js` 的 `resolveApiBase`）：

1. URL 参数 `?api=http://host:port`，会记在 localStorage 里，之后一直用它；
2. 构建时注入的 `VITE_API_BASE`；
3. localStorage 里记下的地址；
4. 本地（`localhost` / `127.0.0.1` / `file:`）打开时连 `http://47.108.60.176`；
5. 其它情况走同域相对路径 `/api`，适合和后端一起部署。

想改回同域：控制台执行 `localStorage.removeItem('ttb.apiBase')`。

## 测试

```bash
npm test         # Vitest + jsdom + Testing Library，21 个用例
```

用例在 `src/App.test.jsx`，走真实的 `src/api.js`，用 `src/test/backend.js` 里的假后端模拟接口语义（登录 / 注册 / 401 / q 搜索 / 任务 CRUD / 评论 / 权限）。

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

脚本用 `rsync --delete`，目标目录里多余的文件会被清掉（老的 `app.js` / `styles.css` 也会被移除），所以不要指向和别的站点共用的目录。需要本机有到服务器的 SSH 权限。

## 对齐的接口

### 用户

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册，入参 `{username, password, display_name?}`，返回 201 + `{token, user}`（只返回 `user` 时前端会切回登录页） |
| POST | `/api/auth/login` | 登录，入参 `{username, password}`，返回 200 + `{token, user}` |
| GET | `/api/auth/me` | 取当前登录用户，返回 200 + `user`；未登录 / token 失效返回 401 |
| POST | `/api/auth/logout` | 退出，返回 204（没实现也不影响前端清登录态） |

登录后前端在任务接口上带 `Authorization: Bearer <token>`。`user` 字段按 `{id, username, display_name, role}` 取，`token` 也兼容 `access_token`；后端定稿后如果字段不同，只需要改 `src/session.js` 里的 `pickToken` / `pickUser`。

登录态存在 `localStorage` 的 `ttb.session`（`{token, user}`），刷新页面先用 `/api/auth/me` 校验，401 就清掉会话回登录页；任务接口中途返回 401 也会直接回登录页并提示「登录已过期」。

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

字段：`title`（必填，≤200）、`assignee`（必填，≤50）、`priority`（`low` / `medium` / `high`，默认 `medium`）、`status`（`todo` / `doing` / `done`，默认 `todo`），另有服务端生成的 `id`、`created_by`、`creator`、`created_at`、`updated_at`。

搜索：输入框防抖 260 ms 后带 `q` 请求一次列表，同时始终在前端按标题 / 负责人 / 创建人过滤。后端支持 `q` 时以服务端结果为准；不支持时（参数被忽略，或返回 4xx）本地过滤照样工作，不会把列表搜空。`/` 聚焦搜索框，Esc 清空。

「我负责的」按当前登录人的显示名（或账号名）匹配 `assignee`，纯前端筛选。

### 讨论（协作）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/tasks/{id}/comments` | 讨论列表，返回 `{ items, total }` |
| POST | `/api/tasks/{id}/comments` | 发一条讨论，入参 `{content}`（1–1000 字），返回 201 + Comment |

Comment 字段：`id`、`task_id`、`user_id`、`username`、`display_name`、`content`、`created_at`。前端也兼容 `content` 之外的 `body` / `text`，以及嵌套的 `user` 对象。

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
