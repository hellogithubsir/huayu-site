import { loadCatalogue } from '../shared/assets.js?v=entry-first-20261112';

export async function loadMediaItems() {
  const items = await loadCatalogue({ group: 'media' });
  return items.map(item => ({ ...item, animationId: item.id }));
}
