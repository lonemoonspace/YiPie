import { useEffect } from 'react';
import { LogLevel, Theme } from '@/contract/general-settings';
import { applyTheme } from '@/features/theme/apply-theme';
import { useGeneralSettings, type SaveState } from './use-general-settings';

const THEME_LABELS: Record<Theme, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: '调试（全部）',
  info: '信息',
  warn: '警告',
  error: '错误',
  silent: '不记录',
};

export function GeneralSettingsPage() {
  const { view, loadError, save, update } = useGeneralSettings();
  const theme = view?.settings.theme;

  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  if (loadError !== null) {
    return (
      <main className="page">
        <h1>设置</h1>
        <p role="alert" className="notice">
          读取设置失败：{loadError}
        </p>
      </main>
    );
  }

  if (view === null) {
    return (
      <main className="page">
        <h1>设置</h1>
        <p>加载中…</p>
      </main>
    );
  }

  const disabled = view.readOnly || save.kind === 'saving';

  return (
    <main className="page">
      <h1>设置</h1>

      {view.readOnly ? (
        <p role="alert" className="notice">
          这些设置是由更新版本的扩展写入的。当前版本只能查看，不能修改。
        </p>
      ) : view.status === 'invalid' ? (
        <p role="alert" className="notice">
          已保存的设置无法识别，下面显示的是默认值。下次保存前，原来的数据会先备份。
        </p>
      ) : null}

      <section className="card" aria-labelledby="general-heading">
        <h2 id="general-heading">通用</h2>

        <div className="field">
          <label htmlFor="theme">主题</label>
          <select
            id="theme"
            value={view.settings.theme}
            disabled={disabled}
            onChange={(event) => void update({ theme: Theme.parse(event.target.value) })}
          >
            {Theme.options.map((option) => (
              <option key={option} value={option}>
                {THEME_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="log-level">日志级别</label>
          <select
            id="log-level"
            value={view.settings.logLevel}
            disabled={disabled}
            onChange={(event) => void update({ logLevel: LogLevel.parse(event.target.value) })}
          >
            {LogLevel.options.map((option) => (
              <option key={option} value={option}>
                {LOG_LEVEL_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <p role="status" className="save-status">
        {describeSave(save)}
      </p>
    </main>
  );
}

function describeSave(save: SaveState): string {
  switch (save.kind) {
    case 'idle':
      return '';
    case 'saving':
      return '保存中…';
    case 'saved':
      return save.quarantined ? '已保存（无法识别的旧数据已备份）' : '已保存';
    case 'failed':
      return `保存失败：${save.message}`;
  }
}
