// Run by the Dockerfile after npm ci; the build fails if Baileys no longer has the code this expects.
//
// Since early November 2026 WhatsApp sends <status> stanzas to linked devices and Baileys 7.0.0-rc.9 never acks them: the
// server ends the stream every 50 minutes and the socket can come back open but deaf, receiving a few offline messages per
// reconnect (incoming messages arrived up to 12 hours late). The stanza is acked live and offline, in order with
// the other offline nodes, and a failing offline node no longer leaves that queue stuck for the rest of the connection.
// Upstream: WhiskeySockets/Baileys#2858 (fix PR #2866), fazer-ai/baileys-api#404. Drop this once Baileys ships the fix.
//
// Second: getHttpStream throws a Boom whose HTTP code is in output.statusCode, but downloadMediaMessage reads error.status,
// so media gone from WhatsApp's CDN (404/410, older than a few weeks) never asked the phone to upload it again.

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

const REUPLOAD = "/* fork: reupload on 404/410 */";
patch("Utils/messages.js", REUPLOAD, [
  ["            typeof error?.status === 'number' && // treat errors with status as HTTP failures requiring reupload\n            REUPLOAD_REQUIRED_STATUS.includes(error.status)) {",
    "            " + REUPLOAD + " REUPLOAD_REQUIRED_STATUS.includes(error?.status ?? error?.output?.statusCode)) {"],
], "media reupload");
