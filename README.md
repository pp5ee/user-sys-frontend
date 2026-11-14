# 团队任务台 · 前端

给一个小组看今天有哪些事、谁在做、做到哪了。登录后看任务列表，可以新建任务、把状态从「待办」推到「进行中」再到「完成」。
现在带用户系统：登录 / 注册、登录态保持、未登录跳登录页、退出。新建任务默认把负责人填成当前登录的人。

## 跑起来

纯静态页面，没有构建步骤，也没有依赖。

```bash
# 本地预览（默认连测试服 http://47.108.60.176）
python3 -m http.server 8000
# 打开 http://localhost:8000
```

接口地址的取值顺序：

1. URL 参数 `?api=http://host:port`，会记在 localStorage 里，之后一直用它；
2. 本地（`localhost` / `127.0.0.1` / `file:`）打开时连 `http://47.108.60.176`；
3. 其它情况走同域相对路径 `/api`，适合和后端一起部署。

想改回同域：`?api=` 传空值不行，直接在控制台执行 `localStorage.removeItem('ttb.apiBase')`。

## 部署

把 `index.html`、`styles.css`、`app.js` 三个文件放到后端提供的静态目录即可，同源访问 `/api`，不需要反向代理规则。后端占着 80 端口，静态目录怎么挂、路径怎么分流由后端确认后再放。

## 对齐的接口

### 用户（待后端按 Swagger 最终确认）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册，入参 `{username, password, display_name?}`，返回 201 + `{token, user}`（只返回 `user` 时前端会切回登录页） |
| POST | `/api/auth/login` | 登录，入参 `{username, password}`，返回 200 + `{token, user}` |
| GET | `/api/auth/me` | 取当前登录用户，返回 200 + `user`；未登录 / token 失效返回 401 |
| POST | `/api/auth/logout` | 退出，返回 204（没实现也不影响前端清登录态） |

登录后前端在任务接口上带 `Authorization: Bearer <token>`。`user` 字段按 `{id, username, display_name, role}` 取，`token` 也兼容 `access_token`；后端定稿后如果字段不同，只需要改 `app.js` 里的 `pickToken` / `pickUser`。

登录态存在 `localStorage` 的 `ttb.session`（`{token, user}`），刷新页面先用 `/api/auth/me` 校验，401 就清掉会话回登录页；任务接口中途返回 401 也会直接回登录页并提示「登录已过期」。

后端用户接口还没上线时（`/api/auth/*` 返回 404/405），页面会以匿名方式打开任务台并显示一条提示，接口一上线刷新即恢复强制登录，不会把现有任务台锁死。

### 任务

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/tasks` | 列表，返回 `{ items, total }` |
| POST | `/api/tasks` | 新建，返回 201 + Task |
| PATCH | `/api/tasks/{id}` | 改状态，返回 200 + Task |

字段：`title`（必填，≤200）、`assignee`（必填，≤50）、`priority`（`low` / `medium` / `high`，默认 `medium`）、`status`（`todo` / `doing` / `done`，默认 `todo`），另有服务端生成的 `id`、`created_at`、`updated_at`。

前端一次拉全量列表，状态筛选、负责人/标题搜索在本地做，这样 tab 上的计数和过滤结果是同一份数据，切换不用再请求。

## 行为说明

- 没登录只显示登录 / 注册页，登录后才拉任务；右上角显示当前用户，「退出」清掉本地会话回登录页。
- 点状态胶囊前进一格：待办 → 进行中 → 完成；完成后不能再前进。
- 误点可以用行尾的「↺」退回一格（只在鼠标悬停或聚焦时出现）。
- 状态更新是乐观更新，接口失败会回滚并提示。
- 新建任务的标题、负责人在前端先做非空和长度校验，后端返回的 `fields` 错误也会落到对应输入框下面；负责人默认填当前登录的人。

## 文件

- `index.html` — 登录 / 注册页、任务台结构、新建任务弹窗、行模板
- `styles.css` — 全部样式，含登录页和移动端布局
- `app.js` — 接口封装、登录态、状态管理、渲染与交互
