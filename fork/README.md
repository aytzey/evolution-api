# stable branch

Evolution API release tags with fixes on top (currently `2.3.7`):

- `fork/patch-baileys.mjs` (run by the Dockerfile): Baileys acks WhatsApp's `<status>` stanzas, so the socket no longer
  drops every 50 minutes and turns deaf; a failing offline node no longer stalls the offline queue.
  It also asks the phone to upload media again when WhatsApp's CDN answers 403/404/410 (Baileys read the wrong error field and skipped 403, which expired media gets).
- `WEBHOOK_KEEP_LID=true` keeps `@lid` in `key.remoteJid` of `messages.upsert` (default: replaced by `remoteJidAlt`, as
  upstream), for consumers that resolve `remoteJidAlt` themselves.
- `messages.upsert` and `messages.update` no longer print every message and cache lookup to stdout (use `LOG_LEVEL`).
- Profile pictures are looked up once per contact every few hours instead of once per incoming message and contact update.
- `POST /chat/fetchHistory/{instance}` `{ remoteJid, count?, anchor?: { id, fromMe, timestamp } }` asks the phone once for up
  to 50 messages of that chat before the anchor (default: now) and returns them as `{ id, remoteJid, fromMe, timestamp, text, media? }` (`media.message` goes straight into
  `getBase64FromMediaMessage` with the key)
  (`status`: `answered`; `timeout` with no messages after `wait` seconds, default 60, at most 300, when the phone has not
  answered yet, which is not an empty chat). A sleeping phone answers minutes or hours late: every on-demand answer is kept in
  memory for 24 h, and the next call for that chat returns it at once as `status: late` without asking the phone again (a
  restart clears them). An answer is matched to its request by `peerDataRequestSessionId`, else by chat (phone or LID id).
  On-demand history no longer prints the messages to stdout.

Build an image:

```sh
git pull && docker build -t aytzey/evolution-api:$(git rev-parse --short HEAD) .
```

Upstream changes come from release tags (`git fetch upstream --tags && git merge 2.3.x`), not `develop`: 2.4.0 requires
licence activation.
