import { io } from "socket.io-client";

const socket = io(import.meta.env.VITE_API_BASE_URL, {
  transports: ["websocket"],
  autoConnect: true,
});

let socketStatus = "connecting";
let socketLastEvent = "Socket initializing";

socket.on("connect", () => {
  socketStatus = "connected";
  socketLastEvent = `Connected at ${new Date().toLocaleTimeString()}`;
});

socket.on("disconnect", (reason) => {
  socketStatus = "disconnected";
  socketLastEvent = `Disconnected: ${reason || "unknown"} at ${new Date().toLocaleTimeString()}`;
});

socket.on("connect_error", (err) => {
  socketStatus = "error";
  socketLastEvent = `Connection error: ${err?.message || "unknown"} at ${new Date().toLocaleTimeString()}`;
});

socket.io.on("reconnect_attempt", (attempt) => {
  socketStatus = "reconnecting";
  socketLastEvent = `Reconnecting attempt ${attempt} at ${new Date().toLocaleTimeString()}`;
});

export function getSocket() {
  return socket;
}

export function getSocketStatus() {
  return socketStatus;
}

export function getSocketLastEvent() {
  return socketLastEvent;
}
