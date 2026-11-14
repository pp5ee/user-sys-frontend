import { API_BASE_KEY, COMMENT_MAX } from './constants.js';

const TEST_API = 'http://47.108.60.176';

/**
 * 接口地址只允许两种来源，避免有人用 `?api=` 把页面指到自己的服务器上偷账号和 token：
 * 1. 本地开发（localhost / 127.0.0.1 / file:）：可用 `?api=http://host:port` 指向测试服，
 *    或构建时注入 VITE_API_BASE；
 * 2. 线上：一律同源 `/api`，忽略 URL 参数、环境变量和历史 localStorage 记录。
 *
 * 之前版本会把 `?api=` 写进 localStorage，等于给了一条持续生效的钓鱼通道，已移除。
 */
export function isLocalLocation(loc) {
  const host = String(loc?.hostname || '').toLowerCase();
  return (
    loc?.protocol === 'file:' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  );
}

/** 只接受 http(s)、不带用户名密码的地址，其它（javascript:、data:、含凭据）一律丢弃。 */
export function sanitizeApiBase(raw, loc = window.location) {
  if (raw === null || raw === undefined || raw === '') return '';
  let parsed;
  try {
    parsed = new URL(String(raw).trim(), loc?.origin || 'http://localhost');
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  if (parsed.username || parsed.password) return '';
  const path = parsed.pathname.replace(/\/+$/, '');
  return parsed.origin + path;
}

export function resolveApiBase(
  loc = window.location,
  legacyStorage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
  envBase = import.meta.env?.VITE_API_BASE
) {
  // 旧版本留下的接口地址（含被 `?api=` 写进去的）一律清掉，不再信任
  if (legacyStorage) {
    try {
      legacyStorage.removeItem(API_BASE_KEY);
    } catch {
      /* 隐私模式忽略 */
    }
  }

  if (isLocalLocation(loc)) {
    const override = sanitizeApiBase(new URLSearchParams(loc.search || '').get('api'), loc);
    if (override) return override;
    const fromEnv = sanitizeApiBase(envBase, loc);
    if (fromEnv) return fromEnv;
    return TEST_API;
  }

  // 线上只走同源，任何外部地址都不接受
  return '';
}

export function createApi() {
  let token = '';
  let onUnauthorized = null;

  function setToken(next) {
    token = next || '';
  }

  function setUnauthorizedHandler(handler) {
    onUnauthorized = handler;
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const { skipAuthRedirect, ...rest } = options;
    const init = { ...rest, headers, signal: controller.signal };

    let res;
    try {
      res = await fetch(resolveApiBase() + path, init);
    } catch (err) {
      throw Object.assign(
        new Error(err.name === 'AbortError' ? '请求超时，请稍后重试' : '连不上接口，请确认后端服务在线'),
        { status: 0 }
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return null;

    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (!res.ok) {
      const error = body && body.error ? body.error : {};
      const fields = error.fields || null;
      let message = error.message || `请求失败（HTTP ${res.status}）`;
      if (fields) message += '：' + Object.values(fields).join('；');
      const err = new Error(message);
      err.status = res.status;
      err.fields = fields;
      // 只有 401 才是登录态失效；403 是登录着但没权限，不能顺手把人踢下线
      if (res.status === 401 && token && !skipAuthRedirect && onUnauthorized) {
        onUnauthorized('登录已过期，请重新登录');
      }
      throw err;
    }

    return body;
  }

  return {
    setToken,
    setUnauthorizedHandler,
    base: () => resolveApiBase(),

    /* ---- 任务 ---- */
    list(params = {}) {
      const query = new URLSearchParams();
      if (params.q) query.set('q', params.q);
      const suffix = query.toString();
      return request('/api/tasks' + (suffix ? `?${suffix}` : ''));
    },
    create(payload) {
      return request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    },
    update(id, payload) {
      return request(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    remove(id) {
      return request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /* ---- 协作用户 / 讨论 ---- */
    users() {
      return request('/api/users', { skipAuthRedirect: true });
    },
    comments(taskId) {
      return request(`/api/tasks/${encodeURIComponent(taskId)}/comments`);
    },
    addComment(taskId, content) {
      return request(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: String(content).slice(0, COMMENT_MAX) }),
      });
    },

    /* ---- 用户 ---- */
    me() {
      return request('/api/auth/me', { skipAuthRedirect: true });
    },
    login(payload) {
      return request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
        skipAuthRedirect: true,
      });
    },
    register(payload) {
      return request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
        skipAuthRedirect: true,
      });
    },
    logout() {
      return request('/api/auth/logout', { method: 'POST', skipAuthRedirect: true });
    },
  };
}

export const api = createApi();
