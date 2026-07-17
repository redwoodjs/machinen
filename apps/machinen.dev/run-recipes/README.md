# Machinen run recipes

Files in this directory are the reviewed source for `machinen.dev/run/*`.
They are declarative: install commands run inside a provisioning microVM, and
recipes can request only outbound networking, the current workspace, and named
state directories. State requested below guest `/root` mirrors the corresponding
path below the host home; state elsewhere is isolated below
`~/.machinen/run/state`. The `install` field is an array where each item becomes
one line in the provisioning shell script.

Before approval, the CLI discovers symlinks that leave home-backed state and
shows the additional linked roots as part of the effective host access. The
approved roots are mounted explicitly; a new link target requires fresh
approval. Recipes cannot inherit host environment variables or execute
JavaScript on the host. First-party coding-agent recipes bake in Git, CA
certificates, and the OpenSSH client so they can work with repositories without
changing the minimal base rootfs.

## Publishing a recipe

1. Add or edit a `<name>.json` file and review its requested capabilities.
2. Sign the complete registry with the offline Ed25519 key:

   ```bash
   MACHINEN_RUN_SIGNING_KEY=/secure/path/to/private.pem \
     pnpm -F @machinen/marketing-website recipes:sign
   ```

3. Verify and commit both the source and generated files in `public/run/`:

   ```bash
   pnpm -F @machinen/marketing-website recipes:verify
   ```

The private key must never be committed or stored in a deployment environment.
The CLI pins the matching public key and asks users to approve every new signed
recipe digest. Rotate keys by adding a new key ID to the CLI before signing any
published recipe with it.
