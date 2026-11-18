import { useEffect, useRef, useState } from 'react';
import { STATUS_ORDER } from '../constants.js';
import { avatarColor, todayLabel } from '../session.js';
import CysicLogo from './CysicLogo.jsx';
import TaskRow from './TaskRow.jsx';

const EMPTY_COPY = {
  none: ['这里还没有任务', '点右上角「新建任务」，把今天要做的事记下来。'],
  mine: ['没有分给你的任务', '新建任务时把负责人填成自己，或者等同事指派给你。'],
  overdue: ['没有逾期的任务', '未完成的任务里，截止日期都还没到。'],
  filtered: ['没有符合条件的任务', '换个筛选条件，或者清空搜索试试。'],
};

export default function TaskBoard({
  authMode,
  user,
  myLabel,
  tasks,
  visibleTasks,
  counts,
  loading,
  errorText,
  filter,
  onFilter,
  query,
  onQuery,
  mine,
  onMine,
  overdue,
  onOverdue,
  overdueCount,
  busy,
  flashId,
  footer,
  onRefresh,
  onNewTask,
  onOpen,
  onChangeStatus,
  onLogout,
}) {
  const searchRef = useRef(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const debounceRef = useRef(0);
  const [summary, setSummary] = useState('看今天有哪些事、谁在做、做到哪了。');

  const signedIn = authMode === 'ready' && user;

  useEffect(() => {
    return () => window.clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (overdue) {
      setSummary(
        trimmed
          ? `搜索「${trimmed}」匹配 ${visibleTasks.length} 条逾期任务`
          : `逾期 ${visibleTasks.length} 条任务 · 待办 ${counts.todo} · 进行中 ${counts.doing}`
      );
    } else if (trimmed) {
      setSummary(`搜索「${trimmed}」匹配 ${visibleTasks.length} 条任务`);
    } else if (tasks.length) {
      setSummary(`共 ${counts.all} 条任务 · 待办 ${counts.todo} · 进行中 ${counts.doing} · 完成 ${counts.done}`);
    } else if (!loading) {
      setSummary('看今天有哪些事、谁在做、做到哪了。');
    }
  }, [query, overdue, visibleTasks.length, tasks.length, counts, loading]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const showClear = query.length > 0;
  const showKbd = !showClear && !searchFocused;

  const isEmpty = !loading && !errorText && visibleTasks.length === 0;
  const emptyCopy = overdue
    ? EMPTY_COPY.overdue
    : tasks.length === 0
      ? EMPTY_COPY.none
      : mine
        ? EMPTY_COPY.mine
        : EMPTY_COPY.filtered;

  return (
    <main className="shell" id="app">
      <header className="topbar">
        <div className="titleblock">
          <div className="brand-line">
            <CysicLogo size={20} withWordmark />
            <span className="brand-divider" aria-hidden="true" />
            <p className="eyebrow" id="today">
              {todayLabel()}
            </p>
          </div>
          <h1>团队任务台</h1>
          <p className="sub" id="summary">
            {summary}
          </p>
        </div>
        <div className="topbar-actions">
          {signedIn ? (
            <div className="user-chip" id="user-chip">
              <span
                className="avatar"
                id="user-avatar"
                aria-hidden="true"
                style={{ background: avatarColor(user.displayName || user.username) }}
              >
                {(user.displayName || user.username || '?').trim().charAt(0) || '?'}
              </span>
              <span className="user-name" id="user-name" title={user.username ? `@${user.username}` : undefined}>
                {user.displayName || user.username}
              </span>
            </div>
          ) : authMode === 'unavailable' ? (
            <div className="user-chip" id="user-chip">
              <span className="avatar" id="user-avatar" aria-hidden="true" style={{ background: '#8b8b81' }}>
                匿
              </span>
              <span className="user-name" id="user-name" title="后端用户接口还没上线">
                匿名访问
              </span>
            </div>
          ) : null}
          {signedIn ? (
            <button id="logout" className="btn ghost btn-sm" type="button" onClick={onLogout}>
              退出
            </button>
          ) : null}
          <button id="refresh" className="btn ghost" type="button" title="重新拉取任务" onClick={onRefresh}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M15.5 6.5A6.5 6.5 0 1 0 16.5 12" />
              <path d="M15.5 2.5v4h-4" />
            </svg>
            刷新
          </button>
          <button id="new-task" className="btn primary" type="button" onClick={onNewTask}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 4.5v11M4.5 10h11" />
            </svg>
            新建任务
          </button>
        </div>
      </header>

      {authMode === 'unavailable' ? (
        <p className="notice" id="auth-notice">
          用户系统接口（<code>/api/auth/*</code>）还没上线，当前以匿名方式浏览任务；接口发布后会自动要求登录。
        </p>
      ) : null}

      <section className="toolbar">
        <div className="tabs" role="group" aria-label="按状态筛选">
          {STATUS_ORDER.map((key) => (
            <button
              key={key}
              className="tab"
              type="button"
              data-status={key}
              aria-pressed={filter === key}
              onClick={() => onFilter(key)}
            >
              {key === 'all' ? '全部' : key === 'todo' ? '待办' : key === 'doing' ? '进行中' : '完成'}
              <span className="tab-count" data-count={key}>
                {counts[key] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          {signedIn ? (
            <button
              className="filter-chip"
              id="mine-filter"
              type="button"
              aria-pressed={mine}
              title="只看负责人是我的任务"
              onClick={onMine}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8" cy="7" r="3" />
                <path d="M2.8 16c.5-3 2.7-4.7 5.2-4.7S12.7 13 13.2 16" />
                <path d="M14 6.5l1.6 1.6 3-3.2" />
              </svg>
              我负责的
            </button>
          ) : null}
          <button
            className="filter-chip"
            id="overdue-filter"
            type="button"
            aria-pressed={overdue}
            aria-label="只看逾期"
            title="只看已过截止日期、还没完成的任务"
            onClick={onOverdue}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 6v4.2l2.8 1.7" />
            </svg>
            只看逾期
            {overdueCount ? (
              <span className="chip-count" aria-hidden="true">
                {overdueCount}
              </span>
            ) : null}
          </button>
          <div className="search" id="search-box">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.2 13.2L17 17" />
            </svg>
            <input
              id="search"
              ref={searchRef}
              type="search"
              placeholder="搜标题、备注或负责人"
              title="搜索任务：标题、备注、负责人或创建人"
              autoComplete="off"
              aria-label="搜索任务：标题、备注、负责人或创建人"
              value={query}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 0)}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault();
                  onQuery('');
                  searchRef.current?.focus();
                }
              }}
            />
            {showClear ? (
              <button
                className="search-clear"
                id="search-clear"
                type="button"
                aria-label="清空搜索"
                onClick={() => {
                  onQuery('');
                  searchRef.current?.focus();
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M6 6l8 8M14 6l-8 8" />
                </svg>
              </button>
            ) : null}
            {showKbd ? (
              <kbd className="search-kbd" id="search-kbd" aria-hidden="true">
                /
              </kbd>
            ) : null}
          </div>
        </div>
      </section>

      <section className="board" aria-label="任务列表">
        {!loading && !errorText && !isEmpty ? (
          <div className="list-head" id="list-head" aria-hidden="true">
            <span>任务</span>
            <span>负责人</span>
            <span>优先级</span>
            <span>状态</span>
          </div>
        ) : null}

        {!loading && !errorText && !isEmpty ? (
          <ul id="list" className="list">
            {visibleTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                busy={busy.has(String(task.id)) || busy.has(task.id)}
                isNew={String(flashId) === String(task.id)}
                onOpen={onOpen}
                onChangeStatus={onChangeStatus}
              />
            ))}
          </ul>
        ) : null}

        {loading ? (
          <div id="skeleton" className="skeleton" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div className="sk-row" key={index}>
                <span className="sk w60" />
                <span className="sk w20" />
                <span className="sk w30" />
                <span className="sk w50" />
              </div>
            ))}
          </div>
        ) : null}

        {isEmpty ? (
          <div id="empty" className="empty">
            <div className="empty-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 6.5h9M4 12h9M4 17.5h5" />
                <path d="M17.5 12.5l2 2 3-3.5" />
              </svg>
            </div>
            <p className="empty-title">{emptyCopy[0]}</p>
            <p className="empty-sub">{emptyCopy[1]}</p>
          </div>
        ) : null}

        {errorText ? (
          <div id="error" className="error">
            <p className="error-title">接口连不上</p>
            <p className="error-sub" id="error-sub">
              {errorText}
            </p>
            <button id="retry" className="btn ghost" type="button" onClick={onRefresh}>
              重试
            </button>
          </div>
        ) : null}
      </section>

      <footer className={`foot${errorText ? ' is-off' : ''}`}>
        <span className="foot-status">
          <span className="dot-live" aria-hidden="true" />
          <span id="foot-text">{errorText ? '接口未连接' : footer}</span>
        </span>
        <span className="foot-brand">
          <CysicLogo size={13} withWordmark />
        </span>
      </footer>
    </main>
  );
}
