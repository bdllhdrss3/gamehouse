export function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch (error) {
    console.error('Local storage is unavailable.', error);
    window.dispatchEvent(new CustomEvent('storage-error', { detail: 'Device storage is unavailable. Settings and local games cannot be saved.' }));
    return null;
  }
}
export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (error) {
    console.error('Could not save to device storage.', error);
    window.dispatchEvent(new CustomEvent('storage-error', { detail: 'Could not save to this device. Free some storage to keep your game after refresh.' }));
  }
}
