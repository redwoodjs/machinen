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

      // Try direct connection to sandbox server first
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let socketUrl;
      
      // If accessing from localhost:5173, connect directly to sandbox server
      if (window.location.port === '5173') {
        socketUrl = 'ws://localhost:8911/tty/attach';
      } else {
        // Otherwise use the proxy
        socketUrl = `${protocol}//${window.location.host}/sandbox/tty/attach`;
      }
      
      console.log("Terminal connecting to:", socketUrl);
      console.log("Current location:", window.location.href);
      const socket = new WebSocket(socketUrl);
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
