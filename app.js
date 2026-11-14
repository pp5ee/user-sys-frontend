'use strict';

/* ------------------------------------------------------------------ *
 * 团队任务台 — 前端
 * 任务：GET /api/tasks（支持 ?q= 搜索）· POST /api/tasks
 *       PATCH /api/tasks/{id}（标题 / 负责人 / 优先级 / 状态）
 *       DELETE /api/tasks/{id}
 *       GET /api/tasks/{id}/comments · POST /api/tasks/{id}/comments
 * 用户：GET /api/users
 *       POST /api/auth/register · POST /api/auth/login
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
const TASK_TITLE_MAX = 200;
const ASSIGNEE_MAX = 50;
const COMMENT_MAX = 1000;
const SEARCH_DEBOUNCE = 260;
const FIELD_LABEL = { username: '账号', password: '密码', display_name: '显示名', title: '标题', assignee: '负责人' };

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

  list(params = {}) {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    const suffix = query.toString();
    return this.request('/api/tasks' + (suffix ? `?${suffix}` : ''));
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

  remove(id) {
    return this.request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* ---- 协作用户 ---- */

  users() {
    return this.request('/api/users', { skipAuthRedirect: true });
  },

  comments(taskId) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/comments`);
  },

  addComment(taskId, content) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
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

function myLabel() {
  if (!auth.user) return '';
  return String(auth.user.displayName || auth.user.username || '').trim();
}

/* ---------------- 状态 ---------------- */

const state = {
  tasks: [],
  filter: 'all',
  query: '',
  mine: false,
  loading: true,
  busy: new Set(),
  loadSeq: 0,
  searchTimer: 0,
  users: [],
  usersLoaded: false,
  usersSignature: '',
  detailId: null,
  detailSnapshot: null,
  savingDetail: false,
  deleteArmed: false,
  deleteTimer: 0,
  comments: { taskId: null, status: 'idle', items: [] },
  deepLinkChecked: false,
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
  searchBox: document.getElementById('search-box'),
  searchClear: document.getElementById('search-clear'),
  searchKbd: document.getElementById('search-kbd'),
  mineFilter: document.getElementById('mine-filter'),
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

  dialogDetail: document.getElementById('detail-dialog'),
  detailForm: document.getElementById('detail-form'),
  detailEyebrow: document.getElementById('detail-eyebrow'),
  detailHeading: document.getElementById('detail-heading'),
  dTitle: document.getElementById('d-title'),
  dTitleCounter: document.getElementById('d-title-counter'),
  dTitleError: document.getElementById('d-title-error'),
  dAssignee: document.getElementById('d-assignee'),
  dAssigneeError: document.getElementById('d-assignee-error'),
  assignMe: document.getElementById('assign-me'),
  detailMeta: document.getElementById('detail-meta'),
  detailCopy: document.getElementById('detail-copy'),
  detailDelete: document.getElementById('detail-delete'),
  detailSave: document.getElementById('detail-save'),
  detailClose: document.getElementById('detail-close'),
  detailCancel: document.getElementById('detail-cancel'),
  commentList: document.getElementById('comment-list'),
  commentCount: document.getElementById('comment-count'),
  commentEmpty: document.getElementById('comment-empty'),
  commentBlocked: document.getElementById('comment-blocked'),
  commentLogin: document.getElementById('comment-login'),
  commentCompose: document.getElementById('comment-compose'),
  commentInput: document.getElementById('comment-input'),
  commentLimit: document.getElementById('comment-limit'),
  commentSend: document.getElementById('comment-send'),
  assigneeOptions: document.getElementById('assignee-options'),

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

function taskMatchesMine(task) {
  const me = myLabel();
  if (!me) return false;
  const assignee = String(task.assignee || '').trim();
  if (!assignee) return false;
  if (assignee === me) return true;
  return Boolean(auth.user && auth.user.username && assignee === auth.user.username);
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
  closeDetail();
  closeDialog();
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
    els.mineFilter.hidden = false;
    els.assignMe.hidden = false;
  } else if (auth.mode === 'unavailable') {
    els.userChip.hidden = false;
    els.userName.textContent = '匿名访问';
    els.userName.title = '后端用户接口还没上线';
    els.userAvatar.textContent = '匿';
    els.userAvatar.style.background = '#8b8b81';
    els.logout.hidden = true;
    els.notice.hidden = false;
    els.mineFilter.hidden = true;
    els.assignMe.hidden = true;
    state.mine = false;
  } else {
    els.userChip.hidden = true;
    els.logout.hidden = true;
    els.notice.hidden = true;
    els.mineFilter.hidden = true;
    els.assignMe.hidden = true;
    state.mine = false;
  }
  els.mineFilter.setAttribute('aria-pressed', String(state.mine));
}

function showApp() {
  els.auth.hidden = true;
  els.app.hidden = false;
  renderUserChip();
  els.today.textContent = todayLabel();
  load();
  ensureUsers();
}

function enterSession(body) {
  const token = pickToken(body);
  const user = pickUser(body);
  if (token) auth.token = token;
  if (user) auth.user = user;
  auth.mode = 'ready';
  saveSession();
  renderUserChip();
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
    state.query = '';
    state.mine = false;
    state.users = [];
    state.usersLoaded = false;
    els.search.value = '';
    updateSearchChrome();
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
    if (state.mine && !taskMatchesMine(task)) return false;
    if (!query) return true;
    return (
      String(task.title || '').toLowerCase().includes(query) ||
      String(task.assignee || '').toLowerCase().includes(query) ||
      String(task.creator || '').toLowerCase().includes(query)
    );
  });
}

function buildRow(task) {
  const node = els.rowTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = String(task.id);
  node.dataset.status = task.status;

  const open = node.querySelector('.task-open');
  open.textContent = task.title;
  open.dataset.focus = `open:${task.id}`;
  open.title = '打开任务详情';
  open.setAttribute('aria-label', `打开任务「${task.title}」`);

  const meta = [];
  meta.push(`#${task.id}`);
  if (task.creator) meta.push(`创建人 ${task.creator}`);
  if (task.updated_at) meta.push(`更新于 ${relativeTime(task.updated_at)}`);
  const metaNode = node.querySelector('.task-meta');
  metaNode.textContent = meta.join(' · ');
  metaNode.title = task.updated_at ? fullTime(task.updated_at) : '';

  const avatar = node.querySelector('.avatar');
  avatar.textContent = String(task.assignee || '?').trim().charAt(0) || '?';
  avatar.style.background = avatarColor(String(task.assignee || ''));
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

  const edit = node.querySelector('.edit-btn');
  edit.dataset.focus = `edit:${task.id}`;
  edit.setAttribute('aria-label', `编辑「${task.title}」`);

  if (state.busy.has(task.id)) {
    node.classList.add('is-busy');
    statusChip.disabled = true;
    revert.disabled = true;
    edit.disabled = true;
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

  els.mineFilter.setAttribute('aria-pressed', String(state.mine));

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
    } else if (state.mine) {
      els.emptyTitle.textContent = '没有分给你的任务';
      els.emptySub.textContent = '新建任务时把负责人填成自己，或者等同事指派给你。';
    } else {
      els.emptyTitle.textContent = '没有符合条件的任务';
      els.emptySub.textContent = '换个筛选条件，或者清空搜索试试。';
    }
  }

  const query = state.query.trim();
  if (query) {
    els.summary.textContent = `搜索「${query}」匹配 ${visible.length} 条任务`;
  } else if (hasAny) {
    els.summary.textContent = `共 ${counts.all} 条任务 · 待办 ${counts.todo} · 进行中 ${counts.doing} · 完成 ${counts.done}`;
  } else if (!state.loading) {
    els.summary.textContent = '看今天有哪些事、谁在做、做到哪了。';
  }

  els.foot.classList.remove('is-off');
  const origin = API.base || location.origin;
  const who = auth.mode === 'ready' && auth.user ? ` · ${auth.user.displayName || auth.user.username}` : '';
  els.footText.textContent = `接口 ${origin}${who} · 更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

  renderAssigneeOptions();

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

/* ---------------- 团队成员 / 负责人候选 ---------------- */

function extractItems(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && body.data) return extractItems(body.data);
  return [];
}

async function ensureUsers(force = false) {
  if (auth.mode !== 'ready') return;
  if (state.usersLoaded && !force) return;
  try {
    const data = await API.users();
    state.users = extractItems(data)
      .map((user) => ({
        ...user,
        label: String(user.display_name || user.displayName || user.username || '').trim(),
      }))
      .filter((user) => user.label);
  } catch {
    state.users = [];
  } finally {
    state.usersLoaded = true;
    renderAssigneeOptions();
  }
}

function renderAssigneeOptions() {
  if (!els.assigneeOptions) return;
  const names = new Set();
  for (const user of state.users) names.add(user.label);
  for (const task of state.tasks) {
    if (task.assignee) names.add(String(task.assignee).trim());
  }
  const me = myLabel();
  if (me) names.add(me);

  const list = [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const signature = list.join('\u0001');
  if (signature === state.usersSignature) return;
  state.usersSignature = signature;

  const fragment = document.createDocumentFragment();
  for (const name of list) {
    const option = document.createElement('option');
    option.value = name;
    fragment.appendChild(option);
  }
  els.assigneeOptions.replaceChildren(fragment);
}

/* ---------------- 数据 ---------------- */

async function load({ quiet = false } = {}) {
  if (auth.mode !== 'ready' && auth.mode !== 'unavailable') return;

  const query = state.query.trim();
  const seq = ++state.loadSeq;
  state.loading = !quiet;

  if (!quiet) {
    els.refresh.disabled = true;
    els.error.hidden = true;
    els.skeleton.hidden = false;
    els.list.hidden = true;
    els.listHead.hidden = true;
    els.empty.hidden = true;
  }

  try {
    const data = await API.list(query ? { q: query } : {});
    if (seq !== state.loadSeq) return;
    if (query !== state.query.trim()) return; // 输入已经变了，等新的结果
    state.tasks = extractItems(data);
    state.loading = false;
    render();
    openDeepLink();
  } catch (err) {
    if (seq !== state.loadSeq) return;
    if (err.status === 401 || err.status === 403) return; // 已回到登录页
    if (quiet) {
      // 搜索请求失败时保留现有数据，本地过滤仍然生效。
      state.loading = false;
      render();
      return;
    }
    renderError(err.message || '加载失败');
  } finally {
    if (seq === state.loadSeq) {
      state.loading = false;
      els.refresh.disabled = false;
    }
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

/* ---------------- 搜索 / 我负责的 ---------------- */

function updateSearchChrome() {
  const has = els.search.value.length > 0;
  els.searchClear.hidden = !has;
  els.searchKbd.hidden = has || document.activeElement === els.search;
}

function applySearch() {
  state.query = els.search.value;
  updateSearchChrome();
  render();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => load({ quiet: true }), SEARCH_DEBOUNCE);
}

function clearSearch() {
  els.search.value = '';
  state.query = '';
  updateSearchChrome();
  render();
  clearTimeout(state.searchTimer);
  load({ quiet: true });
  els.search.focus();
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
  const me = myLabel();
  if (me) els.fAssignee.value = me;
  const medium = els.form.querySelector('input[name="priority"][value="medium"]');
  if (medium) medium.checked = true;
  setFieldError(els.fTitle, els.titleError, '');
  setFieldError(els.fAssignee, els.assigneeError, '');
  updateCounter(els.fTitle, els.titleCounter, TASK_TITLE_MAX);
  updateCounter(els.fAssignee, els.assigneeCounter, ASSIGNEE_MAX);
  els.submit.disabled = false;
  els.submit.textContent = '新建任务';
}

function openDialog() {
  resetDialog();
  ensureUsers();
  if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
  else els.dialog.setAttribute('open', '');
  els.fTitle.focus();
}

function closeDialog() {
  if (!els.dialog) return;
  if (typeof els.dialog.close === 'function' && els.dialog.open) els.dialog.close();
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
  } else if (title.length > TASK_TITLE_MAX) {
    setFieldError(els.fTitle, els.titleError, `标题最多 ${TASK_TITLE_MAX} 字`);
    valid = false;
  } else {
    setFieldError(els.fTitle, els.titleError, '');
  }

  if (!assignee) {
    setFieldError(els.fAssignee, els.assigneeError, '负责人不能为空');
    valid = false;
  } else if (assignee.length > ASSIGNEE_MAX) {
    setFieldError(els.fAssignee, els.assigneeError, `负责人最多 ${ASSIGNEE_MAX} 字`);
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
    const wasFiltered = Boolean(state.query.trim()) || state.mine;
    state.tasks.unshift(task);
    state.filter = 'all';
    state.query = '';
    state.mine = false;
    els.search.value = '';
    updateSearchChrome();
    flashId = task.id;
    closeDialog();
    render();
    renderUserChip();
    toast('任务已创建');
    if (wasFiltered) load({ quiet: true });
  } catch (err) {
    if (err.status === 401 || err.status === 403) return; // 已回到登录页
    const fields = err.fields || {};
    if (fields.title) setFieldError(els.fTitle, els.titleError, translateFieldMessage(fields.title));
    if (fields.assignee) setFieldError(els.fAssignee, els.assigneeError, translateFieldMessage(fields.assignee));
    if (!fields.title && !fields.assignee) toast(err.message || '创建失败', 'error');
    else toast('请检查填写内容', 'error');
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = '新建任务';
  }
}

/* ---------------- 任务详情：编辑 / 指派 / 删除 ---------------- */

function currentDetailTask() {
  if (state.detailId === null) return null;
  return state.tasks.find((task) => String(task.id) === String(state.detailId)) || null;
}

function checkRadio(name, value) {
  const input = els.detailForm.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function radioValue(name) {
  return els.detailForm.querySelector(`input[name="${name}"]:checked`)?.value || '';
}

function canDelete(task) {
  if (auth.mode !== 'ready' || !auth.user) return false;
  if (auth.user.role === 'admin') return true;
  if (task.created_by === null || task.created_by === undefined) return false;
  return String(task.created_by) === String(auth.user.id);
}

function syncHash(id) {
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}#task-${id}`);
  } catch { /* file:// 下个别浏览器不让改 */ }
}

