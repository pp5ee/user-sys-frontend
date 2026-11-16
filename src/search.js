/**
 * 任务搜索：标题、备注、负责人、创建人任一命中就算匹配。
 * 关键词和字段都先去掉首尾空白再转小写，避免大小写或多余空格把结果搜丢。
 */

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function matchesQuery(task, rawQuery) {
  const keyword = normalize(rawQuery);
  if (!keyword) return true;
  if (!task || typeof task !== 'object') return false;
  return [task.title, task.note, task.assignee, task.creator].some((field) =>
    normalize(field).includes(keyword)
  );
}
