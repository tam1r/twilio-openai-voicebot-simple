"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_flow_1 = __importDefault(require("dotenv-flow"));
const express_1 = __importDefault(require("express"));
const express_ws_1 = __importDefault(require("express-ws"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("./logger"));
const oai = __importStar(require("./openai"));
const twlo = __importStar(require("./twilio"));
dotenv_flow_1.default.config();
const { app } = (0, express_ws_1.default)((0, express_1.default)());
app.use(express_1.default.urlencoded({ extended: true })).use(express_1.default.json());
/****************************************************
 Twilio Voice Webhook Endpoints
****************************************************/
app.post("/incoming-call", async (req, res) => {
    logger_1.default.twl.info(`incoming-call from ${req.body.From} to ${req.body.To}`);
    try {
        oai.createWebsocket(); // This demo only supports one call at a time, hence a single OpenAI websocket is stored globally
        oai.ws.on("open", () => logger_1.default.oai.info("openai websocket opened"));
        oai.ws.on("error", (err) => logger_1.default.oai.error("openai websocket error", err));
        // The incoming-call webhook is blocked until the OpenAI websocket is connected.
        // This ensures Twilio's Media Stream doesn't send audio packets to OpenAI prematurely.
        await oai.wsPromise;
        res.status(200);
        res.type("text/xml");
        // The <Stream/> TwiML noun tells Twilio to send the call to the websocket endpoint below.
        // The <Record/> noun enables call recording for both sides of the conversation.
        const streamUrl = `wss://${process.env.HOSTNAME}/media-stream`;
        const recordingStatusCallbackUrl = `https://${process.env.HOSTNAME}/recording-status`;
        const twimlResponse = `
        <Response>
          <Record action="${recordingStatusCallbackUrl}" recordingStatusCallback="${recordingStatusCallbackUrl}" recordingStatusCallbackEvent="completed" timeout="10" transcribe="false" playBeep="false" />
          <Connect>
            <Stream url="${streamUrl}" />
          </Connect>
        </Response>
        `;
        logger_1.default.twl.info("Sending TwiML response with stream URL:", streamUrl);
        logger_1.default.twl.info("HOSTNAME environment variable:", process.env.HOSTNAME);
        res.end(twimlResponse);
    }
    catch (error) {
        logger_1.default.oai.error("incoming call webhook failed, probably because OpenAI websocket could not connect.", error);
        res.status(500).send();
    }
});
app.post("/call-status-update", async (req, res) => {
    const status = req.body.CallStatus;
    if (status === "error")
        logger_1.default.twl.error(`call-status-update ${status}`);
    else
        logger_1.default.twl.info(`call-status-update ${status}`);
    if (status === "error" || status === "completed")
        oai.closeWebsocket();
    res.status(200).send();
});
app.post("/recording-status", async (req, res) => {
    const recordingStatus = req.body.RecordingStatus;
    const recordingUrl = req.body.RecordingUrl;
    const recordingSid = req.body.RecordingSid;
    const callSid = req.body.CallSid;
    const recordingDuration = req.body.RecordingDuration;
    logger_1.default.twl.info(`Recording status: ${recordingStatus}`);
    if (recordingStatus === "completed") {
        logger_1.default.twl.success(`Recording completed - Call SID: ${callSid}`);
        logger_1.default.twl.success(`Recording SID: ${recordingSid}`);
        logger_1.default.twl.success(`Recording URL: ${recordingUrl}`);
        logger_1.default.twl.success(`Recording Duration: ${recordingDuration} seconds`);
        // You can save the recording details to a database or file here
        // For example: await saveRecordingDetails({ callSid, recordingSid, recordingUrl, recordingDuration });
    }
    else if (recordingStatus === "failed") {
        logger_1.default.twl.error(`Recording failed for Call SID: ${callSid}`);
    }
    res.status(200).send();
});
/****************************************************
 Twilio Media Stream Websocket Endpoint
****************************************************/
app.ws("/media-stream", (ws, req) => {
    logger_1.default.twl.info("incoming websocket connection from:", req.headers.host);
    logger_1.default.twl.info("websocket headers:", req.headers);
    twlo.setWs(ws);
    twlo.ws.on("error", (err) => logger_1.default.twl.error(`websocket error`, err));
    // twilio media stream starts
    twlo.onMessage("start", (msg) => {
        logger_1.default.twl.success("media stream started");
        twlo.setStreamSid(msg.streamSid);
        // OpenAI's websocket session parameters should probably be set when the it is
        // initialized. However, setting them slightly later (i.e. when the Twilio Media starts)
        // seems to make OpenAI's bot more responsive. I don't know why
        oai.setSessionParams();
        oai.speak(config_1.default.introduction); // tell OpenAI to speak the introduction
    });
    // relay audio packets between Twilio & OpenAI
    oai.onMessage("response.audio.delta", (msg) => twlo.sendAudio(msg.delta));
    twlo.onMessage("media", (msg) => oai.sendAudio(msg.media.payload));
    // user starts talking
    oai.onMessage("input_audio_buffer.speech_started", (msg) => {
        logger_1.default.app.info("user started speaking");
        oai.clearAudio(); // tell OpenAI to stop sending audio
        twlo.clearAudio(); // tell Twilio to stop playing any audio that it has buffered
    });
    // bot final transcript
    oai.onMessage("response.audio_transcript.done", (msg) => {
        logger_1.default.oai.info("bot transcript (final): ", msg.transcript);
    });
});
/****************************************************
 Start Server
****************************************************/
const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, "0.0.0.0", () => {
    logger_1.default.app.info(`server running on http://0.0.0.0:${port}`);
    logger_1.default.app.info(`HOSTNAME environment variable: ${process.env.HOSTNAME}`);
    logger_1.default.app.info(`Expected media stream URL: wss://${process.env.HOSTNAME}/media-stream`);
});
