'use strict';

/* ------------------------------------------------------------------ *
 * 团队任务台 — 前端
 * 任务：GET /api/tasks · POST /api/tasks · PATCH /api/tasks/{id}
 * 用户：POST /api/auth/register · POST /api/auth/login
 *       GET  /api/auth/me       · POST /api/auth/logout
 * ------------------------------------------------------------------ */

const TEST_API = 'http://47.108.60.176';
const STATUS_LABEL = { todo: '待办', doing: '进行中', done: '完成' };
const PRIORITY_LABEL = { low: '低', medium: '中', high: '高' };
const NEXT_STATUS = { todo: 'doing', doing: 'done', done: null };
const PREV_STATUS = { todo: null, doing: 'todo', done: 'doing' };
const AVATAR_COLORS = ['#2f6f5e', '#3a5f9e', '#8a5a2b', '#7b4b8a', '#2b6a7a', '#8a4b4b'];
const SESSION_KEY = 'ttb.session';
// 与后端 /api/auth/register 的校验规则保持一致
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const USERNAME_RE = /^[A-Za-z0-9_.-]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const DISPLAY_NAME_MAX = 50;
const FIELD_LABEL = { username: '账号', password: '密码', display_name: '显示名' };

/* ---------------- 本地存储 ---------------- */

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 隐私模式下忽略 */ }
}

function removeStorage(key) {
  try { localStorage.removeItem(key); } catch { /* 忽略 */ }
}

/* ---------------- 登录态 ---------------- */

const auth = {
  token: '',
  user: null,
  // checking：正在确认登录态；ready：已登录；anonymous：未登录；unavailable：后端还没有用户接口
  mode: 'checking',
};

function readSession() {
  const raw = readStorage(SESSION_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

function saveSession() {
  if (!auth.token) return;
  writeStorage(SESSION_KEY, JSON.stringify({ token: auth.token, user: auth.user }));
}

function clearSession() {
  auth.token = '';
  auth.user = null;
  removeStorage(SESSION_KEY);
}

/* ---------------- 接口地址 ---------------- */

function resolveApiBase() {
  const override = new URLSearchParams(location.search).get('api');
  if (override) writeStorage('ttb.apiBase', override);

  const saved = readStorage('ttb.apiBase');
  if (saved) return saved.replace(/\/+$/, '');

  // 本地直接打开 / 本地静态服务时，连测试服；部署到后端同域时走相对路径。
  if (location.protocol === 'file:') return TEST_API;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return TEST_API;
  return '';
}

const API = {
  base: resolveApiBase(),

  async request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

    const init = { ...options, headers, signal: controller.signal };
    delete init.skipAuthRedirect;

    let res;
    try {
      res = await fetch(this.base + path, init);
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? '请求超时，请稍后重试' : '连不上接口，请确认后端服务在线');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return null;

    const text = await res.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = null; }
    }

    if (!res.ok) {
      const error = body && body.error ? body.error : {};
      const fields = error.fields || null;
      let message = error.message || `请求失败（HTTP ${res.status}）`;
      if (fields) message += '：' + Object.values(fields).join('；');
      const err = new Error(message);
      err.status = res.status;
      err.fields = fields;
      // 登录态失效：清掉本地会话，回到登录页
      if ((res.status === 401 || res.status === 403) && auth.token && !options.skipAuthRedirect) {
        expireSession('登录已过期，请重新登录');
      }
      throw err;
    }

    return body;
  },

  /* ---- 任务 ---- */

  list() {
    return this.request('/api/tasks');
  },

  create(payload) {
    return this.request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
  },

  update(id, payload) {
    return this.request(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /* ---- 用户 ---- */

  me(options = {}) {
    return this.request('/api/auth/me', { ...options, skipAuthRedirect: true });
  },

  login(payload) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuthRedirect: true,
    });
  },

  register(payload) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuthRedirect: true,
    });
  },

  logout() {
    return this.request('/api/auth/logout', { method: 'POST', skipAuthRedirect: true });
  },
};

