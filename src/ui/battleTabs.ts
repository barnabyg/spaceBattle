import { el } from './el';

/** Persistent panels keep input values and scroll positions when switching tabs. */
export const createBattleTabs = (entries: readonly { name: string; content: HTMLElement }[]) => {
  const panels = entries.map(({ content }, index) =>
    el(
      'div',
      {
        className: 'battle-tab-panel',
        attrs: {
          id: `battle-panel-${index}`,
          role: 'tabpanel',
          'aria-labelledby': `battle-tab-${index}`,
          tabindex: '0',
        },
      },
      content,
    ),
  );
  const select = (index: number, focus: boolean) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      const panel = panels[i];
      if (panel) panel.hidden = i !== index;
    });
    if (focus) tabs[index]?.focus();
  };
  const tabs = entries.map(({ name }, index) => {
    const tab = el('button', {
      text: name,
      attrs: {
        id: `battle-tab-${index}`,
        type: 'button',
        role: 'tab',
        'aria-controls': `battle-panel-${index}`,
      },
    });
    tab.addEventListener('click', () => {
      select(index, false);
    });
    tab.addEventListener('keydown', (event) => {
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % entries.length
          : event.key === 'ArrowLeft'
            ? (index + entries.length - 1) % entries.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? entries.length - 1
                : null;
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      select(next, true);
    });
    return tab;
  });
  select(0, false);
  return el(
    'div',
    { className: 'battle-tabs' },
    el(
      'div',
      { className: 'battle-tab-list', attrs: { role: 'tablist', 'aria-label': 'Battle controls' } },
      ...tabs,
    ),
    ...panels,
  );
};
