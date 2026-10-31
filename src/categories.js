export const UNCLASSIFIED = { id: null, name: 'Unclassified', color: '#8F9FB0' };
export const CATEGORY_COLORS = ['#7FAAF5', '#C29DEB', '#80CF97', '#F1C578', '#75D2DA', '#EB848E'];
export const categoriesOf = activity => activity?.categories ?? [];
export const categoryOf = (activity, id) => categoriesOf(activity).find(category => category.id === id) ?? UNCLASSIFIED;

export function normalizeHexColor(value) {
  const text = String(value).trim();
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(text)) throw new Error('Use a hex colour, e.g. #7FAAF5 or #ABC.');
  return (text.length === 4 ? '#' + [...text.slice(1)].map(char => char + char).join('') : text).toUpperCase();
}

export function configureCategory(activity, id, settings) {
  const categories = categoriesOf(activity);
  const existing = id == null ? null : categories.find(category => category.id === id);
  if (id != null && !existing) throw new Error('This category no longer exists.');
  const name = String(settings.name ?? existing?.name ?? '').trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) throw new Error('Use a category name of 1–40 characters.');
  if (name.toLowerCase() === UNCLASSIFIED.name.toLowerCase()) throw new Error('Unclassified is reserved for untagged logs.');
  if (categories.some(category => category !== existing && category.name.toLowerCase() === name.toLowerCase())) throw new Error('A category with that name already exists.');
  const color = normalizeHexColor(settings.color ?? existing?.color ?? CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]);
  if (existing) {
    Object.assign(existing, { name, color });
    return existing;
  }
  const nextId = Math.max(activity.nextCategoryId ?? 1, ...categories.map(category => category.id + 1));
  if (!Number.isSafeInteger(nextId) || nextId < 1) throw new Error('Invalid next category ID.');
  const category = { id: nextId, name, color, archived: false };
  activity.categories = [...categories, category];
  activity.nextCategoryId = nextId + 1;
  return category;
}

export function archiveCategory(activity, id, archived = true) {
  const category = categoriesOf(activity).find(item => item.id === id);
  if (!category) throw new Error('This category no longer exists.');
  category.archived = archived;
  return category;
}

export function findCategory(activity, name) {
  const category = categoriesOf(activity).find(item => item.name.toLowerCase() === String(name).toLowerCase());
  if (!category) throw new Error(`Unknown category '${name}' for ${activity.name}.`);
  return category;
}

export function validateCategory(activity, id, allowArchived = false) {
  if (id == null) return;
  const category = categoriesOf(activity).find(item => item.id === id);
  if (!category) throw new Error('Choose a category from this journey.');
  if (category.archived && !allowArchived) throw new Error('This category is archived. Choose another.');
}
