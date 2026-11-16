/**
 * 测试用的假后端：实现和 README 约定的接口一致的 HTTP 语义。
 * fetch 被 stub 后，前端真实的请求层（src/api.js）走完整流程。
 */

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

export function createBackend(overrides = {}) {
  const users = [
    { id: 1, username: 'bbsee', display_name: 'BBSee', role: 'admin' },
    { id: 2, username: 'zhou', display_name: '老周', role: 'member' },
  ];
  let nextTaskId = 4;
  const tasks = [
    {
      id: 1,
      title: '登录页联调',
      assignee: 'BBSee',
      priority: 'high',
      status: 'doing',
      note: '联调时注意旧会话的兼容。',
      created_by: 1,
      creator: 'bbsee',
      created_at: '2026-11-14T10:00:00Z',
      updated_at: '2026-11-14T11:00:00Z',
      comment_count: 1,
    },
    {
      id: 2,
      title: '80 端口静态挂载',
      assignee: '老周',
      priority: 'medium',
      status: 'todo',
      created_by: 2,
      creator: 'zhou',
      created_at: '2026-11-14T09:00:00Z',
      updated_at: '2026-11-14T09:30:00Z',
      comment_count: 0,
    },
    {
      id: 3,
      title: '移动端排版',
      assignee: '阿哲',
      priority: 'low',
      status: 'done',
      created_by: null,
      creator: null,
      created_at: '2026-11-13T09:00:00Z',
      updated_at: '2026-11-13T10:00:00Z',
      comment_count: 0,
    },
  ];
  const comments = { 1: [{ id: 11, username: 'zhou', display_name: '老周', content: '字段我这边按 q 做。', created_at: '2026-11-14T10:30:00Z' }] };

  const state = {
    auth: 'ok', // ok | 404
    sessions: { 'tok-bbsee': users[0] },
    taskMode: 'ok',
    lastQuery: null,
    calls: [],
  };

  async function handler(url, init = {}) {
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname;
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    const token = auth.replace(/^Bearer\s+/, '');
    const me = state.sessions[token] || null;
    state.calls.push({ method, path, query: parsed.search, body, token });

    if (overrides.handler) {
      const custom = await overrides.handler({ path, method, body, me, state, parsed });
      if (custom) return custom;
    }

    /* ---- 用户 ---- */
    if (path === '/api/auth/me') {
      if (String(state.auth) === '404') return json(404, { error: { message: 'Not Found' } });
      return me ? json(200, me) : json(401, { error: { message: 'unauthorized' } });
    }
    if (path === '/api/auth/login') {
      const found = users.find((u) => u.username === body?.username);
      if (!found || body.password !== 'password123') return json(401, { error: { message: 'invalid credentials' } });
      const tok = `tok-${found.username}`;
      state.sessions[tok] = found;
      return json(200, { token: tok, user: found });
    }
    if (path === '/api/auth/register') {
      if (users.some((u) => u.username === body?.username)) return json(409, { error: { message: 'taken' } });
      const created = { id: users.length + 1, username: body.username, display_name: body.display_name, role: 'member' };
      users.push(created);
      const tok = `tok-${created.username}`;
      state.sessions[tok] = created;
      return json(201, { token: tok, user: created });
    }
    if (path === '/api/auth/logout') return json(204, undefined);

    // 用户接口未上线（auth === '404'）时后端也不要求登录，前端按匿名模式浏览。
    const requireAuth = String(state.auth) !== '404';

    if (path === '/api/users') {
      if (!me && requireAuth) return json(401, { error: { message: 'unauthorized' } });
      return json(200, { items: users, total: users.length });
    }

    /* ---- 任务 ---- */
    if (path === '/api/tasks' && method === 'GET') {
      if (!me && requireAuth) return json(401, { error: { message: 'unauthorized' } });
      if (state.taskMode === 'error') return json(500, { error: { message: '服务器开小差了' } });
      const q = parsed.searchParams.get('q');
      state.lastQuery = q;
      const list = q
        ? tasks.filter((task) =>
            [task.title, task.assignee, task.creator].some((value) => String(value || '').toLowerCase().includes(q.toLowerCase()))
          )
        : tasks;
      return json(200, { items: list.map((task) => ({ ...task })), total: list.length });
    }

    if (path === '/api/tasks' && method === 'POST') {
      if (!me && requireAuth) return json(401, { error: { message: 'unauthorized' } });
      const task = {
        id: nextTaskId++,
        title: body.title,
        assignee: body.assignee,
        priority: body.priority || 'medium',
        status: 'todo',
        created_by: me.id,
        creator: me.username,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        comment_count: 0,
      };
      // 和真实后端一致：没传 note 就不存这个字段
      if (body.note) task.note = body.note;
      tasks.unshift(task);
      return json(201, task);
    }

    const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch) {
      const task = tasks.find((item) => String(item.id) === taskMatch[1]);
      if (!me && requireAuth) return json(401, { error: { message: 'unauthorized' } });
      if (!task) return json(404, { error: { message: 'not found' } });
      if (method === 'PATCH') {
        Object.assign(task, body, { updated_at: new Date().toISOString() });
        return json(200, { ...task });
      }
      if (method === 'DELETE') {
        if (me.role !== 'admin' && String(task.created_by) !== String(me.id)) {
          return json(403, { error: { message: 'forbidden' } });
        }
        const index = tasks.indexOf(task);
        tasks.splice(index, 1);
        return json(204, undefined);
      }
      return json(200, { ...task });
    }

    const commentMatch = path.match(/^\/api\/tasks\/(\d+)\/comments$/);
    if (commentMatch) {
      const taskId = Number(commentMatch[1]);
      if (!me && requireAuth) return json(401, { error: { message: 'unauthorized' } });
      if (state.commentsMissing) return json(404, { error: { message: 'Not Found' } });
      if (method === 'GET') {
        const items = comments[taskId] || [];
        return json(200, { items, total: items.length });
      }
      if (method === 'POST') {
        if (!body.content) return json(422, { error: { message: 'invalid', fields: { content: 'is required' } } });
        const list = comments[taskId] || (comments[taskId] = []);
        const item = {
          id: 100 + list.length,
          username: me.username,
          display_name: me.display_name,
          content: body.content,
          created_at: new Date().toISOString(),
        };
        list.push(item);
        return json(201, item);
      }
    }

    return json(404, { error: { message: `no route ${method} ${path}` } });
  }

  return { handler, state, tasks, users, comments };
}

export function stubFetch(backend) {
  return async function fetchMock(url, init) {
    return backend.handler(String(url), init);
  };
}
