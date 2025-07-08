"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

import "xterm/css/xterm.css";

export default function Term() {
  const terminalRef = useRef(null);

  useEffect(() => {
    const term = new Terminal();
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current!);
    fitAddon.fit();
    term.focus();

    // NOTE: (peterp): This is a direct connection to the sandbox, not via the vite proxy.
    // This is fine because we'll likely be using a different port once containers are supported
    // in cloudflare-vite plugin.
    const socket = new WebSocket("ws://localhost:8911/tty/attach");
    socket.onerror = (event) => {
      console.log("socket error", event);
    };
    socket.onopen = () => {
      console.log("socket opened");
    };
    socket.onclose = (event) => {
      console.log("socket closed", event);
    };

    socket.addEventListener("open", () => {
      console.log("socket opened");

      term.onData((data) => {
        socket.send(data);
      });

      socket.addEventListener("message", (event) => {
        term.write(event.data);
      });
    });

    return () => {
      term.dispose();
      socket.close();
    };
  }, []);

  return <div ref={terminalRef} style={{ height: "100%", width: "100%" }} />;
}
