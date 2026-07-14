# Machinen run recipes

Files in this directory are the reviewed source for `machinen.dev/run/*`.
They are declarative: install commands run inside a provisioning microVM, and
recipes can request only outbound networking, the current workspace, and named
state directories managed below `~/.machinen/run/state`.

A recipe cannot select arbitrary host paths, inherit host environment variables,
or execute JavaScript on the host.

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
