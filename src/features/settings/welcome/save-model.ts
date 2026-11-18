import type { ModelConfigDraft } from '@/contract/model-config';
import { callRpc } from '@/platform/rpc/client';

/**
 * Adds the configuration the first-run page set up and makes it the default,
 * so the next panel uses it whatever was there before. Resolves to the name
 * the panel's menu shows.
 */
export async function saveFirstModel(draft: ModelConfigDraft): Promise<string> {
  const view = await callRpc('models.add', draft);
  const added = view.items.at(-1);
  if (added !== undefined && view.defaultId !== added.id) {
    await callRpc('models.setDefault', { id: added.id });
  }
  return draft.name !== undefined && draft.name !== '' ? draft.name : draft.model;
}
