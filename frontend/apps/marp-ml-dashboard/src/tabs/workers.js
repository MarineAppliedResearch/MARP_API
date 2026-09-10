/* Placeholder. Replaced by the agent drawing this tab. */
import { h } from '../lib/dom.js';
import { panel } from '../lib/parts.js';

export const meta = { id: 'workers', title: 'workers', subtitle: 'not drawn yet' };

export function render() {
  return panel({ title: 'Not drawn yet' }, h('p', { class: 'muted' }, 'This tab is being drawn.'));
}
