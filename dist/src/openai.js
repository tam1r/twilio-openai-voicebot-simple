"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsPromise = exports.ws = void 0;
exports.createWebsocket = createWebsocket;
exports.closeWebsocket = closeWebsocket;
exports.clearAudio = clearAudio;
exports.speak = speak;
exports.sendAudio = sendAudio;
exports.setSessionParams = setSessionParams;
exports.onMessage = onMessage;
const ws_1 = __importDefault(require("ws"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("./logger"));
function createWebsocket() {
    // websocket must be closed or uninitialized
    if (exports.ws && exports.ws?.readyState !== exports.ws.CLOSED)
        throw Error(`There is already an active OpenAI websocket connection. This demo is limited to a single OpenAI connection at a time.`);
    logger_1.default.oai.info("Creating OpenAI websocket connection...");
    logger_1.default.oai.info("OpenAI WebSocket URL:", config_1.default.openai.wsUrl);
    logger_1.default.oai.info("OpenAI API Key present:", !!process.env.OPENAI_API_KEY);
    logger_1.default.oai.info("OpenAI API Key length:", process.env.OPENAI_API_KEY?.length || 0);
    exports.wsPromise = new Promise((resolve, reject) => {
        exports.ws = new ws_1.default(config_1.default.openai.wsUrl, {
            headers: {
                Authorization: "Bearer " + process.env.OPENAI_API_KEY,
                "OpenAI-Beta": "realtime=v1",
            },
        });
        // Add timeout for connection
        const timeout = setTimeout(() => {
            logger_1.default.oai.error("OpenAI websocket connection timeout");
            exports.ws.terminate();
            reject(new Error("Connection timeout"));
        }, 10000); // 10 second timeout
        exports.ws.on("open", () => {
            clearTimeout(timeout);
            logger_1.default.oai.success("OpenAI websocket connected successfully");
            resolve();
        });
        exports.ws.on("error", (error) => {
            clearTimeout(timeout);
            logger_1.default.oai.error("OpenAI websocket error:", error);
            reject(error);
        });
        exports.ws.on("unexpected-response", (request, response) => {
            clearTimeout(timeout);
            logger_1.default.oai.error("OpenAI websocket unexpected response:", {
                statusCode: response.statusCode,
                statusMessage: response.statusMessage,
                headers: response.headers
            });
            reject(new Error(`Unexpected response: ${response.statusCode} ${response.statusMessage}`));
        });
        exports.ws.on("close", (code, reason) => {
            logger_1.default.oai.warn("OpenAI websocket closed:", { code, reason: reason.toString() });
        });
    });
    return exports.wsPromise;
}
async function closeWebsocket() {
    return new Promise((resolve) => {
        if (!exports.ws) {
            logger_1.default.oai.warn("no WebSocket connection to disconnect");
            resolve();
            return;
        }
        exports.ws.on("close", () => resolve());
        exports.ws.close();
    });
}
/****************************************************
 Websocket Actions, see https://platform.openai.com/docs/api-reference/realtime-client-events
****************************************************/
/** Clears OpenAI's audio buffer (https://platform.openai.com/docs/api-reference/realtime-client-events/input_audio_buffer/clear) */
function clearAudio() {
    exports.ws?.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
}
/** Create a response record that prompts the voicebot to say something (https://platform.openai.com/docs/api-reference/realtime-client-events/response/create) */
function speak(text) {
    exports.ws?.send(JSON.stringify({
        type: "response.create",
        response: {
            modalities: ["text", "audio"],
            instructions: `Say this verbatum:\n${text}`,
        },
    }));
}
/** Send raw audio packets to OpenAI's websocket (https://platform.openai.com/docs/api-reference/realtime-client-events/input_audio_buffer/append) */
function sendAudio(audio) {
    exports.ws?.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
}
/** Sets the OpenAI Realtime session parameter per the demo configuation.
 *
 * Note, these config params should probably be set when the OpenAI websocket is initialized
 * but, setting them slightly later (i.e. when the Twilio Media starts) seems to make
 * OpenAI's bot more responsive.
 */
function setSessionParams() {
    exports.ws?.send(JSON.stringify({
        type: "session.update",
        session: {
            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            modalities: ["text", "audio"],
            turn_detection: { type: "server_vad" }, // VAD (voice activity detection) enables input_audio_buffer.speech_started / .speech_stopped
            instructions: config_1.default.openai.instructions,
            temperature: config_1.default.openai.temperature,
            voice: config_1.default.openai.voice,
        },
    }));
}
/****************************************************
 Websocket Listeners, see https://platform.openai.com/docs/api-reference/realtime-server-events
****************************************************/
/** Adds an listener to an incoming message type */
function onMessage(type, callback) {
    exports.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === type)
            callback(msg);
    });
}
