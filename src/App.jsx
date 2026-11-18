import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import AuthScreen from './components/AuthScreen.jsx';
import TaskBoard from './components/TaskBoard.jsx';
import NewTaskDialog from './components/NewTaskDialog.jsx';
import TaskDetailDialog from './components/TaskDetailDialog.jsx';
import Toasts from './components/Toasts.jsx';
import {
  SEARCH_DEBOUNCE,
} from './constants.js';
import { matchesQuery } from './search.js';
import { isOverdue } from './due.js';
import {
  clearSession,
  extractItems,
  pickToken,
  pickUser,
  readSession,
  saveSession,
} from './session.js';

function nowLabel() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const [authMode, setAuthMode] = useState('checking');
  const [notice, setNotice] = useState('');
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [busy, setBusy] = useState(() => new Set());
  const [users, setUsers] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toasts, setToasts] = useState([]);

  const tokenRef = useRef('');
  const queryRef = useRef('');
  const overdueRef = useRef(false);
  const authModeRef = useRef('checking');
  const seqRef = useRef(0);
  const usersLoadedRef = useRef(false);
  const deepLinkChecked = useRef(false);
  const toastSeq = useRef(0);
  const flashTimer = useRef(0);

  authModeRef.current = authMode;
  overdueRef.current = overdue;

  /* ---------------- toast ---------------- */

  const pushToast = useCallback((message, kind = 'ok') => {
    if (!message) return;
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(
      () => {
        setToasts((prev) => prev.map((item) => (item.id === id ? { ...item, out: true } : item)));
        setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 220);
      },
      kind === 'error' ? 4200 : 2600
    );
  }, []);

  /* ---------------- 登录态 ---------------- */

  const expireSession = useCallback(
    (message = '') => {
      clearSession();
      tokenRef.current = '';
      api.setToken('');
      setUser(null);
      setTasks([]);
      setQuery('');
      setMine(false);
      setOverdue(false);
      setFilter('all');
      setUsers([]);
      usersLoadedRef.current = false;
      setDetailId(null);
      setShowCreate(false);
      setAuthMode('anonymous');
      setNotice(message || '');
    },
    []
  );

  useEffect(() => {
    api.setUnauthorizedHandler((message) => expireSession(message));
  }, [expireSession]);

  useEffect(() => {
    const saved = readSession();
    if (saved?.token) {
      tokenRef.current = saved.token;
      api.setToken(saved.token);
    }
    if (saved?.user) setUser(pickUser(saved.user) || saved.user || null);

    let cancelled = false;
    api
      .me()
      .then((body) => {
        if (cancelled) return;
        const nextUser = pickUser(body) || pickUser(saved?.user) || saved?.user || null;
        if (!nextUser) throw Object.assign(new Error('登录态无效'), { status: 401 });
        setUser(nextUser);
        saveSession(tokenRef.current, nextUser);
        setNotice('');
        setAuthMode('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401 || err.status === 403) {
          const hadSession = Boolean(tokenRef.current || saved);
          clearSession();
          tokenRef.current = '';
          api.setToken('');
          setUser(null);
          setAuthMode('anonymous');
          setNotice(hadSession ? '登录已过期，请重新登录。' : '');
          return;
        }
        if (err.status === 404 || err.status === 405 || err.status === 501) {
          // 后端用户接口还没上线：先匿名浏览，接口发布后刷新即要求登录。
          setAuthMode('unavailable');
          return;
        }
        setAuthMode('anonymous');
        setNotice(err.message || '连不上登录接口，请确认后端服务在线。');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleAuthenticated(body) {
    const token = pickToken(body);
    const nextUser = pickUser(body);
    if (token) {
      tokenRef.current = token;
      api.setToken(token);
    }
    if (nextUser) setUser(nextUser);
    if (token) saveSession(token, nextUser);
    setNotice('');
    setAuthMode('ready');
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* 后端没提供退出接口时也照样清本地登录态 */
    }
    expireSession('已退出登录。');
    pushToast('已退出登录');
  }

  /* ---------------- 数据 ---------------- */

  const load = useCallback(async ({ quiet = false } = {}) => {
    const mode = authModeRef.current;
    if (mode !== 'ready' && mode !== 'unavailable') return;

    const q = queryRef.current.trim();
    const params = {};
    if (q) params.q = q;
    if (overdueRef.current) params.overdue = true;
    const seq = ++seqRef.current;
    if (!quiet) {
      setLoading(true);
      setErrorText('');
    }

    try {
      const data = await api.list(params);
      if (seq !== seqRef.current) return;
      if (q !== queryRef.current.trim()) return;
      setTasks(extractItems(data));
      setErrorText('');
    } catch (err) {
      if (seq !== seqRef.current) return;
      if (err.status === 401 || err.status === 403) return;
      if (!quiet) setErrorText(err.message || '加载失败');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  const ensureUsers = useCallback(async (force = false) => {
    if (authModeRef.current !== 'ready') return;
    if (usersLoadedRef.current && !force) return;
    try {
      const data = await api.users();
      setUsers(
        extractItems(data)
          .map((item) => ({ ...item, label: String(item.display_name || item.displayName || item.username || '').trim() }))
          .filter((item) => item.label)
      );
    } catch {
      setUsers([]);
    } finally {
      usersLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (authMode !== 'ready' && authMode !== 'unavailable') return;
    load();
    if (authMode === 'ready') ensureUsers();
  }, [authMode, load, ensureUsers]);

  /* ---------------- 搜索：本地即时过滤 + 防抖请求服务端 ---------------- */

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const queryMounted = useRef(false);
  useEffect(() => {
    if (!queryMounted.current) {
      queryMounted.current = true;
      return undefined;
    }
    const timer = setTimeout(() => load({ quiet: true }), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [query, load]);

  /* 只看逾期走服务端 `overdue=true`，切换后立刻重拉；列表本身也会在本地先收一遍。 */
  const overdueMounted = useRef(false);
  useEffect(() => {
    if (!overdueMounted.current) {
      overdueMounted.current = true;
      return undefined;
    }
    load({ quiet: true });
  }, [overdue, load]);

  /* ---------------- 列表派生 ---------------- */

  const myLabel = user ? String(user.displayName || user.username || '').trim() : '';

  const overdueTasks = tasks.filter((task) => isOverdue(task));
  const baseTasks = overdue ? overdueTasks : tasks;

  const counts = { all: baseTasks.length, todo: 0, doing: 0, done: 0 };
  for (const task of baseTasks) {
    if (counts[task.status] !== undefined) counts[task.status] += 1;
  }

  const visibleTasks = baseTasks.filter((task) => {
    if (filter !== 'all' && task.status !== filter) return false;
    if (mine) {
      const assignee = String(task.assignee || '').trim();
      const isMine =
        Boolean(myLabel) &&
        (assignee === myLabel || (user?.username && assignee === user.username));
      if (!isMine) return false;
    }
    return matchesQuery(task, query);
  });

  const assigneeOptions = (() => {
    const names = new Set();
    for (const item of users) names.add(item.label);
    for (const task of tasks) if (task.assignee) names.add(String(task.assignee).trim());
    if (myLabel) names.add(myLabel);
    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  })();

  /* ---------------- 任务操作 ---------------- */

  const markBusy = (id, on) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(String(id));
      else next.delete(String(id));
      return next;
    });
  };

  const replaceTask = (id, patch) => {
    setTasks((prev) => prev.map((task) => (String(task.id) === String(id) ? { ...task, ...patch } : task)));
  };

  function flash(taskId) {
    setFlashId(taskId);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), 700);
  }

  async function changeStatus(task, next) {
    if (!next || busy.has(String(task.id))) return;
    const previous = task.status;
    replaceTask(task.id, { status: next });
    markBusy(task.id, true);
    try {
      const updated = await api.update(task.id, { status: next });
      if (updated && typeof updated === 'object') replaceTask(task.id, updated);
    } catch (err) {
      replaceTask(task.id, { status: previous });
      if (err.status !== 401 && err.status !== 403) pushToast(err.message || '状态更新失败', 'error');
    } finally {
      markBusy(task.id, false);
    }
  }

  function handleCreated(body) {
    const task = body && typeof body === 'object' && body.data && typeof body.data === 'object' ? body.data : body;
    if (!task || typeof task !== 'object') return;
    const wasFiltered = Boolean(query.trim()) || mine || overdue;
    setTasks((prev) => [task, ...prev.filter((item) => String(item.id) !== String(task.id))]);
    setFilter('all');
    setQuery('');
    setMine(false);
    setOverdue(false);
    flash(task.id);
    if (wasFiltered) load({ quiet: true });
  }

  /* ---------------- 详情 ---------------- */

  const detailTask = detailId === null ? null : tasks.find((task) => String(task.id) === String(detailId)) || null;

  function syncHash(id) {
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#task-${id}`);
    } catch {
      /* file:// 下个别浏览器不让改 */
    }
  }

  function clearHash() {
    if (!window.location.hash) return;
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* 忽略 */
    }
  }

  function openDetail(task, options = {}) {
    if (!task) return;
    setDetailId(task.id);
    syncHash(task.id);
    ensureUsers();
    if (options.focus === false) return;
  }

  function closeDetail() {
    setDetailId(null);
    clearHash();
  }

  function canDelete(task) {
    if (authMode !== 'ready' || !user) return false;
    if (user.role === 'admin') return true;
    if (task.created_by === null || task.created_by === undefined) return false;
    return String(task.created_by) === String(user.id);
  }

  async function saveDetail(payload) {
    const task = detailTask;
    if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
    const updated = await api.update(task.id, payload);
    const patch =
      updated && typeof updated === 'object'
        ? { ...payload, ...updated }
        : { ...payload, updated_at: new Date().toISOString() };
    replaceTask(task.id, patch);
    flash(task.id);
    pushToast('任务已更新');
    return patch;
  }

  async function assignToMe() {
    const task = detailTask;
    if (!task) return null;
    if (!myLabel) {
      pushToast('先登录才能指派给自己', 'error');
      return null;
    }
    if (String(task.assignee || '').trim() === myLabel) {
      pushToast('这条任务已经是你负责的');
      return null;
    }
    try {
      const updated = await api.update(task.id, { assignee: myLabel });
      const applied = updated && typeof updated === 'object' && updated.assignee ? updated.assignee : myLabel;
      replaceTask(task.id, { assignee: applied, ...(updated || {}) });
      flash(task.id);
      pushToast(`已指派给 ${applied}`);
      return applied;
    } catch (err) {
      if (err.status === 401) return null;
      if (err.status === 403) pushToast(err.message || '没有权限指派这条任务', 'error');
      else if (err.status === 404) {
        setTasks((prev) => prev.filter((item) => String(item.id) !== String(task.id)));
        setDetailId(null);
        pushToast('这条任务已经被删除了', 'error');
      } else {
        pushToast(err.message || '指派失败', 'error');
      }
      throw err;
    }
  }

  async function deleteTask() {
    const task = detailTask;
    if (!task) return;
    try {
      await api.remove(task.id);
      setTasks((prev) => prev.filter((item) => String(item.id) !== String(task.id)));
      pushToast('任务已删除');
      return true;
    } catch (err) {
      if (err.status === 401) return false;
      if (err.status === 403) {
        pushToast('只有创建人或管理员可以删除这条任务', 'error');
        throw err;
      }
      if (err.status === 404) {
        setTasks((prev) => prev.filter((item) => String(item.id) !== String(task.id)));
        setDetailId(null);
        pushToast('这条任务已经被删除了');
        return false;
      }
      pushToast(err.message || '删除失败', 'error');
      throw err;
    }
  }

  async function copyTaskLink() {
    const task = detailTask;
    if (!task) return;
    const link = `${window.location.href.split('#')[0]}#task-${task.id}`;
    try {
      await navigator.clipboard.writeText(link);
      pushToast('任务链接已复制');
    } catch {
      const area = document.createElement('textarea');
      area.value = link;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
      pushToast(ok ? '任务链接已复制' : `复制失败，链接：${link}`, ok ? 'ok' : 'error');
    }
  }

  /* ---------------- 深链接 ---------------- */

  useEffect(() => {
    if (deepLinkChecked.current || loading || !tasks.length) return;
    deepLinkChecked.current = true;
    const match = window.location.hash.match(/^#task-(\d+)$/);
    if (!match) return;
    const task = tasks.find((item) => String(item.id) === match[1]);
    if (task) openDetail(task, { focus: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, loading]);

  useEffect(() => {
    function onHashChange() {
      const match = window.location.hash.match(/^#task-(\d+)$/);
      if (!match) return;
      const task = tasks.find((item) => String(item.id) === match[1]);
      if (task) openDetail(task, { focus: false });
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  /* ---------------- 渲染 ---------------- */

  const who = authMode === 'ready' && user ? ` · ${user.displayName || user.username}` : '';
  const origin = api.base() || window.location.origin;
  const footer = `接口 ${origin}${who} · 更新于 ${nowLabel()}`;

  return (
    <>
      {authMode === 'checking' ? null : authMode === 'anonymous' ? (
        <AuthScreen
          notice={notice}
          onAuthenticated={handleAuthenticated}
          onToast={pushToast}
        />
      ) : (
        <TaskBoard
          authMode={authMode}
          user={user}
          myLabel={myLabel}
          tasks={tasks}
          visibleTasks={visibleTasks}
          counts={counts}
          loading={loading}
          errorText={errorText}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          mine={mine}
          onMine={() => setMine((prev) => !prev)}
          overdue={overdue}
          onOverdue={() => setOverdue((prev) => !prev)}
          overdueCount={overdueTasks.length}
          busy={busy}
          flashId={flashId}
          footer={footer}
          onRefresh={() => load()}
          onNewTask={() => setShowCreate(true)}
          onOpen={openDetail}
          onChangeStatus={changeStatus}
          onLogout={handleLogout}
        />
      )}

      {showCreate ? (
        <NewTaskDialog
          defaultAssignee={myLabel}
          assigneeOptions={assigneeOptions}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          onToast={pushToast}
        />
      ) : null}

      {detailTask ? (
        <TaskDetailDialog
          key={detailTask.id}
          task={detailTask}
          signedIn={authMode === 'ready'}
          canDelete={canDelete(detailTask)}
          assigneeOptions={assigneeOptions}
          onClose={closeDetail}
          onSave={saveDetail}
          onAssignMe={assignToMe}
          onDelete={deleteTask}
          onCopyLink={copyTaskLink}
          onToast={pushToast}
        />
      ) : null}

      <Toasts items={toasts} />
    </>
  );
}
