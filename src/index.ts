import dotenv from "dotenv-flow";
import express from "express";
import ExpressWs from "express-ws";
import config from "../config";
import log from "./logger";
import * as oai from "./openai";
import * as twlo from "./twilio";
import type { CallStatus } from "./types";

dotenv.config();

const { app } = ExpressWs(express());
app.use(express.urlencoded({ extended: true })).use(express.json());

/****************************************************
 Twilio Voice Webhook Endpoints
****************************************************/
app.post("/incoming-call", async (req, res) => {
  log.twl.info(`incoming-call from ${req.body.From} to ${req.body.To}`);

  try {
    oai.createWebsocket(); // This demo only supports one call at a time, hence a single OpenAI websocket is stored globally
    oai.ws.on("open", () => log.oai.info("openai websocket opened"));
    oai.ws.on("error", (err) => log.oai.error("openai websocket error", err));
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
    
    log.twl.info("Sending TwiML response with stream URL:", streamUrl);
    log.twl.info("HOSTNAME environment variable:", process.env.HOSTNAME);
    
    res.end(twimlResponse);
  } catch (error) {
    log.oai.error(
      "incoming call webhook failed, probably because OpenAI websocket could not connect.",
      error
    );
    res.status(500).send();
  }
});

app.post("/call-status-update", async (req, res) => {
  const status = req.body.CallStatus as CallStatus;

  if (status === "error") log.twl.error(`call-status-update ${status}`);
  else log.twl.info(`call-status-update ${status}`);

  if (status === "error" || status === "completed") oai.closeWebsocket();

  res.status(200).send();
});

app.post("/recording-status", async (req, res) => {
  const recordingStatus = req.body.RecordingStatus;
  const recordingUrl = req.body.RecordingUrl;
  const recordingSid = req.body.RecordingSid;
  const callSid = req.body.CallSid;
  const recordingDuration = req.body.RecordingDuration;

  log.twl.info(`Recording status: ${recordingStatus}`);
  
  if (recordingStatus === "completed") {
    log.twl.success(`Recording completed - Call SID: ${callSid}`);
    log.twl.success(`Recording SID: ${recordingSid}`);
    log.twl.success(`Recording URL: ${recordingUrl}`);
    log.twl.success(`Recording Duration: ${recordingDuration} seconds`);
    
    // You can save the recording details to a database or file here
    // For example: await saveRecordingDetails({ callSid, recordingSid, recordingUrl, recordingDuration });
  } else if (recordingStatus === "failed") {
    log.twl.error(`Recording failed for Call SID: ${callSid}`);
  }

  res.status(200).send();
});

/****************************************************
 Twilio Media Stream Websocket Endpoint 
****************************************************/
app.ws("/media-stream", (ws, req) => {
  log.twl.info("incoming websocket connection from:", req.headers.host);
  log.twl.info("websocket headers:", req.headers);

  twlo.setWs(ws);
  twlo.ws.on("error", (err) => log.twl.error(`websocket error`, err));

  // twilio media stream starts
  twlo.onMessage("start", (msg) => {
    log.twl.success("media stream started");
    twlo.setStreamSid(msg.streamSid);

    // OpenAI's websocket session parameters should probably be set when the it is
    // initialized. However, setting them slightly later (i.e. when the Twilio Media starts)
    // seems to make OpenAI's bot more responsive. I don't know why
    oai.setSessionParams();

    oai.speak(config.introduction); // tell OpenAI to speak the introduction
  });

  // relay audio packets between Twilio & OpenAI
  oai.onMessage("response.audio.delta", (msg) => twlo.sendAudio(msg.delta));
  twlo.onMessage("media", (msg) => oai.sendAudio(msg.media.payload));

  // user starts talking
  oai.onMessage("input_audio_buffer.speech_started", (msg) => {
    log.app.info("user started speaking");

    oai.clearAudio(); // tell OpenAI to stop sending audio
    twlo.clearAudio(); // tell Twilio to stop playing any audio that it has buffered
  });

  // bot final transcript
  oai.onMessage("response.audio_transcript.done", (msg) => {
    log.oai.info("bot transcript (final): ", msg.transcript);
  });
});

/****************************************************
 Start Server
****************************************************/
const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, "0.0.0.0", () => {
  log.app.info(`server running on http://0.0.0.0:${port}`);
  log.app.info(`HOSTNAME environment variable: ${process.env.HOSTNAME}`);
  log.app.info(`Expected media stream URL: wss://${process.env.HOSTNAME}/media-stream`);
});