/* ---------------- 登录取值（兼容常见字段名） ---------------- */

function unwrap(body) {
  if (!body || typeof body !== 'object') return null;
  return body.data && typeof body.data === 'object' ? body.data : body;
}

function pickToken(body) {
  const data = unwrap(body) || {};
  const root = body && typeof body === 'object' ? body : {};
  return data.token || data.access_token || data.accessToken || root.token || root.access_token || '';
}

function pickUser(body) {
  const data = unwrap(body);
  if (!data) return null;
  const raw = data.user && typeof data.user === 'object' ? data.user : data;
  const username = String(raw.username || raw.account || raw.name || '').trim();
  const displayName = String(raw.display_name || raw.displayName || raw.nickname || username).trim();
  if (!username && !displayName) return null;
  return {
    id: raw.id ?? null,
    username: username || displayName,
    displayName: displayName || username,
    role: raw.role || 'member',
  };
}

/* ---------------- 状态 ---------------- */

const state = {
  tasks: [],
  filter: 'all',
  query: '',
  loading: true,
  busy: new Set(),
};

let focusTarget = null;
let flashId = null;
let authMode = 'login';

/* ---------------- DOM ---------------- */

const els = {
  auth: document.getElementById('auth'),
  authForm: document.getElementById('auth-form'),
  authTabs: Array.from(document.querySelectorAll('.auth-tab')),
  authTitle: document.getElementById('auth-title'),
  authSub: document.getElementById('auth-sub'),
  authFoot: document.getElementById('auth-foot'),
  authError: document.getElementById('auth-error'),
  authSubmit: document.getElementById('auth-submit'),
  displayField: document.getElementById('display-field'),
  fDisplay: document.getElementById('a-display'),
  fUsername: document.getElementById('a-username'),
  fPassword: document.getElementById('a-password'),

  app: document.getElementById('app'),
  today: document.getElementById('today'),
  summary: document.getElementById('summary'),
  userChip: document.getElementById('user-chip'),
  userAvatar: document.getElementById('user-avatar'),
  userName: document.getElementById('user-name'),
  logout: document.getElementById('logout'),
  notice: document.getElementById('auth-notice'),
  list: document.getElementById('list'),
  listHead: document.getElementById('list-head'),
  skeleton: document.getElementById('skeleton'),
  empty: document.getElementById('empty'),
  emptyTitle: document.querySelector('#empty .empty-title'),
  emptySub: document.querySelector('#empty .empty-sub'),
  error: document.getElementById('error'),
  errorSub: document.getElementById('error-sub'),
  retry: document.getElementById('retry'),
  refresh: document.getElementById('refresh'),
  newTask: document.getElementById('new-task'),
  search: document.getElementById('search'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  foot: document.querySelector('.foot'),
  footText: document.getElementById('foot-text'),
  dialog: document.getElementById('task-dialog'),
  form: document.getElementById('task-form'),
  fTitle: document.getElementById('f-title'),
  fAssignee: document.getElementById('f-assignee'),
  titleError: document.getElementById('title-error'),
  assigneeError: document.getElementById('assignee-error'),
  titleCounter: document.getElementById('title-counter'),
  assigneeCounter: document.getElementById('assignee-counter'),
  submit: document.getElementById('dialog-submit'),
  close: document.getElementById('dialog-close'),
  cancel: document.getElementById('dialog-cancel'),
  toasts: document.getElementById('toasts'),
  rowTemplate: document.getElementById('row-template'),
};

/* ---------------- 工具 ---------------- */

function avatarColor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function relativeTime(iso) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(time));
}

function fullTime(iso) {
  const time = new Date(iso);
  return Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(time)
    : '';
}

function todayLabel() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  return date;
}

function toast(message, kind = 'ok') {
  const node = document.createElement('div');
  node.className = 'toast' + (kind === 'error' ? ' error' : '');
  node.textContent = message;
  els.toasts.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }, kind === 'error' ? 4200 : 2600);
}

