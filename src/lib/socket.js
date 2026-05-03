/**
 * Singleton Socket.IO client.
 * connectSocket(token) opens (or reuses) a connection authenticated with the
 * current JWT. disconnectSocket() tears it down on logout.
 *
 * Subscribers register listeners via getSocket()?.on(event, handler).
 */

import { io } from "socket.io-client";
import { API_URL } from "./api.js";

let _socket = null;
let _currentToken = null;

export function connectSocket(token) {
  // Reuse an existing socket if the auth token hasn't changed — even if it's
  // mid-handshake. StrictMode double-mounts the effect in dev and would
  // otherwise tear down a connecting socket and lose listeners attached to it.
  if (_socket && _currentToken === token) return _socket;
  if (_socket) _socket.disconnect();

  _currentToken = token;
  _socket = io(API_URL, {
    auth: { token },
    reconnection: true,
  });

  _socket.on("connect",       () => console.log("[socket] connected", _socket.id));
  _socket.on("disconnect",    (reason) => console.log("[socket] disconnected:", reason));
  _socket.on("connect_error", (err) => console.warn("[socket] connect_error:", err.message));

  return _socket;
}

export function disconnectSocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
    _currentToken = null;
  }
}

export function getSocket() {
  return _socket;
}
