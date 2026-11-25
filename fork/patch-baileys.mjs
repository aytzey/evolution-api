// Run by the Dockerfile after npm ci; the build fails if Baileys no longer has the code this expects.
//
// Since early November 2026 WhatsApp sends <status> stanzas to linked devices and Baileys 7.0.0-rc.9 never acks them: the
// server ends the stream every 50 minutes and the socket can come back open but deaf, receiving a few offline messages per
// reconnect (incoming messages arrived up to 12 hours late). The stanza is acked live and offline, in order with
// the other offline nodes, and a failing offline node no longer leaves that queue stuck for the rest of the connection.
// Upstream: WhiskeySockets/Baileys#2858 (fix PR #2866), fazer-ai/baileys-api#404. Drop this once Baileys ships the fix.
//
// Second: getHttpStream throws a Boom whose HTTP code is in output.statusCode, but downloadMediaMessage reads error.status,
// so media gone from WhatsApp's CDN never asked the phone to upload it again. Expired media answers 403 there (07.11.2026:
// every photo older than about a month), so 403 asks too.
//
// Third (security): rc.9 acts on history-sync notifications, app-state key shares, LID migration mappings and placeholder
// resend answers from ANY sender. A stranger could inject a "message" in any customer's name (the answer's inner
// WebMessageInfo is emitted as messages.upsert), plant LID <-> number mappings, push app-state keys or make us download a
// "history" blob from his own host. These are honoured only from our own account (fromMe, or a peer message whose server-set
// `from` is our own JID/LID: rc.9 leaves fromMe false for those), and a placeholder answer only for a message id this
// session asked for. Upstream master has the same four-type guard plus a decodeMessageNode change that sets fromMe on
// self peer stanzas (src/Utils/process-message.ts SELF_ONLY_TYPES, src/Utils/decode-wa-message.ts); drop this on upgrade.
//
// Fourth (security): media downloads follow the sender's `url`/`directPath` ("@evil.host/x" turns
// https://mmg.whatsapp.net + directPath into another host), have no time limit and buffer without limit. Downloads now go
// only to https://mmg.whatsapp.net, message media is capped (MEDIA_DOWNLOAD_MAX_MB, default 20) and limited to 60 s, and
// an error on the HTTP body now reaches the reader instead of leaving it waiting forever.

import { readFileSync, writeFileSync } from "node:fs";

const patch = (path, mark, edits, name) => {
  const file = new URL("../node_modules/baileys/lib/" + path, import.meta.url);
  let code = readFileSync(file, "utf8");
  if (code.includes(mark)) return;
  const missing = edits.filter(([from]) => code.split(from).length !== 2).map(([from]) => from.trim());
  if (missing.length) throw new Error("Baileys " + name + " patch: expected code not found: " + missing.join(" | "));
  for (const [from, to] of edits) code = code.replace(from, () => to);
  writeFileSync(file, code);
  console.log("Baileys " + name + " patch applied.");
};

const STATUS = "/* fork: ack <status> */";
patch("Socket/messages-recv.js", STATUS, [
  ["    const makeOfflineNodeProcessor = () => {",
    "    " + STATUS + "\n    const handleStatus = async (node) => {\n        try {\n            await sendMessageAck(node);\n        }\n        catch (error) {\n            onUnexpectedError(error, 'acking status stanza');\n        }\n    };\n    const makeOfflineNodeProcessor = () => {"],
  ["            ['notification', handleNotification]\n        ]);", "            ['notification', handleNotification],\n            ['status', handleStatus]\n        ]);"],
  ["                    await nodeProcessor(node);\n", "                    try {\n                        await nodeProcessor(node);\n                    }\n                    catch (error) {\n                        onUnexpectedError(error, 'processing offline node');\n                    }\n"],
  ["    ws.on('CB:ack,class:message', (node) => {", "    ws.on('CB:status', async (node) => {\n        await processNode('status', node, 'acking status stanza', handleStatus);\n    });\n    ws.on('CB:ack,class:message', (node) => {"],
], "<status>");

const REUPLOAD = "/* fork: reupload on 403/404/410 */";
patch("Utils/messages.js", REUPLOAD, [
  ["            typeof error?.status === 'number' && // treat errors with status as HTTP failures requiring reupload\n            REUPLOAD_REQUIRED_STATUS.includes(error.status)) {",
    "            " + REUPLOAD + " [403, ...REUPLOAD_REQUIRED_STATUS].includes(error?.status ?? error?.output?.statusCode)) {"],
], "media reupload");

