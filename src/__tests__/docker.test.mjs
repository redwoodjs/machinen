import { describe, it, expect } from "vitest";
import { captureContainerConfig } from "../docker.mjs";

describe("captureContainerConfig", () => {
  it("extracts the right fields from docker inspect output", () => {
    const info = {
      Config: {
        Image: "ubuntu:24.04",
        Cmd: ["bash", "-c", "echo hello"],
        Env: ["PATH=/usr/bin", "HOME=/root", "MY_VAR=test"],
        WorkingDir: "/app",
        ExposedPorts: { "8080/tcp": {} },
      },
      HostConfig: {
        SecurityOpt: ["seccomp=unconfined"],
        NetworkMode: "host",
        Binds: ["/tmp:/tmp"],
        CapAdd: ["SYS_PTRACE"],
        Privileged: false,
      },
    };

    const config = captureContainerConfig(info);

    expect(config).toEqual({
      Image: "ubuntu:24.04",
      Cmd: ["bash", "-c", "echo hello"],
      Env: ["PATH=/usr/bin", "HOME=/root", "MY_VAR=test"],
      WorkingDir: "/app",
      ExposedPorts: { "8080/tcp": {} },
      SecurityOpt: ["seccomp=unconfined"],
      NetworkMode: "host",
      Binds: ["/tmp:/tmp"],
      CapAdd: ["SYS_PTRACE"],
      Privileged: false,
    });
  });

  it("handles null/undefined fields", () => {
    const info = {
      Config: {
        Image: "alpine",
        Cmd: null,
        Env: null,
        WorkingDir: "",
        ExposedPorts: null,
      },
      HostConfig: {
        SecurityOpt: null,
        NetworkMode: "bridge",
        Binds: null,
        CapAdd: null,
        Privileged: false,
      },
    };

    const config = captureContainerConfig(info);

    expect(config.Image).toBe("alpine");
    expect(config.Cmd).toBeNull();
    expect(config.Env).toBeNull();
    expect(config.NetworkMode).toBe("bridge");
    expect(config.Binds).toBeNull();
  });
});
