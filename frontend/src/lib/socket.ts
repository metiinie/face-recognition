import { io, Socket } from "socket.io-client";

let socketInstance: Socket | null = null;

export function getEntranceSocket(): Socket {
  if (!socketInstance) {
    const url =
      typeof window !== "undefined" && window.location.port === "3000"
        ? `http://${window.location.hostname}:5000`
        : undefined;
    socketInstance = io(url, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      autoConnect: false,
    });
  }
  return socketInstance;
}

