import { PROMPT_CONFIGS_KEY, type PromptConfig } from '@/contract/prompt-config';
import { t } from '@/domain/i18n';
import { changedFields } from '@/domain/patch';
import { distinctiveLine } from '@/domain/prompt-form';
import { callRpc } from '@/platform/rpc/client';
import { EditableList, type ListCalls } from './editable-list';
import { PromptForm } from './prompt-form';
import { describeStatus, useConfigList } from './use-config-list';

const loadPrompts = () => callRpc('prompts.list', {});

const calls: ListCalls<PromptConfig> = {
  remove: (id) => callRpc('prompts.remove', { id }),
  move: (id, direction) => callRpc('prompts.move', { id, direction }),
  setDefault: (id) => callRpc('prompts.setDefault', { id }),
};

const nameOf = (prompt: PromptConfig) => prompt.name.trim() || t('prompt.unnamed');

/** Prompts: a list with a default, edited only here (docs/development-plan.md §4.3). */
export function PromptSection() {
  const list = useConfigList(loadPrompts, PROMPT_CONFIGS_KEY);
  const { view, change } = list;
  const busy = list.status.kind === 'busy';

  return (
    <section className="card" aria-labelledby="prompt-heading">
      <h2 id="prompt-heading">{t('prompt.section')}</h2>
      <p className="intro">{t('prompt.intro')}</p>
      {list.loadError !== null ? (
        <p role="alert" className="notice">
          {t('settings.loadFailed', { detail: list.loadError })}
        </p>
      ) : view === null ? (
        <p>{t('settings.loading')}</p>
      ) : (
        <EditableList
          kind="prompt"
          view={view}
          change={change}
          busy={busy}
          calls={calls}
          nameOf={nameOf}
          details={(prompt) => (
            <span className="preview">
              {distinctiveLine(
                prompt,
                view.items.filter((other) => other.id !== prompt.id),
              )}
            </span>
          )}
          editor={(prompt, { focusOnOpen, close, cancel }) => (
            <PromptForm
              key={prompt?.id ?? 'new'}
              heading={
                prompt ? t('prompt.editHeading', { name: nameOf(prompt) }) : t('prompt.addHeading')
              }
              initial={prompt}
              saving={busy}
              readOnly={view.readOnly}
              focusOnOpen={focusOnOpen}
              onSave={(form) =>
                void change(
                  () =>
                    prompt === null
                      ? callRpc('prompts.add', form)
                      : callRpc('prompts.update', {
                          id: prompt.id,
                          patch: changedFields(prompt, form),
                        }),
                  () => t('list.saved'),
                ).then((saved) => saved && close())
              }
              onCancel={cancel}
            />
          )}
        />
      )}
      <p role="status" className="save-status">
        {describeStatus(list.status)}
      </p>
    </section>
  );
}
