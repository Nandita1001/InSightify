/**
 * Realtime helpers — wraps the Socket.IO instance so services can emit events
 * without importing the http server. The instance is set once in server.js
 * after the socket layer is attached.
 */

let _io = null;

export function setIO(io) {
  _io = io;
}

export function getIO() {
  return _io;
}

/**
 * Broadcast an event to all currently connected (authenticated) sockets.
 * No-op if the socket layer hasn't been attached yet (e.g. during tests).
 */
export function broadcast(event, payload) {
  if (_io) _io.emit(event, payload);
}
