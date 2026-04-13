import { useEffect, useState } from "react";
import { getSocket, getSocketLastEvent, getSocketStatus } from "../services/socket.service";

export function useSocketStatus() {
  const [status, setStatus] = useState(getSocketStatus());
  const [lastEvent, setLastEvent] = useState(getSocketLastEvent());

  useEffect(() => {
    const socket = getSocket();

    const update = () => {
      setStatus(getSocketStatus());
      setLastEvent(getSocketLastEvent());
    };

    socket.on("connect", update);
    socket.on("disconnect", update);
    socket.on("connect_error", update);
    socket.io.on("reconnect_attempt", update);

    return () => {
      socket.off("connect", update);
      socket.off("disconnect", update);
      socket.off("connect_error", update);
      socket.io.off("reconnect_attempt", update);
    };
  }, []);

  return { status, lastEvent };
}
