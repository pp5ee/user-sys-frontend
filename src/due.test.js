import { describe, it, expect } from 'vitest';
import { isOverdue, localDateISO, toDateOnly } from './due.js';

describe('截止日期', () => {
  const today = '2026-11-17';

  it('只有早于今天且未完成才算逾期', () => {
    expect(isOverdue({ due_on: '2026-11-16', status: 'todo' }, today)).toBe(true);
    expect(isOverdue({ due_on: '2026-11-17', status: 'doing' }, today)).toBe(false);
    expect(isOverdue({ due_on: '2026-11-18', status: 'todo' }, today)).toBe(false);
    expect(isOverdue({ due_on: '2026-11-16', status: 'done' }, today)).toBe(false);
  });

  it('没有或格式不对的截止日期不算逾期', () => {
    expect(isOverdue({}, today)).toBe(false);
    expect(isOverdue({ due_on: '' }, today)).toBe(false);
    expect(isOverdue({ due_on: '11/17/2026' }, today)).toBe(false);
    expect(isOverdue({ due_on: '2026-02-30' }, today)).toBe(false);
    expect(isOverdue(null, today)).toBe(false);
  });

  it('合法日期去掉首尾空格，今天按本地日历日算', () => {
    expect(toDateOnly('  2026-11-17  ')).toBe('2026-11-17');
    expect(toDateOnly('2026-2-3')).toBe('');
    expect(localDateISO(new Date(2026, 10, 17, 23, 30))).toBe('2026-11-17');
    expect(localDateISO(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
});
