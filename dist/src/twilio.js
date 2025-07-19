"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ws = void 0;
exports.setStreamSid = setStreamSid;
exports.setWs = setWs;
exports.clearAudio = clearAudio;
exports.sendAudio = sendAudio;
exports.onMessage = onMessage;
let streamSid;
function setStreamSid(sid) {
    streamSid = sid;
}
function setWs(wss) {
    exports.ws = wss;
}
/****************************************************
 Media Stream Actions, https://www.twilio.com/docs/voice/media-streams/websocket-messages#send-websocket-messages-to-twilio
****************************************************/
/** Clear Twilio's audio buffer (https://www.twilio.com/docs/voice/media-streams/websocket-messages#send-a-clear-message) */
function clearAudio() {
    exports.ws === null || exports.ws === void 0 ? void 0 : exports.ws.send(JSON.stringify({ event: "clear", streamSid }));
}
/** Send raw audio to Twilio call (https://www.twilio.com/docs/voice/media-streams/websocket-messages#send-a-media-message) */
function sendAudio(audio) {
    exports.ws === null || exports.ws === void 0 ? void 0 : exports.ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: audio } }));
}
/****************************************************
 Websocket Listeners, https://www.twilio.com/docs/voice/media-streams/websocket-messages#websocket-messages-from-twilio
****************************************************/
/** Adds an listener to an incoming message type from Twilio's Media Stream */
function onMessage(type, callback) {
    exports.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.event === type)
            callback(msg);
    });
}
