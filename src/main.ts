import { registerSW } from 'virtual:pwa-register';
import { defaultRide, normalizeRide, type Profile, type RideSettings } from './model/profile';
import { exportStore, importInto, loadStore, saveStore, seedStore, type Store } from './model/store';
import { h } from './ui/dom';
import { editView, listView, rideView, type App } from './ui/views';
import './style.css';

registerSW({ immediate: true });

const root = document.getElementById('app')!;

/** Blocked site storage throws on access: run with the seeds in memory instead. */
function initialStore(): { store: Store; storageError: boolean } {
  try {
    return { store: loadStore(localStorage), storageError: false };
  } catch {
    return { store: seedStore(), storageError: true };
  }
}
const initial = initialStore();
let store = initial.store;

function persist() {
  if (initial.storageError) return; // already told the user at startup
  try {
    saveStore(localStorage, store);
  } catch {
    toast('Could not save: storage is full or disabled.');
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

type Route = { name: 'list' } | { name: 'ride'; id: string } | { name: 'edit'; id: string } | { name: 'new' };

function parseRoute(hash: string): Route {
  const match = /^#\/(ride|edit)\/(.+)$/.exec(hash);
  if (match) return { name: match[1] as 'ride' | 'edit', id: decodeURIComponent(match[2]!) };
  if (hash === '#/new') return { name: 'new' };
  return { name: 'list' };
}

function isInApp(): boolean {
  return (history.state as { inApp?: boolean } | null)?.inApp === true;
}

const app: App = {
  profiles: () => store.profiles,
  profile: (id) => store.profiles.find((p) => p.id === id),
  ride: (profile: Profile) => store.rides[profile.id] ?? defaultRide(profile),
  setRide(id: string, ride: RideSettings) {
    store.rides[id] = ride;
    store.lastProfileId = id;
    persist();
  },
  saveProfile(profile: Profile) {
    const index = store.profiles.findIndex((p) => p.id === profile.id);
    if (index >= 0) store.profiles[index] = profile;
    else store.profiles.push(profile);
    const ride = store.rides[profile.id];
    if (ride) store.rides[profile.id] = normalizeRide(ride, profile);
    persist();
  },
  deleteProfile(id: string) {
    store.profiles = store.profiles.filter((p) => p.id !== id);
    delete store.rides[id];
    if (store.lastProfileId === id) store.lastProfileId = null;
    persist();
  },
  exportData() {
    const json = JSON.stringify(exportStore(store), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = h('a', { href: url, download: `tire-pressure-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async importData(file: File) {
    try {
      const result = importInto(store, await file.text());
      store = result.store;
      persist();
      toast(`Imported: ${result.added} new, ${result.updated} updated.`);
      render();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Import failed.');
    }
  },
  navigate(hash: string) {
    history.pushState({ inApp: true }, '', hash);
    render();
  },
  /** Go "up" to a parent screen: pop history if we came from it, else replace. */
  up(hash: string) {
    if (isInApp()) history.back();
    else app.replace(hash);
  },
  replace(hash: string) {
    history.replaceState(history.state, '', hash);
    render();
  },
  newId: () =>
    typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `bike-${Date.now()}-${Math.random().toString(36).slice(2)}`,
};

function render() {
  if (location.hash === '' && store.lastProfileId && app.profile(store.lastProfileId)) {
    history.replaceState(null, '', `#/ride/${encodeURIComponent(store.lastProfileId)}`);
  }
  const route = parseRoute(location.hash);
  let view: Node;
  switch (route.name) {
    case 'ride': {
      const profile = app.profile(route.id);
      if (!profile) return app.replace('#/');
      view = rideView(app, profile);
      break;
    }
    case 'edit': {
      const profile = app.profile(route.id);
      if (!profile) return app.replace('#/');
      view = editView(app, profile);
      break;
    }
    case 'new':
      view = editView(app, undefined);
      break;
    default:
      view = listView(app);
  }
  root.replaceChildren(view);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', render);
render();
if (initial.storageError) toast('Storage is disabled: changes will not be saved.');