const OWN = "/* fork: own-account protocol messages */";
patch("Utils/process-message.js", OWN, [
  ["const REAL_MSG_REQ_ME_STUB_TYPES = new Set([WAMessageStubType.GROUP_PARTICIPANT_ADD]);\n",
    "const REAL_MSG_REQ_ME_STUB_TYPES = new Set([WAMessageStubType.GROUP_PARTICIPANT_ADD]);\n" + OWN + "\n" +
    "const FORK_OWN_ONLY = new Set([\n" +
    "    proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION,\n" +
    "    proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_SHARE,\n" +
    "    proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE,\n" +
    "    proto.Message.ProtocolMessage.Type.LID_MIGRATION_MAPPING_SYNC\n" +
    "]);\n" +
    "/** Sent by one of our own devices: fromMe, or a peer stanza whose server-set `from` is our own JID/LID (no recipient, so rc.9 leaves fromMe false). */\n" +
    "export const forkFromOwnAccount = (key, me) => !!key?.fromMe ||\n" +
    "    (!key?.participant && !!key?.remoteJid && [me?.id, me?.lid].some(jid => !!jid && jidNormalizedUser(jid) === jidNormalizedUser(key.remoteJid)));\n"],
  ["        switch (protocolMsg.type) {",
    "        const forkIgnored = FORK_OWN_ONLY.has(protocolMsg.type) && !forkFromOwnAccount(message.key, creds.me);\n" +
    "        if (forkIgnored) {\n" +
    "            logger?.debug({ type: protocolMsg.type }, 'ignored a protocol message only our own devices may send');\n" +
    "        }\n" +
    "        switch (forkIgnored ? undefined : protocolMsg.type) {"],
  ["                            const webMessageInfo = proto.WebMessageInfo.decode(retryResponse.webMessageInfoBytes);\n",
    "                            const webMessageInfo = proto.WebMessageInfo.decode(retryResponse.webMessageInfoBytes);\n" +
    "                            // fork: only the answer to a message this session asked the phone for (Socket/messages-recv.js)\n" +
    "                            if (!(await placeholderResendCache?.get(`fork-asked:${webMessageInfo.key?.id}`))) {\n" +
    "                                logger?.debug('ignored a placeholder resend nobody asked for');\n" +
    "                                continue;\n" +
    "                            }\n"],
], "own-account protocol messages");

patch("Socket/chats.js", OWN, [
  ["import processMessage from '../Utils/process-message.js';", "import processMessage, { forkFromOwnAccount } from '../Utils/process-message.js';"],
  ["        const historyMsg = getHistoryMsg(msg.message);",
    "        " + OWN + "\n        const forkOwn = forkFromOwnAccount(msg.key, authState.creds.me);\n        const historyMsg = forkOwn ? getHistoryMsg(msg.message) : undefined;"],
  ["        if (msg.message?.protocolMessage?.appStateSyncKeyShare && syncState === SyncState.Syncing) {",
    "        if (forkOwn && msg.message?.protocolMessage?.appStateSyncKeyShare && syncState === SyncState.Syncing) {"],
], "own-account history state");

const ASKED = "/* fork: remember placeholder requests */";
patch("Socket/messages-recv.js", ASKED, [
  ["        const pdoMessage = {\n            placeholderMessageResendRequest: [",
    "        " + ASKED + "\n        await placeholderResendCache.set(`fork-asked:${messageKey?.id}`, true);\n" +
    "        const pdoMessage = {\n            placeholderMessageResendRequest: ["],
], "placeholder request");

