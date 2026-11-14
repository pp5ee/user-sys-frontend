/* 页面文案、取值映射和校验规则，和 app.js 时期保持一致 */

export const STATUS_LABEL = { todo: '待办', doing: '进行中', done: '完成' };
export const PRIORITY_LABEL = { low: '低', medium: '中', high: '高' };
export const NEXT_STATUS = { todo: 'doing', doing: 'done', done: null };
export const PREV_STATUS = { todo: null, doing: 'todo', done: 'doing' };
export const STATUS_ORDER = ['all', 'todo', 'doing', 'done'];

export const AVATAR_COLORS = ['#2f6f5e', '#3a5f9e', '#8a5a2b', '#7b4b8a', '#2b6a7a', '#8a4b4b'];
export const SESSION_KEY = 'ttb.session';
export const API_BASE_KEY = 'ttb.apiBase';

// 与后端注册接口的校验规则保持一致
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_RE = /^[A-Za-z0-9_.-]+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const DISPLAY_NAME_MAX = 50;
export const TASK_TITLE_MAX = 200;
export const ASSIGNEE_MAX = 50;
export const COMMENT_MAX = 1000;
export const SEARCH_DEBOUNCE = 260;

export const FIELD_LABEL = {
  username: '账号',
  password: '密码',
  display_name: '显示名',
  title: '标题',
  assignee: '负责人',
  content: '留言',
};
