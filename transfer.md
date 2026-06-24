# Setting Up Signing on a New Machine

How to enable signed release builds (and the auto-updater) on a computer that
has only just cloned/pulled this repo. Follow this when you want to deploy from
a machine other than the one where signing already works.

> **No secrets live in git.** The pull brings the *public* key only
> (`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, fingerprint
> `90B029FAEE6D6331`). The two secrets below must be carried over manually.

## What "signed" needs

| Secret | Location on disk | In git? |
|---|---|---|
| Private key | `C:\Users\<you>\.tauri\claude-launcher.key` | ❌ never |
| Key password | repo `.env` → `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | ❌ gitignored |

Every install already in the wild only accepts updates signed by the **one**
private key that matches the committed public key.

> ⚠️ **Do NOT run `tauri signer generate`.** A new key = a new public key =
> every existing install rejects your updates forever. Copy the **same** key
> from the machine where signing already works.

## Steps

1. **On the already-signed computer**, grab two things:
   - The file `C:\Users\<that-user>\.tauri\claude-launcher.key`
   - The password value from that repo's `.env`
     (the part after `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=`)

2. **Transfer both securely** — USB stick, password manager, or an encrypted
   channel. Never paste the private key or password into chat or plain email.

3. **Place the key file** at exactly:
   ```
   C:\Users\<you>\.tauri\claude-launcher.key
   ```
   (Create the `.tauri` folder if it doesn't exist.)

4. **Create `.env`** in the repo root. The `export` prefix is required — without
   it `pnpm tauri build` hangs forever at the signing step. Replace
   `YOURPASSWORD`:
   ```bash
   echo 'export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=YOURPASSWORD' > .env
   ```

5. **Build with signing:**
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/claude-launcher.key)
   source .env
   pnpm tauri build
   ```

   Output lands in `src-tauri/target/release/bundle/`:
   - `nsis/Claude Launcher_X.Y.Z_x64-setup.exe` + `.sig`
   - `msi/Claude Launcher_X.Y.Z_x64_en-US.msi` + `.sig`

Because the key is copied from the machine that already works against this
committed public key, it is guaranteed to match — no extra verification needed.

## Then deploy (recap of CLAUDE.md → Publishing a Release)

1. Bump version in all three places: `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json`.
2. Build with the signing env vars above.
3. Generate `latest.json` from the NSIS `.sig` content + the GitHub download URL.
4. `gh release create vX.Y.Z` and upload the NSIS `.exe`, the MSI, and
   `latest.json`.
