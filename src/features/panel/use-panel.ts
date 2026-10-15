import { useEffect, useReducer, useState } from 'react';
import { t } from '@/domain/i18n';
import { streamChat } from '@/platform/llm/client';
import { callRpc } from '@/platform/rpc/client';
import { createConversation, type Conversation } from './conversation';
import { INITIAL_PANEL_STATE, reducePanel, type PanelState } from './state';

export interface PanelControls extends Omit<Conversation, 'open' | 'dispose'> {
  state: PanelState;
}

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
        };
      },
      restore: () => callRpc('snapshot.get', {}),
      extract: () => callRpc('page.getContext', {}),
      stream: (request) => streamChat(request),
      save: (messages, revision) => callRpc('snapshot.save', { messages, revision }),
      choose: (id) => callRpc('models.choose', { id }),
      dispatch,
      language: t('prompt.answerLanguage'),
      frame: (flush) => {
        const id = requestAnimationFrame(flush);
        return () => cancelAnimationFrame(id);
      },
    }),
  );

  useEffect(() => {
    let active = true;
    const nonce = window.location.hash.slice(1);
    callRpc('panel.attach', { nonce }).then(
      () => {
        if (active) void conversation.open();
      },
      () => {
        if (active) dispatch({ type: 'failed', problem: { kind: 'attach' } });
      },
    );
    return () => {
      active = false;
      conversation.dispose();
    };
  }, [conversation]);

  const { summarize, ask, retry, stop, switchModel } = conversation;
  return { state, summarize, ask, retry, stop, switchModel };
}
