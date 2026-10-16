import { useEffect, useReducer, useState } from 'react';
import { GENERAL_SETTINGS_KEY } from '@/contract/general-settings';
import type { Locale } from '@/contract/rpc-wire';
import { locale as currentLocale } from '@/domain/i18n';
import { applyLocale } from '@/features/i18n/locale';
import { applyFontSize, applyTheme } from '@/features/theme/apply-theme';
import { streamChat } from '@/platform/llm/client';
import { callRpc } from '@/platform/rpc/client';
import { onStoredChange } from '@/platform/storage/watch';
import { answerLanguageName } from './answer-language';
import { createConversation, type Conversation } from './conversation';
import { INITIAL_PANEL_STATE, reducePanel, type PanelState } from './state';

export interface PanelControls extends Omit<Conversation, 'open' | 'dispose'> {
  state: PanelState;
  /** The interface language, for what renders once and keeps its words (finished turns). */
  locale: Locale;
  /** The page text as the extension reads it, for the copy button. */
  pageText: () => Promise<string>;
  /** Finds a quote in the page and shows it there; resolves to whether it was found. */
  locate: (quote: string) => Promise<boolean>;
}

const pageText = async () => (await callRpc('page.getContext', {})).text;
const locate = async (quote: string) => (await callRpc('page.locate', { quote })).found;

/**
 * The panel's whole life: attach with the nonce in our URL, then restore this
 * page's conversation or summarize the page right away
 * (docs/development-plan.md §4.2 decision 3, §4.4 decision 3).
 */
export function usePanel(): PanelControls {
  const [state, dispatch] = useReducer(reducePanel, INITIAL_PANEL_STATE);
  const [locale, setLocaleState] = useState<Locale>(currentLocale);
  const [conversation] = useState(() =>
    createConversation({
      // The defaults of both lists and the trimming strategy: the panel always
      // uses what the settings say. Of the models it gets only the menu and
      // the one in use, key included.
      setup: async () => {
        const [models, prompts, settings] = await Promise.all([
          callRpc('models.current', {}),
          callRpc('prompts.list', {}),
          callRpc('settings.current', {}),
        ]);
        return {
          choices: models.choices,
          config: models.current,
          prompt: prompts.items.find((item) => item.id === prompts.defaultId) ?? null,
          prompts: prompts.items.map(({ id, name }) => ({ id, name })),
          promptId: prompts.defaultId,
          trimming: settings.trimming,
          answerLanguage: settings.answerLanguage,
          autoSummarize: settings.autoSummarize,
        };
      },
      restore: () => callRpc('snapshot.get', {}),
      extract: () => callRpc('page.getContext', {}),
      stream: (request) => streamChat(request),
      save: (messages, revision) => callRpc('snapshot.save', { messages, revision }),
      choose: (id) => callRpc('models.choose', { id }),
      choosePrompt: (id) => callRpc('prompts.choose', { id }),
      disableStreamUsage: (id) => callRpc('models.disableStreamUsage', { id }),
      dispatch,
      language: answerLanguageName,
      frame: (flush) => {
        const id = requestAnimationFrame(flush);
        return () => cancelAnimationFrame(id);
      },
    }),
  );

  useEffect(() => {
    let active = true;
    let unwatch = () => {};
    // Theme, reading size and language follow the settings, also when they
    // change while the panel is open.
    const appearance = () => {
      callRpc('settings.current', {}).then(
        ({ theme, fontSize, locale: next }) => {
          if (!active) return;
          applyTheme(theme);
          applyFontSize(fontSize);
          applyLocale(next);
          setLocaleState(next);
        },
        () => undefined,
      );
    };
    const nonce = window.location.hash.slice(1);
    callRpc('panel.attach', { nonce }).then(
      ({ mode }) => {
        if (!active) return;
        appearance();
        unwatch = onStoredChange([GENERAL_SETTINGS_KEY], appearance);
        void conversation.open(mode);
      },
      () => {
        if (active) dispatch({ type: 'failed', problem: { kind: 'attach' } });
      },
    );
    return () => {
      active = false;
      unwatch();
      conversation.dispose();
    };
  }, [conversation]);

  const { summarize, ask, retry, stop, switchModel, switchPrompt } = conversation;
  return {
    state,
    locale,
    summarize,
    ask,
    retry,
    stop,
    switchModel,
    switchPrompt,
    pageText,
    locate,
  };
}
