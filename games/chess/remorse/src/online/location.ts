export const LAST_ROOM_KEY = 'remorse-online-room-v1';

export function onlineLocation(hash: string): { roomId: string; invite?: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const roomId = params.get('room');
  if (!roomId || !/^[A-Za-z0-9_-]{8,100}$/.test(roomId)) return null;
  const invite = params.get('invite');
  return { roomId, ...(invite && /^[A-Za-z0-9_-]{16,200}$/.test(invite) ? { invite } : {}) };
}

export function roomLink(roomId: string, invite?: string, base = window.location.href): string {
  const url = new URL(base);
  url.hash = new URLSearchParams({ room: roomId, ...(invite ? { invite } : {}) }).toString();
  return url.href;
}

export function rememberRoom(roomId: string) {
  try { localStorage.setItem(LAST_ROOM_KEY, roomId); } catch { /* A cookie still restores the seat. */ }
  if (typeof window !== 'undefined') history.replaceState(null, '', roomLink(roomId));
}

export function lastRoom(): string | null {
  try { return localStorage.getItem(LAST_ROOM_KEY); } catch { return null; }
}

export function clearRoomLocation() {
  if (typeof window !== 'undefined' && onlineLocation(location.hash)) {
    const url = new URL(location.href); url.hash = ''; history.replaceState(null, '', url);
  }
}
