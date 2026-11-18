/**
 * 截止日期：后端 due_on 是 `YYYY-MM-DD`，按本地日历日比较。
 * 不用 `new Date('YYYY-MM-DD')`，那个按 UTC 解析，东八区以外会差一天。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 合法日期返回原字符串，其它（空、格式不对、2 月 30 日这类）返回空串。 */
export function toDateOnly(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!DATE_RE.test(text)) return '';
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? text : '';
}

/** 本地时区的今天，`YYYY-MM-DD`。 */
export function localDateISO(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 截止日期早于今天、且任务还没完成，才算逾期。 */
export function isOverdue(task, today = localDateISO()) {
  const due = toDateOnly(task?.due_on);
  if (!due) return false;
  if (task.status === 'done') return false;
  return due < today;
}
