import { useEffect, useId, useRef, useState } from 'react';
import { MAX_MENU_MODELS } from '@/contract/model-config';
import { t } from '@/domain/i18n';
import { isLocalOriginRefusal, type LlmError } from '@/domain/llm/errors';
import { chatModels, LOCAL_SERVERS } from '@/domain/onboarding';
import { listModels } from '@/platform/llm/client';
import { requestOriginsAccess } from '@/platform/permissions/origin-access';
import { saveFirstModel } from './save-model';

/** What one local server said when asked for its models. */
type Found =
  | { kind: 'models'; models: string[] }
  /** Not running, or not at its default address. */
  | { kind: 'absent' }
  | { kind: 'refused'; error: LlmError };

interface ServerResult {
  name: string;
  baseURL: string;
  found: Found;
}

type Detection =
  { kind: 'idle' } | { kind: 'detecting' } | { kind: 'done'; servers: ServerResult[] };

/** How long a server that is not there may take to say so. */
const DETECT_TIMEOUT = 5_000;

/**
 * Local models (docs/development-plan.md §4.8): asks for access to the local
 * servers' addresses only when the user presses Detect, then lists the
 * models each one has downloaded. A pick is saved with the server's other
 * models in the panel's menu.
 */
export function LocalSetup({ onDone }: { onDone: (name: string) => void }) {
  const [detection, setDetection] = useState<Detection>({ kind: 'idle' });
  const [choice, setChoice] = useState<{ baseURL: string; model: string } | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | { failed: string }>('idle');
  const run = useRef<AbortController | null>(null);
  const groupId = useId();

  useEffect(() => () => run.current?.abort(), []);

  const detect = () => {
    // Still inside the click: one prompt for both addresses.
    const access = requestOriginsAccess(LOCAL_SERVERS.map((server) => server.baseURL));
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setDetection({ kind: 'detecting' });
    setChoice(null);
    setSaving('idle');
    void (async () => {
      await access.catch(() => false);
      const servers = await Promise.all(
        LOCAL_SERVERS.map(async (server): Promise<ServerResult> => {
          const outcome = await listModels({
            config: { baseURL: server.baseURL, apiKey: '', headers: {} },
            signal: controller.signal,
            timeout: DETECT_TIMEOUT,
          });
          const origin = new URL(server.baseURL).origin;
          const found: Found =
            outcome.kind === 'listed'
              ? { kind: 'models', models: chatModels(outcome.models) }
              : outcome.kind === 'error' && isLocalOriginRefusal(outcome.error, origin)
                ? { kind: 'refused', error: outcome.error }
                : { kind: 'absent' };
          return { ...server, found };
        }),
      );
      if (controller.signal.aborted) return;
      setDetection({ kind: 'done', servers });
      const first = servers.find(
        (server) => server.found.kind === 'models' && server.found.models.length > 0,
      );
      if (first !== undefined && first.found.kind === 'models' && first.found.models[0]) {
        setChoice({ baseURL: first.baseURL, model: first.found.models[0] });
      }
    })();
  };

  const save = () => {
    if (choice === null || detection.kind !== 'done') return;
    const server = detection.servers.find((candidate) => candidate.baseURL === choice.baseURL);
    if (server === undefined) return;
    const models = server.found.kind === 'models' ? server.found.models : [];
    // The server's other models go in the panel's menu, as many as it holds.
    const menuModels = models.length > 1 ? models.slice(0, MAX_MENU_MODELS) : [];
    if (menuModels.length > 0 && !menuModels.includes(choice.model)) {
      menuModels[menuModels.length - 1] = choice.model;
    }
    setSaving('saving');
    saveFirstModel({
      name: server.name,
      baseURL: server.baseURL,
      apiKey: '',
      model: choice.model,
      menuModels,
    }).then(onDone, (error: unknown) =>
      setSaving({ failed: error instanceof Error ? error.message : String(error) }),
    );
  };

  const anyModels =
    detection.kind === 'done' &&
    detection.servers.some(
      (server) => server.found.kind === 'models' && server.found.models.length > 0,
    );

  return (
    <div className="setup" data-path="local">
      <p className="intro">{t('welcome.local.intro')}</p>
      <div className="actions">
        <button type="button" disabled={detection.kind === 'detecting'} onClick={detect}>
          {detection.kind === 'detecting'
            ? t('welcome.local.detecting')
            : t('welcome.local.detect')}
        </button>
      </div>
      <div aria-live="polite" className="setup-result" data-result={detection.kind}>
        {detection.kind === 'done' ? (
          <>
            {detection.servers.map((server) => (
              <p key={server.baseURL} data-server={server.name}>
                {describeServer(server)}
              </p>
            ))}
            {anyModels ? null : <p>{t('welcome.local.none')}</p>}
          </>
        ) : null}
      </div>

      {anyModels && detection.kind === 'done' ? (
        <fieldset className="services local-models">
          <legend>{t('welcome.local.pick')}</legend>
          {detection.servers.flatMap((server) =>
            server.found.kind === 'models'
              ? server.found.models.map((model) => {
                  const checked = choice?.baseURL === server.baseURL && choice.model === model;
                  return (
                    <label
                      key={`${server.baseURL} ${model}`}
                      className="service"
                      data-checked={checked}
                    >
                      <input
                        type="radio"
                        name={groupId}
                        checked={checked}
                        onChange={() => setChoice({ baseURL: server.baseURL, model })}
                      />
                      <span className="service-name">{model}</span>
                      <span className="hint">{server.name}</span>
                    </label>
                  );
                })
              : [],
          )}
        </fieldset>
      ) : null}

      {anyModels ? (
        <div className="actions">
          <button type="button" disabled={choice === null || saving === 'saving'} onClick={save}>
            {saving === 'saving' ? t('model.saving') : t('welcome.local.save')}
          </button>
          {typeof saving === 'object' ? (
            <p role="alert" className="error">
              {t('settings.saveFailed', { detail: saving.failed })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function describeServer(server: ServerResult): string {
  switch (server.found.kind) {
    case 'models':
      return server.found.models.length === 0
        ? t('welcome.local.empty', { name: server.name })
        : t('welcome.local.found', { name: server.name, count: server.found.models.length });
    case 'absent':
      return t('welcome.local.absent', { name: server.name });
    case 'refused':
      return `${t('welcome.local.refused', { name: server.name })} ${t('error.hint.localOrigin')}`;
  }
}
