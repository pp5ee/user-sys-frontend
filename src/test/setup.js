import '@testing-library/jest-dom/vitest';

// jsdom 对 <dialog> 的 showModal/close 支持不完整，测试里补一个最小实现。
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.removeAttribute('open');
    };
  }
}

// jsdom 没有实现 AbortController 超时之外的东西；fetch 由各个用例 stub。