/* ---------------- 登录页 / 任务台 切换 ---------------- */

function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const isRegister = authMode === 'register';

  for (const tab of els.authTabs) {
    tab.setAttribute('aria-pressed', String(tab.dataset.mode === authMode));
  }
  els.authTitle.textContent = isRegister ? '注册' : '登录';
  els.authSub.textContent = isRegister
    ? '创建一个账号，之后用它登录看团队任务。'
    : '登录后查看团队任务、新建任务和推进状态。';
  els.authFoot.textContent = isRegister
    ? '已有账号？点上面的「登录」。'
    : '还没有账号？点上面的「注册」创建一个。';
  els.displayField.hidden = !isRegister;
  els.authSubmit.textContent = isRegister ? '注册' : '登录';
  els.fPassword.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
  els.fPassword.placeholder = isRegister ? `设置密码（至少 ${PASSWORD_MIN} 位）` : '密码';
  els.fPassword.value = '';
  setAuthError('');
}

function showAuth(message = '') {
  els.app.hidden = true;
  els.auth.hidden = false;
  els.logout.hidden = true;
  els.userChip.hidden = true;
  els.notice.hidden = true;
  setAuthError(message);
  setTimeout(() => els.fUsername.focus(), 0);
}

function renderUserChip() {
  if (auth.mode === 'ready' && auth.user) {
    const name = auth.user.displayName || auth.user.username || '已登录';
    els.userChip.hidden = false;
    els.userName.textContent = name;
    els.userName.title = auth.user.username ? `@${auth.user.username}` : name;
    els.userAvatar.textContent = name.trim().charAt(0) || '?';
    els.userAvatar.style.background = avatarColor(name);
    els.logout.hidden = false;
    els.notice.hidden = true;
  } else if (auth.mode === 'unavailable') {
    els.userChip.hidden = false;
    els.userName.textContent = '匿名访问';
    els.userName.title = '后端用户接口还没上线';
    els.userAvatar.textContent = '匿';
    els.userAvatar.style.background = '#8b8b81';
    els.logout.hidden = true;
    els.notice.hidden = false;
  } else {
    els.userChip.hidden = true;
    els.logout.hidden = true;
    els.notice.hidden = true;
  }
}

function showApp() {
  els.auth.hidden = true;
  els.app.hidden = false;
  renderUserChip();
  els.today.textContent = todayLabel();
  load();
}

function enterSession(body) {
  const token = pickToken(body);
  const user = pickUser(body);
  if (token) auth.token = token;
  if (user) auth.user = user;
  auth.mode = 'ready';
  saveSession();
}

function expireSession(message) {
  if (!auth.token) return;
  clearSession();
  auth.mode = 'anonymous';
  setAuthMode('login');
  showAuth(message);
}

function setAuthError(message) {
  if (message) {
    els.authError.textContent = message;
    els.authError.hidden = false;
  } else {
    els.authError.textContent = '';
    els.authError.hidden = true;
  }
}

/* ---------------- 启动：确认登录态 ---------------- */

async function bootstrap() {
  const saved = readSession();
  if (saved) {
    auth.token = saved.token || '';
    auth.user = pickUser(saved.user) || (saved.user || null);
  }

  try {
    const body = await API.me();
    const user = pickUser(body) || auth.user;
    if (!user) throw Object.assign(new Error('登录态无效'), { status: 401 });
    auth.user = user;
    auth.mode = 'ready';
    saveSession();
    showApp();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      const hadSession = Boolean(auth.token || saved);
      clearSession();
      auth.mode = 'anonymous';
      setAuthMode('login');
      showAuth(hadSession ? '登录已过期，请重新登录。' : '');
      return;
    }
    if (err.status === 404 || err.status === 405 || err.status === 501) {
      // 后端用户接口还没上线：先匿名浏览，接口发布后刷新即要求登录。
      auth.mode = 'unavailable';
      showApp();
      return;
    }
    // 网络或服务异常：留在登录页并说明原因
    auth.mode = 'anonymous';
    setAuthMode('login');
    showAuth(err.message || '连不上登录接口，请确认后端服务在线。');
  }
}

