"use client";

import { useEffect, useRef } from "react";

import "xterm/css/xterm.css";

export default function Term() {
  const terminalRef = useRef(null);

  useEffect(() => {
    async function init() {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");

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
    }

    init();
  }, []);

  return <div ref={terminalRef} />;
}
