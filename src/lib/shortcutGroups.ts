import type { ActionName } from '../../shared/config.ts';

export interface ShortcutGroup {
  title: string;
  actions: { action: ActionName; label: string }[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Panes',
    actions: [
      { action: 'splitRight', label: 'Split pane to the right' },
      { action: 'splitDown', label: 'Split pane below' },
      { action: 'closePane', label: 'Close the active pane' },
      { action: 'zoomPane', label: 'Zoom / un-zoom the active pane' },
      { action: 'equalizePanes', label: 'Give every pane the same size' },
      { action: 'focusNext', label: 'Focus the next pane' },
      { action: 'focusLeft', label: 'Focus the pane to the left' },
      { action: 'focusRight', label: 'Focus the pane to the right' },
      { action: 'focusUp', label: 'Focus the pane above' },
      { action: 'focusDown', label: 'Focus the pane below' },
    ],
  },
  {
    title: 'Tabs',
    actions: [
      { action: 'newTab', label: 'New tab' },
      { action: 'closeTab', label: 'Close the tab' },
      { action: 'prevTab', label: 'Previous tab' },
      { action: 'nextTab', label: 'Next tab' },
    ],
  },
  {
    title: 'View',
    actions: [
      { action: 'fontUp', label: 'Increase font size' },
      { action: 'fontDown', label: 'Decrease font size' },
      { action: 'fontReset', label: 'Reset font size' },
      { action: 'transparencyUp', label: 'Increase window transparency' },
      { action: 'transparencyDown', label: 'Decrease window transparency' },
      { action: 'toggleTheme', label: 'Cycle theme' },
      { action: 'find', label: 'Find in scrollback' },
      { action: 'workspace', label: 'Open the code workspace' },
      { action: 'clearBuffer', label: 'Clear the buffer' },
      { action: 'help', label: 'Show the shortcut list' },
      { action: 'settings', label: 'Open settings' },
    ],
  },
];

export const ACTION_LABELS = Object.fromEntries(
  SHORTCUT_GROUPS.flatMap((group) => group.actions.map(({ action, label }) => [action, label])),
) as Record<ActionName, string>;
