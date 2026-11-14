import { API_BASE_KEY, COMMENT_MAX } from './constants.js';
import { readStorage, writeStorage } from './session.js';

const TEST_API = 'http://47.108.60.176';

/**
 * 接口地址取值顺序：
 * 1. URL 参数 ?api=http://host:port（会记在 localStorage 里，之后一直用它）
 * 2. 构建时注入的 VITE_API_BASE
 * 3. localStorage 里记下的地址
 * 4. 本地（localhost / 127.0.0.1 / file:）打开时连测试服
 * 5. 其它情况走同域相对路径 /api
 */
export function resolveApiBase() {
  const override = new URLSearchParams(window.location.search).get('api');
  if (override) writeStorage(API_BASE_KEY, override);

  const saved = readStorage(API_BASE_KEY);
  if (saved) return saved.replace(/\/+$/, '');

  const fromEnv = import.meta.env?.VITE_API_BASE;
  if (fromEnv) return String(fromEnv).replace(/\/+$/, '');

  if (window.location.protocol === 'file:') return TEST_API;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return TEST_API;
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
      if ((res.status === 401 || res.status === 403) && token && !skipAuthRedirect && onUnauthorized) {
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