function clearHash() {
  if (!location.hash) return;
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* 忽略 */ }
}

function openDeepLink() {
  if (state.deepLinkChecked) return;
  state.deepLinkChecked = true;
  const match = location.hash.match(/^#task-(\d+)$/);
  if (!match) return;
  const task = state.tasks.find((item) => String(item.id) === match[1]);
  if (task) openDetail(task, { focus: false });
}

function resetDeleteConfirm() {
  clearTimeout(state.deleteTimer);
  state.deleteArmed = false;
  if (!els.detailDelete) return;
  els.detailDelete.textContent = '删除任务';
  els.detailDelete.classList.remove('is-armed');
}

function resetComments() {
  state.comments = { taskId: null, status: 'idle', items: [] };
  els.commentList.replaceChildren();
  els.commentCount.textContent = '';
  els.commentEmpty.hidden = true;
  els.commentBlocked.hidden = true;
  els.commentLogin.hidden = true;
  els.commentCompose.hidden = true;
  els.commentInput.value = '';
  els.commentLimit.textContent = `0/${COMMENT_MAX}`;
  els.commentSend.disabled = false;
  els.commentSend.textContent = '发送';
}

function openDetail(task, options = {}) {
  if (!task) return;
  state.detailId = task.id;
  state.detailSnapshot = {
    title: task.title,
    assignee: task.assignee,
    priority: task.priority,
    status: task.status,
  };

  els.detailEyebrow.textContent = `任务 #${task.id}`;
  els.detailHeading.textContent = task.title || '任务详情';
  els.dTitle.value = task.title || '';
  els.dAssignee.value = task.assignee || '';
  checkRadio('d-priority', task.priority || 'medium');
  checkRadio('d-status', task.status || 'todo');
  updateCounter(els.dTitle, els.dTitleCounter, TASK_TITLE_MAX);
  setFieldError(els.dTitle, els.dTitleError, '');
  setFieldError(els.dAssignee, els.dAssigneeError, '');
  els.detailSave.disabled = false;
  els.detailSave.textContent = '保存';

  const creator = task.creator ? `由 ${task.creator} 创建` : '创建人未知';
  const updated = task.updated_at ? `更新于 ${relativeTime(task.updated_at)}` : '';
  els.detailMeta.textContent = [creator, updated].filter(Boolean).join(' · ');
  els.detailMeta.title = task.updated_at ? fullTime(task.updated_at) : '';

  els.assignMe.hidden = !(auth.mode === 'ready' && auth.user);
  els.detailDelete.hidden = !canDelete(task);
  resetDeleteConfirm();

  resetComments();
  if (typeof els.dialogDetail.showModal === 'function') els.dialogDetail.showModal();
  else els.dialogDetail.setAttribute('open', '');
  els.dialogDetail.classList.add('is-open');
  syncHash(task.id);

  loadComments(task);
  ensureUsers();

  if (options.focus !== false) setTimeout(() => els.dTitle.focus(), 0);
}

function closeDetail() {
  if (!els.dialogDetail) return;
  resetDeleteConfirm();
  state.detailId = null;
  state.detailSnapshot = null;
  state.comments = { taskId: null, status: 'idle', items: [] };
  els.dialogDetail.classList.remove('is-open');
  if (typeof els.dialogDetail.close === 'function' && els.dialogDetail.open) els.dialogDetail.close();
  else els.dialogDetail.removeAttribute('open');
  clearHash();
}

function validateDetail() {
  const title = els.dTitle.value.trim();
  const assignee = els.dAssignee.value.trim();
  let valid = true;

  if (!title) {
    setFieldError(els.dTitle, els.dTitleError, '标题不能为空');
    valid = false;
  } else if (title.length > TASK_TITLE_MAX) {
    setFieldError(els.dTitle, els.dTitleError, `标题最多 ${TASK_TITLE_MAX} 字`);
    valid = false;
  } else {
    setFieldError(els.dTitle, els.dTitleError, '');
  }

  if (!assignee) {
    setFieldError(els.dAssignee, els.dAssigneeError, '负责人不能为空');
    valid = false;
  } else if (assignee.length > ASSIGNEE_MAX) {
    setFieldError(els.dAssignee, els.dAssigneeError, `负责人最多 ${ASSIGNEE_MAX} 字`);
    valid = false;
  } else {
    setFieldError(els.dAssignee, els.dAssigneeError, '');
  }

  if (!valid) {
    (title ? els.dAssignee : els.dTitle).focus();
    return null;
  }
  return { title, assignee };
}

async function submitDetail(event) {
  event.preventDefault();
  if (state.savingDetail) return;

  const task = currentDetailTask();
  if (!task) {
    closeDetail();
    return;
  }

  const values = validateDetail();
  if (!values) return;

  const priority = radioValue('d-priority') || task.priority;
  const status = radioValue('d-status') || task.status;

  const payload = {};
  if (values.title !== task.title) payload.title = values.title;
  if (values.assignee !== task.assignee) payload.assignee = values.assignee;
  if (priority !== task.priority) payload.priority = priority;
  if (status !== task.status) payload.status = status;

  if (!Object.keys(payload).length) {
    closeDetail();
    toast('没有改动');
    return;
  }

  state.savingDetail = true;
  state.busy.add(task.id);
  els.detailSave.disabled = true;
  els.detailSave.textContent = '保存中…';

  try {
    const updated = await API.update(task.id, payload);
    if (updated && typeof updated === 'object') Object.assign(task, payload, updated);
    else Object.assign(task, payload);
    if (!task.updated_at) task.updated_at = new Date().toISOString();
    flashId = task.id;
    focusTarget = `open:${task.id}`;
    closeDetail();
    render();
    toast('任务已更新');
  } catch (err) {
    if (err.status === 401) {
      closeDetail();
      return;
    }
    if (err.status === 404) {
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      closeDetail();
      render();
      toast('这条任务已经被删除了', 'error');
      return;
    }
    if (err.status === 403) {
      toast(err.message || '没有权限修改这条任务', 'error');
      return;
    }
    const fields = err.fields || {};
    if (fields.title) setFieldError(els.dTitle, els.dTitleError, translateFieldMessage(fields.title));
    if (fields.assignee) setFieldError(els.dAssignee, els.dAssigneeError, translateFieldMessage(fields.assignee));
    if (fields.title || fields.assignee) toast('请检查填写内容', 'error');
    else toast(err.message || '保存失败', 'error');
  } finally {
    state.savingDetail = false;
    state.busy.delete(task.id);
    els.detailSave.disabled = false;
    els.detailSave.textContent = '保存';
  }
}

async function assignToMe() {
  const task = currentDetailTask();
  const me = myLabel();
  if (!task) return;
  if (!me) {
    toast('先登录才能指派给自己', 'error');
    return;
  }
  if (String(task.assignee || '').trim() === me) {
    toast('这条任务已经是你负责的');
    return;
  }

  els.assignMe.disabled = true;
  try {
    const updated = await API.update(task.id, { assignee: me });
    if (updated && typeof updated === 'object') Object.assign(task, { assignee: me }, updated);
    else task.assignee = me;
    els.dAssignee.value = task.assignee;
    setFieldError(els.dAssignee, els.dAssigneeError, '');
    els.detailHeading.textContent = task.title;
    flashId = task.id;
    render();
    toast(`已指派给 ${me}`);
  } catch (err) {
    if (err.status === 401) {
      closeDetail();
      return;
    }
    if (err.status === 403) toast(err.message || '没有权限指派这条任务', 'error');
    else if (err.status === 404) {
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      closeDetail();
      render();
      toast('这条任务已经被删除了', 'error');
    } else {
      toast(err.message || '指派失败', 'error');
    }
  } finally {
    els.assignMe.disabled = false;
  }
}

function armDelete() {
  const task = currentDetailTask();
  if (!task) return;
  if (!state.deleteArmed) {
    state.deleteArmed = true;
    els.detailDelete.textContent = '确认删除？';
    els.detailDelete.classList.add('is-armed');
    clearTimeout(state.deleteTimer);
    state.deleteTimer = setTimeout(resetDeleteConfirm, 4000);
    return;
  }
  resetDeleteConfirm();
  deleteTask(task);
}

async function deleteTask(task) {
  els.detailDelete.disabled = true;
  const label = els.detailDelete.textContent;
  els.detailDelete.textContent = '删除中…';

  try {
    await API.remove(task.id);
    state.tasks = state.tasks.filter((item) => String(item.id) !== String(task.id));
    if (flashId !== null && String(flashId) === String(task.id)) flashId = null;
    closeDetail();
    render();
    toast('任务已删除');
  } catch (err) {
    if (err.status === 401) {
      closeDetail();
      return;
    }
    if (err.status === 403) {
      toast('只有创建人或管理员可以删除这条任务', 'error');
    } else if (err.status === 404) {
      state.tasks = state.tasks.filter((item) => String(item.id) !== String(task.id));
      closeDetail();
      render();
      toast('这条任务已经被删除了');
    } else {
      toast(err.message || '删除失败', 'error');
    }
  } finally {
    els.detailDelete.disabled = false;
    els.detailDelete.textContent = label === '删除中…' ? '删除任务' : label;
  }
}

async function copyTaskLink() {
  const task = currentDetailTask();
  if (!task) return;
  const link = `${location.href.split('#')[0]}#task-${task.id}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('任务链接已复制');
  } catch {
    fallbackCopy(link);
  }
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  toast(ok ? '任务链接已复制' : `复制失败，链接：${text}`, ok ? 'ok' : 'error');
}

/* ---------------- 任务讨论 ---------------- */

function extractComments(body) {
  const items = extractItems(body);
  if (items.length) return items;
  if (body && body.comment && typeof body.comment === 'object') return [body.comment];
  return [];
}

function commentAuthor(comment) {
  const source = comment && comment.user && typeof comment.user === 'object' ? comment.user : comment;
  const name = String(
    source.display_name || source.displayName || source.username || comment?.display_name || comment?.username || '成员'
  ).trim();
  return {
    name: name || '成员',
    username: String(source.username || comment?.username || '').trim(),
  };
}

function commentText(comment) {
  return String(comment?.content ?? comment?.body ?? comment?.text ?? '').trim();
}

function renderComments() {
  const items = state.comments.items;
  els.commentList.replaceChildren();
  els.commentCount.textContent = items.length ? `${items.length} 条` : '';

  const fragment = document.createDocumentFragment();
  for (const comment of items) {
    const { name, username } = commentAuthor(comment);
    const text = commentText(comment);

    const item = document.createElement('li');
    item.className = 'comment';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = name.charAt(0) || '?';
    avatar.style.background = avatarColor(name);

    const main = document.createElement('div');
    main.className = 'comment-main';

    const head = document.createElement('div');
    head.className = 'comment-meta';
    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = name;
    if (username) author.title = `@${username}`;
    const time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = relativeTime(comment.created_at);
    if (comment.created_at) time.title = fullTime(comment.created_at);
    head.append(author, time);

    const body = document.createElement('p');
    body.className = 'comment-text';
    body.textContent = text;

    main.append(head, body);
    item.append(avatar, main);
    fragment.appendChild(item);
  }
  els.commentList.replaceChildren(fragment);

  els.commentEmpty.hidden = items.length > 0 || state.comments.status !== 'ready';
  els.commentCompose.hidden = state.comments.status !== 'ready' || auth.mode !== 'ready';
  els.commentLogin.hidden = !(state.comments.status === 'ready' && auth.mode !== 'ready');
}

async function loadComments(task) {
  const taskId = task.id;
  resetComments();
  state.comments.taskId = taskId;

  if (auth.mode !== 'ready') {
    els.commentLogin.hidden = false;
    return;
  }

  state.comments.status = 'loading';
  els.commentCount.textContent = '…';

  try {
    const data = await API.comments(taskId);
    if (state.detailId !== taskId) return;
    state.comments.items = extractComments(data);
    state.comments.status = 'ready';
    renderComments();
  } catch (err) {
    if (state.detailId !== taskId) return;
    if (err.status === 401 || err.status === 403) return; // 已回到登录页
    if (err.status === 404 || err.status === 405 || err.status === 501) {
      state.comments.status = 'unavailable';
      els.commentCount.textContent = '';
      els.commentBlocked.hidden = false;
      return;
    }
    state.comments.status = 'error';
    els.commentCount.textContent = '';
    els.commentBlocked.hidden = false;
    els.commentBlocked.textContent = `讨论加载失败：${err.message || '未知错误'}`;
  }
}

async function sendComment() {
  const task = currentDetailTask();
  const content = els.commentInput.value.trim();
  if (!task || !content || state.comments.status !== 'ready') return;
  if (content.length > COMMENT_MAX) {
    toast(`留言最多 ${COMMENT_MAX} 字`, 'error');
    return;
  }

  els.commentSend.disabled = true;
  els.commentSend.textContent = '发送中…';

  try {
    const data = await API.addComment(task.id, content);
    const saved = data && typeof data === 'object' ? (data.comment || data.item || data) : null;
    if (saved && (saved.id || saved.content || saved.body)) {
      state.comments.items.push(saved);
      renderComments();
    } else {
      await loadComments(task);
    }
    els.commentInput.value = '';
    els.commentLimit.textContent = `0/${COMMENT_MAX}`;
    els.commentInput.focus();
  } catch (err) {
    if (err.status === 401) return;
    if (err.status === 404 || err.status === 405 || err.status === 501) {
      state.comments.status = 'unavailable';
      els.commentCompose.hidden = true;
      els.commentBlocked.hidden = false;
      toast('评论接口还没上线，等后端接入后再试', 'error');
      return;
    }
    const fields = err.fields || {};
    toast(fields.content ? `留言${translateFieldMessage(fields.content)}` : (err.message || '发送失败'), 'error');
  } finally {
    els.commentSend.disabled = false;
    els.commentSend.textContent = '发送';
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
  els.refresh.addEventListener('click', () => load());
  els.retry.addEventListener('click', () => load());

  els.dialog.addEventListener('click', (event) => {
    if (event.target === els.dialog) closeDialog();
  });

  els.fTitle.addEventListener('input', () => {
    updateCounter(els.fTitle, els.titleCounter, TASK_TITLE_MAX);
    if (els.fTitle.getAttribute('aria-invalid') === 'true') setFieldError(els.fTitle, els.titleError, '');
  });

  els.fAssignee.addEventListener('input', () => {
    updateCounter(els.fAssignee, els.assigneeCounter, ASSIGNEE_MAX);
    if (els.fAssignee.getAttribute('aria-invalid') === 'true') setFieldError(els.fAssignee, els.assigneeError, '');
  });

  els.search.addEventListener('input', applySearch);
  els.search.addEventListener('focus', updateSearchChrome);
  els.search.addEventListener('blur', () => setTimeout(updateSearchChrome, 0));
  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.search.value) {
      event.preventDefault();
      clearSearch();
    }
  });
  els.searchClear.addEventListener('click', clearSearch);

  els.mineFilter.addEventListener('click', () => {
    state.mine = !state.mine;
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
    } else if (event.target.closest('.edit-btn') || event.target.closest('.task-open') || !event.target.closest('button')) {
      openDetail(task);
    }
  });

  /* ---- 详情弹窗 ---- */

  els.detailForm.addEventListener('submit', submitDetail);
  els.detailClose.addEventListener('click', closeDetail);
  els.detailCancel.addEventListener('click', closeDetail);
  els.detailDelete.addEventListener('click', armDelete);
  els.assignMe.addEventListener('click', assignToMe);
  els.detailCopy.addEventListener('click', copyTaskLink);

  els.dialogDetail.addEventListener('click', (event) => {
    if (event.target === els.dialogDetail) closeDetail();
  });

  els.dialogDetail.addEventListener('close', () => {
    state.detailId = null;
    state.detailSnapshot = null;
    state.comments = { taskId: null, status: 'idle', items: [] };
    clearHash();
  });

  els.dTitle.addEventListener('input', () => {
    updateCounter(els.dTitle, els.dTitleCounter, TASK_TITLE_MAX);
    if (els.dTitle.getAttribute('aria-invalid') === 'true') setFieldError(els.dTitle, els.dTitleError, '');
  });

  els.dAssignee.addEventListener('input', () => {
    if (els.dAssignee.getAttribute('aria-invalid') === 'true') setFieldError(els.dAssignee, els.dAssigneeError, '');
  });

  els.dialogDetail.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.target === els.commentInput) {
      event.stopPropagation();
      els.commentInput.blur();
    }
  });

  /* ---- 讨论 ---- */

  els.commentSend.addEventListener('click', sendComment);
  els.commentInput.addEventListener('input', () => {
    els.commentLimit.textContent = `${els.commentInput.value.length}/${COMMENT_MAX}`;
  });
  els.commentInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendComment();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (els.app.hidden || els.dialog.open || els.dialogDetail.open) return;
    event.preventDefault();
    els.search.focus();
  });

  window.addEventListener('hashchange', openDeepLink);
}

/* ---------------- 启动 ---------------- */

function init() {
  els.today.textContent = todayLabel();
  setAuthMode('login');
  updateSearchChrome();
  bindEvents();
  bootstrap();
}

init();
