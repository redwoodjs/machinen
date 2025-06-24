# Machinen by RedwoodSDK

_Note: This is a preview release._

Machinen is a browser-based text-editor that communicates with a Docker instance (in Cloudflare). The Docker instance runs Vite and RedwoodSDK.
The point of this is to give developers a development environment that can facilitate agentic workflows. A new Docker instance can be created for each "agentic workflow" so that code modifications can be handled, reviewed, and merged independently.

## Quickstart

You must have Docker running.

```bash
pnpm install
pnpm dev
```

Note: The docker instance will not start automatically, we're waiting on Cloudflare. (Peter to provide instructions.)

## TODO:

- [ ] Persist changes outside of Container: Sync to GitHub or Cloudflare R2.
- [ ] Integrate Claude Code.
- [ ] Reduce container size: Currently 1GB.
- [ ] When building the container use the latest RWSDK.

## Shortcomings:

- Our editor is complete trash. We will improve it.
  - We want you to be able to directly communicate with the container via VSCode Dev Containers.
- Changes are not yet persisted. They will either save to GitHub or R2 or both.

## Licensing:

This is released under the FSL license.
