import { io, Socket } from "socket.io-client";

let socketInstance: Socket | null = null;

export function getEntranceSocket(): Socket {
  if (!socketInstance) {
    let url: string | undefined = undefined;
    if (typeof window !== "undefined") {
      // In standalone dev server on port 3000, target backend with matching protocol
      if (window.location.port === "3000") {
        const protocol = window.location.protocol === "https:" ? "https:" : "http:";
        url = `${protocol}//${window.location.hostname}:5000`;
      }
      // In production (port 80/443 Nginx or standalone build), url remains undefined to use current origin
    }
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

