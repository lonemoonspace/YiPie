import { useEffect, useState } from 'react';
import { t, type MessageKey } from '@/domain/i18n';
import { FREE_SERVICES, KEY_SERVICES, type StartService } from '@/domain/onboarding';
import { START_PATHS, type StartPath } from '@/domain/welcome-hash';
import { KeySetup } from './key-setup';
import { LocalSetup } from './local-setup';

/** The line under each free service: what its free allowance covers. */
const FREE_NOTES: Partial<Record<string, MessageKey>> = {
  'zhipu-free': 'welcome.free.note.zhipu',
  'siliconflow-free': 'welcome.free.note.siliconflow',
  'openrouter-free': 'welcome.free.note.openrouter',
  'groq-free': 'welcome.free.note.groq',
  'gemini-free': 'welcome.free.note.gemini',
};

const freeNote = (service: StartService) => {
  const key = FREE_NOTES[service.id];
  return key === undefined ? '' : t(key);
};

const PATH_LABELS: Record<StartPath, { title: MessageKey; detail: MessageKey }> = {
  key: { title: 'welcome.path.key', detail: 'welcome.path.key.detail' },
  free: { title: 'welcome.path.free', detail: 'welcome.path.free.detail' },
  local: { title: 'welcome.path.local', detail: 'welcome.path.local.detail' },
};

interface StartPathsProps {
  /** The path open at first; none when null. */
  initial: StartPath | null;
  onDone: (name: string) => void;
}

/**
 * The three ways to a first model (docs/development-plan.md §4.8): a key one
 * already has, a service with a free allowance, or a model on this machine.
 */
export function StartPaths({ initial, onDone }: StartPathsProps) {
  const [path, setPath] = useState<StartPath | null>(initial);

  return (
    <>
      <div className="paths" role="group" aria-label={t('welcome.paths')}>
        {START_PATHS.map((option) => (
          <button
            key={option}
            type="button"
            className="path"
            aria-pressed={option === path}
            data-path={option}
            onClick={() => setPath(option)}
          >
            <span className="path-title">{t(PATH_LABELS[option].title)}</span>
            <span className="path-detail">{t(PATH_LABELS[option].detail)}</span>
          </button>
        ))}
      </div>
      {path === 'key' ? <KeySetup key="key" services={KEY_SERVICES} onDone={onDone} /> : null}
      {path === 'free' ? (
        <KeySetup key="free" services={FREE_SERVICES} free note={freeNote} onDone={onDone} />
      ) : null}
      {path === 'local' ? <LocalSetup onDone={onDone} /> : null}
    </>
  );
}

/**
 * The page that opens once the extension is installed (`#welcome` on the
 * settings page): set up a first model, then learn the three ways to open
 * the panel. Everything else stays on the settings page.
 */
export function WelcomePage({ initial }: { initial: StartPath | null }) {
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${t('app.name')} · ${t('welcome.title')}`;
  }, []);

  return (
    <main className="page welcome">
      <header className="masthead">
        <div className="title">
          <img className="logo" src="/icon/48.png" alt="" width="28" height="28" />
          <span className="app-name">{t('app.name')}</span>
          <h1>{t('welcome.title')}</h1>
        </div>
      </header>
      <p className="intro">{t('welcome.intro')}</p>

      {done === null ? (
        <section className="card" aria-labelledby="start-heading">
          <h2 id="start-heading">{t('welcome.start')}</h2>
          <StartPaths initial={initial} onDone={setDone} />
        </section>
      ) : (
        <section className="card done" aria-labelledby="done-heading" role="status">
          <h2 id="done-heading">{t('welcome.done', { name: done })}</h2>
          <p>{t('welcome.done.detail')}</p>
        </section>
      )}

      <section className="card" aria-labelledby="use-heading">
        <h2 id="use-heading">{t('welcome.use')}</h2>
        <ul className="ways">
          <li>{t('welcome.use.icon')}</li>
          <li>{t('welcome.use.shortcut')}</li>
          <li>{t('welcome.use.menu')}</li>
        </ul>
        <p className="hint">{t('welcome.use.privacy')}</p>
      </section>

      <p>
        <a href="#model-heading">{t('welcome.settings')}</a>
      </p>
    </main>
  );
}
