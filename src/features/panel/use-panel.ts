import { useEffect, useReducer, useState } from 'react';
import { GENERAL_SETTINGS_KEY } from '@/contract/general-settings';
import { applyFontSize, applyTheme } from '@/features/theme/apply-theme';
import { streamChat } from '@/platform/llm/client';
import { callRpc } from '@/platform/rpc/client';
import { onStoredChange } from '@/platform/storage/watch';
import { answerLanguageName } from './answer-language';
import { createConversation, type Conversation } from './conversation';
import { INITIAL_PANEL_STATE, reducePanel, type PanelState } from './state';

export interface PanelControls extends Omit<Conversation, 'open' | 'dispose'> {
  state: PanelState;
  /** The page text as the extension reads it, for the copy button. */
  pageText: () => Promise<string>;
}

const pageText = async () => (await callRpc('page.getContext', {})).text;

/**
 * The panel's whole life: attach with the nonce in our URL, then restore this
 * page's conversation or summarize the page right away
 * (docs/development-plan.md §4.2 decision 3, §4.4 decision 3).
 */
export function usePanel(): PanelControls {
  const [state, dispatch] = useReducer(reducePanel, INITIAL_PANEL_STATE);
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
          trimming: settings.trimming,
          answerLanguage: settings.answerLanguage,
        };
      },
      restore: () => callRpc('snapshot.get', {}),
      extract: () => callRpc('page.getContext', {}),
      stream: (request) => streamChat(request),
      save: (messages, revision) => callRpc('snapshot.save', { messages, revision }),
      choose: (id) => callRpc('models.choose', { id }),
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
    // Theme and reading size follow the settings, also when they change
    // while the panel is open.
    const appearance = () => {
      callRpc('settings.current', {}).then(
        ({ theme, fontSize }) => {
          if (!active) return;
          applyTheme(theme);
          applyFontSize(fontSize);
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

  const { summarize, ask, retry, stop, switchModel } = conversation;
  return { state, summarize, ask, retry, stop, switchModel, pageText };
}
