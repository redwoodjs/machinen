# Machinen, by RedwoodSDK

_Note: This is a preview, it does not ship to production yet. (But should by 01-July-2025.)_

Machinen is a browser-based text editor that connects to a Cloudflare-hosted Docker instance running Vite and RedwoodSDK.
It gives developers a development environment in the cloud, designed for agentic workflows: Each workflow runs in its own isolated container, making it easy to edit, review, and merge changes independently of each other. Developers should self-host Machinen in their own Cloudflare environment.

## Quickstart

You must have Docker running.

```bash
pnpm install
pnpm dev
```

Note: The docker instance will not start automatically, we're waiting on Cloudflare. (Peter to provide instructions.)

For local development, you can "emulate the Docker instance:"

```bash
cd container
pnpm install
pnpm dev:all
```

By running the "container dev-server" as well as the "editor dev-server" you can emulate the live experience.

## TODO:

- [ ] Persist changes outside of Container: Sync to GitHub or Cloudflare R2.
- [ ] Integrate Claude Code, later Cloudflare agents.
- [ ] RAG the code.
- [ ] Reduce container size: Currently 1GB.
- [ ] When building the container use the latest RWSDK.

## Shortcomings:

- Our editor is complete trash. We will improve it.
  - We want you to be able to directly communicate with the container via VSCode Dev Containers.
- Changes are not yet persisted. They will either save to GitHub or R2 or both.

## Licensing:

This is released under the FSL license.
