/**
 * Styles inside the shell's closed shadow root. Applied as a constructed
 * stylesheet: page CSP (`style-src`) governs <style> elements and style
 * attributes, not stylesheets built through the CSSOM.
 */
export const SHELL_CSS = `
:host {
  all: initial;
}
.frame {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 420px;
  height: min(640px, calc(100vh - 32px));
  min-width: 300px;
  min-height: 240px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow: hidden;
  resize: both;
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  color-scheme: light;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1d2129;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  height: 34px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  background: #f5f6f8;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.bar:active {
  cursor: grabbing;
}
.title {
  flex: 1;
  font-weight: 600;
}
.close {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.close:hover {
  background: rgba(0, 0, 0, 0.08);
}
.close:focus-visible {
  outline: 2px solid #2b6ad6;
}
.body {
  position: relative;
  flex: 1;
}
iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.dragging iframe {
  pointer-events: none;
}
.message {
  margin: 16px;
}
/* The panel's theme, as the background reported it; until then, and for
   "system", the system's. */
.frame[data-theme='dark'] {
  border-color: rgba(255, 255, 255, 0.16);
  background: #15171c;
  color-scheme: dark;
  color: #e6e8eb;
}
.frame[data-theme='dark'] .bar {
  border-bottom-color: rgba(255, 255, 255, 0.1);
  background: #1f2228;
}
.frame[data-theme='dark'] .close:hover {
  background: rgba(255, 255, 255, 0.1);
}
@media (prefers-color-scheme: dark) {
  .frame:not([data-theme='light']) {
    border-color: rgba(255, 255, 255, 0.16);
    background: #15171c;
    color-scheme: dark;
    color: #e6e8eb;
  }
  .frame:not([data-theme='light']) .bar {
    border-bottom-color: rgba(255, 255, 255, 0.1);
    background: #1f2228;
  }
  .frame:not([data-theme='light']) .close:hover {
    background: rgba(255, 255, 255, 0.1);
  }
}
`;