/* ---------------- 登录 / 注册 / 退出 ---------------- */

async function submitAuth(event) {
  event.preventDefault();

  const isRegister = authMode === 'register';
  const username = els.fUsername.value.trim();
  const password = els.fPassword.value;
  const displayName = els.fDisplay.value.trim();

  setAuthError('');
  if (!username) return setAuthError('请输入账号。');
  if (isRegister) {
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      return setAuthError(`账号需要 ${USERNAME_MIN}–${USERNAME_MAX} 个字符。`);
    }
    if (!USERNAME_RE.test(username)) {
      return setAuthError('账号只能包含字母、数字、点、短横线和下划线。');
    }
  }
  if (!password) return setAuthError(isRegister ? '请设置密码。' : '请输入密码。');
  if (isRegister && password.length < PASSWORD_MIN) {
    return setAuthError(`密码至少 ${PASSWORD_MIN} 位。`);
  }
  if (password.length > PASSWORD_MAX) return setAuthError(`密码最多 ${PASSWORD_MAX} 个字符。`);
  if (displayName.length > DISPLAY_NAME_MAX) return setAuthError(`显示名最多 ${DISPLAY_NAME_MAX} 个字符。`);

  els.authSubmit.disabled = true;
  els.authSubmit.textContent = isRegister ? '注册中…' : '登录中…';

  try {
    if (isRegister) {
      const body = await API.register({ username, password, display_name: displayName || username });
      const token = pickToken(body);
      if (token) {
        enterSession(body);
        els.authForm.reset();
        showApp();
        toast('账号已创建，已自动登录');
      } else {
        setAuthMode('login');
        els.fUsername.value = username;
        els.fPassword.value = '';
        setAuthError('注册成功，请用刚才的账号登录。');
        toast('注册成功');
      }
      return;
    }

    const body = await API.login({ username, password });
    const token = pickToken(body);
    if (!token) throw new Error('登录接口没有返回 token，等后端确认字段后再试。');
    enterSession(body);
    els.authForm.reset();
    showApp();
    toast('已登录');
  } catch (err) {
    setAuthError(authErrorMessage(err, isRegister));
  } finally {
    els.authSubmit.disabled = false;
    els.authSubmit.textContent = isRegister ? '注册' : '登录';
  }
}

async function logout() {
  els.logout.disabled = true;
  try {
    await API.logout();
  } catch {
    /* 后端没提供退出接口时也照样清本地登录态 */
  } finally {
    els.logout.disabled = false;
    const wasReady = auth.mode === 'ready';
    clearSession();
    auth.mode = 'anonymous';
    state.tasks = [];
    setAuthMode('login');
    showAuth(wasReady ? '已退出登录。' : '');
    toast('已退出登录');
  }
}

/* ---------------- 登录错误文案 ---------------- */

function translateFieldMessage(message) {
  const text = String(message || '');
  if (text === 'is required' || text === 'must not be empty') return '不能为空';
  if (text === 'is already taken') return '已经被注册了';
  if (text === 'must be a string') return '格式不对';
  if (text.startsWith('may only contain')) return '只能包含字母、数字、点、短横线和下划线';
  let match = text.match(/^must be at least (\d+) characters$/);
  if (match) return `至少 ${match[1]} 个字符`;
  match = text.match(/^must be at most (\d+) characters$/);
  if (match) return `最多 ${match[1]} 个字符`;
  return text;
}

function authErrorMessage(err, isRegister) {
  if (err.status === 401) return isRegister ? '注册失败，请检查账号和密码。' : '账号或密码不对。';
  if (err.status === 409) return '这个账号已经被注册了，换一个或直接登录。';
  const fields = err.fields || {};
  const keys = Object.keys(fields);
  if (keys.length) {
    return keys.map((key) => `${FIELD_LABEL[key] || key}${translateFieldMessage(fields[key])}`).join('；') + '。';
  }
  return err.message || (isRegister ? '注册失败' : '登录失败');
}