const MEDIA = "/* fork: WhatsApp-only, bounded media download */";
patch("Utils/messages-media.js", MEDIA, [
  ["        method: 'GET',\n        headers: options.headers\n    });",
    "        method: 'GET',\n        headers: options.headers,\n        signal: options.signal\n    });"],
  ["const DEF_HOST = 'mmg.whatsapp.net';\n",
    "const DEF_HOST = 'mmg.whatsapp.net';\n" + MEDIA + "\n" +
    "const FORK_MEDIA_MAX_MB = Number(process.env.MEDIA_DOWNLOAD_MAX_MB);\n" +
    "const FORK_MEDIA_MAX_BYTES = (FORK_MEDIA_MAX_MB > 0 ? FORK_MEDIA_MAX_MB : 20) * 1024 * 1024;\n" +
    "const FORK_MEDIA_TIMEOUT_MS = 60000;\n" +
    "/** The URL as fetched, only when it is https on WhatsApp's media host (no userinfo, port or other host). */\n" +
    "const forkMediaUrl = (value) => {\n" +
    "    try {\n" +
    "        const parsed = new URL(value);\n" +
    "        return parsed.protocol === 'https:' && parsed.hostname === DEF_HOST && !parsed.port && !parsed.username && !parsed.password\n" +
    "            ? parsed.href\n" +
    "            : undefined;\n" +
    "    }\n" +
    "    catch {\n" +
    "        return undefined;\n" +
    "    }\n" +
    "};\n"],
  ["    const isValidMediaUrl = url?.startsWith('https://mmg.whatsapp.net/');\n" +
   "    const downloadUrl = isValidMediaUrl ? url : getUrlFromDirectPath(directPath);\n" +
   "    if (!downloadUrl) {\n" +
   "        throw new Boom('No valid media URL or directPath present in message', { statusCode: 400 });\n" +
   "    }\n" +
   "    const keys = await getMediaKeys(mediaKey, type);\n" +
   "    return downloadEncryptedContent(downloadUrl, keys, opts);",
   "    const downloadUrl = forkMediaUrl(url) ||\n" +
   "        (typeof directPath === 'string' && directPath.startsWith('/') ? forkMediaUrl(getUrlFromDirectPath(directPath)) : undefined);\n" +
   "    if (!downloadUrl) {\n" +
   "        throw new Boom('Media location is not a WhatsApp media path', { statusCode: 400 });\n" +
   "    }\n" +
   "    const keys = await getMediaKeys(mediaKey, type);\n" +
   "    // history and app-state blobs come from our own phone / WhatsApp's server and may be large: no cap there\n" +
   "    const bounded = type !== 'md-msg-hist' && type !== 'md-app-state';\n" +
   "    return downloadEncryptedContent(downloadUrl, keys, bounded ? { ...opts, forkMaxBytes: FORK_MEDIA_MAX_BYTES, forkTimeoutMs: FORK_MEDIA_TIMEOUT_MS } : opts);"],
  ["export const downloadEncryptedContent = async (downloadUrl, { cipherKey, iv }, { startByte, endByte, options } = {}) => {",
    "export const downloadEncryptedContent = async (downloadUrl, { cipherKey, iv }, { startByte, endByte, options, forkMaxBytes, forkTimeoutMs } = {}) => {"],
  ["    const fetched = await getHttpStream(downloadUrl, {\n        ...(options || {}),\n        headers\n    });",
    "    const forkAbort = forkTimeoutMs ? new AbortController() : undefined;\n" +
    "    const forkTimer = forkAbort && setTimeout(() => forkAbort.abort(new Boom('Media download timed out', { statusCode: 408 })), forkTimeoutMs);\n" +
    "    let forkBytes = 0;\n" +
    "    const fetched = await getHttpStream(downloadUrl, {\n        ...(options || {}),\n        headers,\n" +
    "        ...(forkAbort ? { signal: forkAbort.signal } : {})\n" +
    "    }).catch(error => {\n        clearTimeout(forkTimer);\n        throw error;\n    });"],
  ["        transform(chunk, _, callback) {\n            let data = Buffer.concat([remainingBytes, chunk]);",
    "        transform(chunk, _, callback) {\n" +
    "            forkBytes += chunk.length;\n" +
    "            if (forkMaxBytes && forkBytes > forkMaxBytes) {\n" +
    "                return callback(new Boom(`Media is larger than ${forkMaxBytes} bytes`, { statusCode: 413 }));\n" +
    "            }\n" +
    "            let data = Buffer.concat([remainingBytes, chunk]);"],
  ["    return fetched.pipe(output, { end: true });",
    "    fetched.on('error', error => output.destroy(error));\n" +
    "    output.on('close', () => {\n        clearTimeout(forkTimer);\n        fetched.destroy();\n    });\n" +
    "    return fetched.pipe(output, { end: true });"],
], "media download");
