/**
 * The app-wide search bar: built once and mounted in the app shell above the
 * nav, so it never gets torn down by a view re-render (which is what used to
 * drop focus/caret when it lived inside rankList.render()). Owns only the
 * input; main.ts owns the query and decides what each keystroke does.
 */
export type SearchBarDeps = {
  onInput: (query: string) => void;
  /** Esc or the clear button. */
  onClear: () => void;
};

export type SearchBar = {
  element: HTMLElement;
  /** Sets the input's text without firing onInput (e.g. after a search
   *  result is rated and the query resets). */
  setValue: (value: string) => void;
};

export function createSearchBar(deps: SearchBarDeps): SearchBar {
  const wrap = document.createElement('div');
  wrap.className = 'app-search';
  wrap.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'app-search-input';
  input.placeholder = 'Search albums or bands';
  input.setAttribute('aria-label', 'Search your albums or bands');
  input.autocomplete = 'off';
  input.spellcheck = false;

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'app-search-clear';
  clearBtn.setAttribute('aria-label', 'Clear search');
  clearBtn.textContent = '×';
  clearBtn.hidden = true;

  const syncClear = (): void => {
    clearBtn.hidden = input.value === '';
  };

  input.addEventListener('input', () => {
    syncClear();
    deps.onInput(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value !== '') {
      event.preventDefault();
      deps.onClear();
    }
  });
  clearBtn.addEventListener('click', () => {
    deps.onClear();
    input.focus();
  });

  wrap.append(input, clearBtn);

  return {
    element: wrap,
    setValue: (value) => {
      input.value = value;
      syncClear();
    },
  };
}