/* ---------------- 渲染 ---------------- */

function countByStatus(tasks) {
  const counts = { all: tasks.length, todo: 0, doing: 0, done: 0 };
  for (const task of tasks) {
    if (counts[task.status] !== undefined) counts[task.status] += 1;
  }
  return counts;
}

function visibleTasks() {
  const query = state.query.trim().toLowerCase();
  return state.tasks.filter((task) => {
    if (state.filter !== 'all' && task.status !== state.filter) return false;
    if (!query) return true;
    return (
      String(task.title).toLowerCase().includes(query) ||
      String(task.assignee).toLowerCase().includes(query)
    );
  });
}

function buildRow(task) {
  const node = els.rowTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = String(task.id);
  node.dataset.status = task.status;

  node.querySelector('.task-title').textContent = task.title;
  node.querySelector('.task-meta').textContent = `更新于 ${relativeTime(task.updated_at)}`;
  node.querySelector('.task-meta').title = fullTime(task.updated_at);

  const avatar = node.querySelector('.avatar');
  avatar.textContent = String(task.assignee).trim().charAt(0) || '?';
  avatar.style.background = avatarColor(String(task.assignee));
  node.querySelector('.assignee-name').textContent = task.assignee;
  node.querySelector('.assignee-name').title = task.assignee;

  const priority = node.querySelector('.priority');
  priority.dataset.priority = task.priority;
  priority.textContent = PRIORITY_LABEL[task.priority] || task.priority;

  const statusChip = node.querySelector('.chip.status');
  const next = NEXT_STATUS[task.status];
  statusChip.dataset.status = task.status;
  statusChip.querySelector('.status-label').textContent = STATUS_LABEL[task.status] || task.status;
  statusChip.dataset.focus = `status:${task.id}`;
  statusChip.disabled = !next;
  statusChip.title = next ? `改为「${STATUS_LABEL[next]}」` : '已完成';
  statusChip.setAttribute(
    'aria-label',
    next ? `「${task.title}」当前${STATUS_LABEL[task.status]}，改为${STATUS_LABEL[next]}` : `「${task.title}」已完成`
  );

  const revert = node.querySelector('.revert');
  const prev = PREV_STATUS[task.status];
  revert.hidden = !prev;
  revert.dataset.focus = `revert:${task.id}`;
  revert.setAttribute('aria-label', `把「${task.title}」退回`);

  if (state.busy.has(task.id)) {
    node.classList.add('is-busy');
    statusChip.disabled = true;
    revert.disabled = true;
  }

  return node;
}

