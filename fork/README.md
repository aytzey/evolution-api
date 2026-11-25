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
- `POST /chat/resolveLid/{instance}` `{ lids: ["<digits>@lid", …] }` (1–50) maps LIDs to phone JIDs from the session's own LID
  mapping (Baileys learns it when we message a number or receive a message carrying both ids) and answers
  `[{ lid, jid }]`, `jid: null` when unknown. Store only, no network lookup. For a first reply that arrives with only `@lid`
  and no `remoteJidAlt` (branch `katay-lid-lookup`, used by KATAY CRM).
- `whatsappNumbers` adds `lidJid` to an existing number when the session already knows its LID (store only; Baileys'
  `getLIDForPN` would ask WhatsApp on a miss, one more lookup per number).

Build an image:

```sh
git pull && docker build -t aytzey/evolution-api:$(git rev-parse --short HEAD) .
```

Upstream changes come from release tags (`git fetch upstream --tags && git merge 2.3.x`), not `develop`: 2.4.0 requires
licence activation.
e> patch: expected code not found` when a Baileys upgrade moves it. Re-check each one on upgrade.

- **Own-account protocol messages** (patches `own-account protocol messages`, `own-account history state`,
  `placeholder request`). Baileys rc.9 acted on history-sync notifications, app-state key shares, LID migration mappings
  and placeholder-resend answers from *any* sender: a stranger could inject a "message" in any customer's name (the
  answer's inner `WebMessageInfo` became `messages.upsert`), plant LID <-> number mappings (what `resolveLid`/`lidJid`
  return), push app-state keys, start the initial-sync state machine or make us download a "history" blob from his host.
  These four types are now honoured only from our own account: `fromMe`, or a peer stanza whose server-set `from` is our
  own JID/LID (rc.9 leaves `fromMe` false for those, so a plain `fromMe` check would also drop the phone's real history).
  A placeholder answer is used only for a message id this session asked the phone for (`requestPlaceholderResend` records
  it for an hour). Upstream master has the same four-type guard and sets `fromMe` on self peer stanzas
  (`src/Utils/process-message.ts` `SELF_ONLY_TYPES`, `src/Utils/decode-wa-message.ts`); drop this patch when upgrading to it,
  but keep the "asked for" check, which upstream does not have. All other writers of the LID store use server-set stanza
  attributes or USync answers.