"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

export default function TerminalComponent() {
  const terminalRef = useRef(null);

  useEffect(() => {
    const term = new Terminal();
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current!);
    fitAddon.fit();
    term.focus();

    const socket = new WebSocket("ws://localhost:8911/tty/attach");
    socket.onerror = (event) => {
      console.log("error", event);
    };
    socket.onopen = () => {
      console.log("socket opened");
    };
    socket.onmessage = (event) => {
      console.log("message", event.data);
      term.write(event.data);
    };
    socket.onclose = (event) => {
      console.log("event", event);
      console.log("socket closed, why did it close?");
    };

    socket.addEventListener("open", () => {
      console.log("socket opened");
      // Manual hook-up (replace AttachAddon):
      term.onData((data) => {
        console.log("data", data);
        socket.send(data);
      });
      socket.addEventListener("message", (event) => {
        console.log("message", event.data);
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