function render() {
  const counts = countByStatus(state.tasks);

  for (const tab of els.tabs) {
    const key = tab.dataset.status;
    tab.setAttribute('aria-pressed', String(key === state.filter));
    const badge = tab.querySelector('.tab-count');
    if (badge) badge.textContent = String(counts[key] ?? 0);
  }

  const visible = visibleTasks();
  const fragment = document.createDocumentFragment();
  for (const task of visible) fragment.appendChild(buildRow(task));
  els.list.replaceChildren(fragment);

  if (flashId !== null) {
    const row = els.list.querySelector(`[data-id="${flashId}"]`);
    if (row) {
      row.classList.add('is-new');
      setTimeout(() => row.classList.remove('is-new'), 700);
    }
    flashId = null;
  }

  els.skeleton.hidden = !state.loading;
  els.error.hidden = true;

  const hasAny = state.tasks.length > 0;
  const isEmpty = !state.loading && visible.length === 0;
  els.empty.hidden = !isEmpty;
  els.list.hidden = state.loading || isEmpty;
  els.listHead.hidden = state.loading || isEmpty;

  if (isEmpty) {
    if (!hasAny) {
      els.emptyTitle.textContent = '这里还没有任务';
      els.emptySub.textContent = '点右上角「新建任务」，把今天要做的事记下来。';
    } else {
      els.emptyTitle.textContent = '没有符合条件的任务';
      els.emptySub.textContent = '换个筛选条件，或者清空搜索试试。';
    }
  }

  if (hasAny) {
    const doing = counts.doing;
    els.summary.textContent = `共 ${counts.all} 条任务 · 待办 ${counts.todo} · 进行中 ${doing} · 完成 ${counts.done}`;
  } else if (!state.loading) {
    els.summary.textContent = '看今天有哪些事、谁在做、做到哪了。';
  }

  els.foot.classList.remove('is-off');
  const origin = API.base || location.origin;
  const who = auth.mode === 'ready' && auth.user ? ` · ${auth.user.displayName || auth.user.username}` : '';
  els.footText.textContent = `接口 ${origin}${who} · 更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

  if (focusTarget) {
    const target = document.querySelector(`[data-focus="${focusTarget}"]`);
    if (target && !target.hidden && !target.disabled) target.focus();
    focusTarget = null;
  }
}

function renderError(message) {
  state.loading = false;
  els.skeleton.hidden = true;
  els.list.hidden = true;
  els.listHead.hidden = true;
  els.empty.hidden = true;
  els.error.hidden = false;
  els.errorSub.textContent = message;
  els.foot.classList.add('is-off');
  els.footText.textContent = '接口未连接';
  for (const tab of els.tabs) tab.querySelector('.tab-count').textContent = '0';
}

/* ---------------- 数据 ---------------- */

async function load() {
  if (auth.mode !== 'ready' && auth.mode !== 'unavailable') return;

  state.loading = true;
  els.refresh.disabled = true;
  els.error.hidden = true;
  els.skeleton.hidden = false;
  els.list.hidden = true;
  els.listHead.hidden = true;
  els.empty.hidden = true;

  try {
    const data = await API.list();
    state.tasks = Array.isArray(data && data.items) ? data.items : [];
    state.loading = false;
    render();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return; // 已回到登录页
    renderError(err.message || '加载失败');
  } finally {
    state.loading = false;
    els.refresh.disabled = false;
  }
}

async function changeStatus(task, next) {
  if (!next || state.busy.has(task.id)) return;
  const previous = task.status;

  task.status = next;
  state.busy.add(task.id);
  focusTarget = `status:${task.id}`;
  render();

  try {
    const updated = await API.update(task.id, { status: next });
    if (updated && typeof updated === 'object') Object.assign(task, updated);
  } catch (err) {
    task.status = previous;
    if (err.status !== 401 && err.status !== 403) toast(err.message || '状态更新失败', 'error');
  } finally {
    state.busy.delete(task.id);
    render();
  }
}

/* ---------------- 新建任务 ---------------- */

function setFieldError(input, errorNode, message) {
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (message) {
    errorNode.textContent = message;
    errorNode.hidden = false;
  } else {
    errorNode.hidden = true;
    errorNode.textContent = '';
  }
}

function resetDialog() {
  els.form.reset();
  els.fTitle.value = '';
  els.fAssignee.value = '';
  // 负责人默认填自己，改成别人也可以
  if (auth.mode === 'ready' && auth.user) {
    els.fAssignee.value = auth.user.displayName || auth.user.username || '';
  }
  const medium = els.form.querySelector('input[name="priority"][value="medium"]');
  if (medium) medium.checked = true;
  setFieldError(els.fTitle, els.titleError, '');
  setFieldError(els.fAssignee, els.assigneeError, '');
  updateCounter(els.fTitle, els.titleCounter, 200);
  updateCounter(els.fAssignee, els.assigneeCounter, 50);
  els.submit.disabled = false;
  els.submit.textContent = '新建任务';
}

function openDialog() {
  resetDialog();
  if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
  else els.dialog.setAttribute('open', '');
  els.fTitle.focus();
}

function closeDialog() {
  if (typeof els.dialog.close === 'function') els.dialog.close();
  else els.dialog.removeAttribute('open');
}

function updateCounter(input, counter, max) {
  counter.textContent = `${input.value.length}/${max}`;
}

async function submitCreate(event) {
  event.preventDefault();

  const title = els.fTitle.value.trim();
  const assignee = els.fAssignee.value.trim();
  const priority = els.form.querySelector('input[name="priority"]:checked')?.value || 'medium';

  let valid = true;
  if (!title) {
    setFieldError(els.fTitle, els.titleError, '标题不能为空');
    valid = false;
  } else if (title.length > 200) {
    setFieldError(els.fTitle, els.titleError, '标题最多 200 字');
    valid = false;
  } else {
    setFieldError(els.fTitle, els.titleError, '');
  }

  if (!assignee) {
    setFieldError(els.fAssignee, els.assigneeError, '负责人不能为空');
    valid = false;
  } else if (assignee.length > 50) {
    setFieldError(els.fAssignee, els.assigneeError, '负责人最多 50 字');
    valid = false;
  } else {
    setFieldError(els.fAssignee, els.assigneeError, '');
  }

  if (!valid) {
    (title ? els.fAssignee : els.fTitle).focus();
    return;
  }

  els.submit.disabled = true;
  els.submit.textContent = '创建中…';

  try {
    const task = await API.create({ title, assignee, priority });
    state.tasks.unshift(task);
    state.filter = 'all';
    state.query = '';
    els.search.value = '';
    flashId = task.id;
    closeDialog();
    render();
    toast('任务已创建');
  } catch (err) {
    if (err.status === 401 || err.status === 403) return; // 已回到登录页
    const fields = err.fields || {};
    if (fields.title) setFieldError(els.fTitle, els.titleError, fields.title);
    if (fields.assignee) setFieldError(els.fAssignee, els.assigneeError, fields.assignee);
    if (!fields.title && !fields.assignee) toast(err.message || '创建失败', 'error');
    else toast('请检查填写内容', 'error');
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = '新建任务';
  }
}

/* ---------------- 事件 ---------------- */

function bindEvents() {
  els.authForm.addEventListener('submit', submitAuth);

  for (const tab of els.authTabs) {
    tab.addEventListener('click', () => {
      setAuthMode(tab.dataset.mode);
      els.fUsername.focus();
    });
  }

  els.logout.addEventListener('click', logout);

  els.newTask.addEventListener('click', openDialog);
  els.close.addEventListener('click', closeDialog);
  els.cancel.addEventListener('click', closeDialog);
  els.form.addEventListener('submit', submitCreate);
  els.refresh.addEventListener('click', load);
  els.retry.addEventListener('click', load);

  els.dialog.addEventListener('click', (event) => {
    if (event.target === els.dialog) closeDialog();
  });

  els.fTitle.addEventListener('input', () => {
    updateCounter(els.fTitle, els.titleCounter, 200);
    if (els.fTitle.getAttribute('aria-invalid') === 'true') setFieldError(els.fTitle, els.titleError, '');
  });

  els.fAssignee.addEventListener('input', () => {
    updateCounter(els.fAssignee, els.assigneeCounter, 50);
    if (els.fAssignee.getAttribute('aria-invalid') === 'true') setFieldError(els.fAssignee, els.assigneeError, '');
  });

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    render();
  });

  for (const tab of els.tabs) {
    tab.addEventListener('click', () => {
      state.filter = tab.dataset.status;
      render();
    });
  }

  els.list.addEventListener('click', (event) => {
    const row = event.target.closest('.row');
    if (!row) return;
    const task = state.tasks.find((item) => String(item.id) === row.dataset.id);
    if (!task) return;

    if (event.target.closest('.chip.status')) {
      changeStatus(task, NEXT_STATUS[task.status]);
    } else if (event.target.closest('.revert')) {
      changeStatus(task, PREV_STATUS[task.status]);
    }
  });
}

/* ---------------- 启动 ---------------- */

function init() {
  els.today.textContent = todayLabel();
  setAuthMode('login');
  bindEvents();
  bootstrap();
}

init();
