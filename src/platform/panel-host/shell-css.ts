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
  position: relative;
  overflow: hidden;
  resize: both;
  container-type: inline-size;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(20, 30, 50, 0.16), 0 1px 3px rgba(20, 30, 50, 0.08);
  color-scheme: light;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1d2129;
}
/*
 * The bar lies over the top of the panel, whose toolbar keeps the two ends
 * free for it (entrypoints/panel/style.css, --shell-start and --shell-end):
 * the brand at the left, which the panel is dragged by, and the close button
 * at the right. Between them, presses reach the panel's own toolbar.
 */
.bar {
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 6px 0 0;
  pointer-events: none;
  user-select: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  /* The width includes the padding: the panel leaves --shell-start for it (#29). */
  box-sizing: border-box;
  width: 80px;
  height: 100%;
  padding-left: 12px;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}
.brand:active {
  cursor: grabbing;
}
.logo {
  flex: none;
  width: 20px;
  height: 20px;
}
.title {
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
}
/* Narrow: the logo alone, as the panel's toolbar expects. */
@container (max-width: 359px) {
  .brand {
    width: 44px;
  }
  .title {
    display: none;
  }
}
.close {
  pointer-events: auto;
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
  background: rgba(0, 0, 0, 0.06);
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
  margin: 56px 16px 16px;
}
/* The panel's theme, as the background reported it; until then, and for
   "system", the system's. */
.frame[data-theme='dark'] {
  border-color: rgba(255, 255, 255, 0.16);
  background: #15171c;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  color-scheme: dark;
  color: #e6e8eb;
}
.frame[data-theme='dark'] .close:hover {
  background: rgba(255, 255, 255, 0.1);
}
@media (prefers-color-scheme: dark) {
  .frame:not([data-theme='light']) {
    border-color: rgba(255, 255, 255, 0.16);
    background: #15171c;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    color-scheme: dark;
    color: #e6e8eb;
  }
  .frame:not([data-theme='light']) .close:hover {
    background: rgba(255, 255, 255, 0.1);
  }
}
`;
