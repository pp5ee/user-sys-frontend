'use strict';

/* ------------------------------------------------------------------ *
 * 团队任务台 — 前端
 * 接口：GET /api/tasks · POST /api/tasks · PATCH /api/tasks/{id}
 * ------------------------------------------------------------------ */

const TEST_API = 'http://47.108.60.176';
const STATUS_LABEL = { todo: '待办', doing: '进行中', done: '完成' };
const PRIORITY_LABEL = { low: '低', medium: '中', high: '高' };
const NEXT_STATUS = { todo: 'doing', doing: 'done', done: null };
const PREV_STATUS = { todo: null, doing: 'todo', done: 'doing' };
const AVATAR_COLORS = ['#2f6f5e', '#3a5f9e', '#8a5a2b', '#7b4b8a', '#2b6a7a', '#8a4b4b'];

/* ---------------- 接口地址 ---------------- */

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 隐私模式下忽略 */ }
}

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
    const init = { ...options, signal: controller.signal };
    if (options.body) init.headers = { 'Content-Type': 'application/json' };

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
      throw err;
    }

    return body;
  },

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
};

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

/* ---------------- DOM ---------------- */

const els = {
  today: document.getElementById('today'),
  summary: document.getElementById('summary'),
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
  els.footText.textContent = `接口 ${origin} · 更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

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
    toast(err.message || '状态更新失败', 'error');
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
  bindEvents();
  load();
}

init();
