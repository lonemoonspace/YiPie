// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ListView } from '@/contract/rpc';
import { EditableList } from '@/features/settings/editable-list';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Item {
  id: string;
  name: string;
}

const viewOf = (items: Item[]): ListView<Item> => ({
  items,
  defaultId: items[0]?.id ?? null,
  unrecognized: 0,
  status: 'ok',
  readOnly: false,
  quarantined: false,
  defaultFellBack: false,
  defaultUnreadable: false,
});

/** An editor that keeps what is typed in its own state, as the real forms do. */
function Editor({ item }: { item: Item | null }) {
  const [value, setValue] = useState(item?.name ?? '');
  return (
    <input aria-label="name" value={value} onChange={(event) => setValue(event.target.value)} />
  );
}

function List({ items }: { items: Item[] }) {
  const never = () => new Promise<ListView<Item>>(() => undefined);
  return (
    <EditableList<Item>
      kind="model"
      view={viewOf(items)}
      change={() => Promise.resolve(null)}
      busy={false}
      calls={{ remove: never, move: never, setDefault: never }}
      nameOf={(item) => item.name}
      details={() => null}
      editor={(item) => <Editor item={item} />}
    />
  );
}

let container: HTMLDivElement;
afterEach(() => container.remove());

/** Types into a React-controlled input. */
function type(input: HTMLInputElement, text: string) {
  // Through the prototype's setter, as a user's typing does: React watches the value.
  Reflect.set(HTMLInputElement.prototype, 'value', text, input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('EditableList', () => {
  it('keeps the draft of a row that was removed elsewhere while it was edited (#30)', () => {
    container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const a = { id: 'a', name: 'A' };
    const b = { id: 'b', name: 'B' };
    act(() => root.render(<List items={[a, b]} />));

    const edit = [...container.querySelectorAll<HTMLButtonElement>('li:first-child button')].find(
      (button) => button.textContent === '编辑',
    );
    act(() => edit?.click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="name"]');
    expect(input).not.toBeNull();
    act(() => type(input as HTMLInputElement, 'typed draft'));

    // Another tab removed it: the list is read again without it.
    act(() => root.render(<List items={[b]} />));

    const after = container.querySelector<HTMLInputElement>('input[aria-label="name"]');
    expect(after).toBe(input);
    expect(after?.value).toBe('typed draft');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('别处被删除');
    act(() => root.unmount());
  });
});
