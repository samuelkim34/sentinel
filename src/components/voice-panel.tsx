"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../client/api";
import { AudioFramer, StreamingResampler, floatToPcm16, pcm16ToFloat } from "../client/audio";
import { resolveVoiceCalls, type ProviderCall } from "../client/voice-calls";
import { voiceToolDefinitions } from "../contracts/voice-tools";
import { Button, Card, Field, Input } from "./ui";

type VoiceStart = { sessionId: string; toolToken: string; ephemeralCredential: string; websocketUrl: string; functions: string[]; instructions: string; expiresAt: number; retainTranscript: boolean };
type Draft = { id: string; state: string; terms: Record<string, unknown>; expiresAt: number };
type Resources = { socket?: WebSocket; stream?: MediaStream; audio?: AudioContext; session?: VoiceStart; timer?: ReturnType<typeof setTimeout>; framer?: AudioFramer; sources: AudioBufferSourceNode[]; nextPlayAt: number; cancelled: Set<string>; responseId?: string; completed: Set<string> };
const emptyResources = (): Resources => ({ sources: [], nextPlayAt: 0, cancelled: new Set(), completed: new Set() });

export function VoicePanel({ workspaceId, registrationId, taskId, toolsVerified }: { workspaceId: string; registrationId: string; taskId?: string; toolsVerified: boolean }) {
  const [status, setStatus] = useState("Idle");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const resources = useRef<Resources>(emptyResources());
  const generation = useRef(0);
  const starting = useRef(false);
  const muteRef = useRef(false);

  const stop = useCallback(async (updateStatus = true) => {
    generation.current += 1;
    starting.current = false;
    const current = resources.current;
    resources.current = emptyResources();
    if (current.timer) clearTimeout(current.timer);
    if (current.socket) { current.socket.onclose = null; current.socket.onerror = null; current.socket.onmessage = null; current.socket.close(); }
    current.stream?.getTracks().forEach((track) => track.stop());
    for (const source of current.sources) { try { source.stop(); } catch { /* already ended */ } }
    await current.audio?.close().catch(() => undefined);
    if (updateStatus) setStatus("Ended");
    if (current.session) await fetch(`/api/voice/sessions/${current.session.sessionId}/end`, { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId }) }).catch(() => undefined);
  }, [workspaceId]);

  useEffect(() => {
    const end = () => { void stop(); };
    const checkExpiry = () => { if (resources.current.session && resources.current.session.expiresAt <= Date.now()) end(); };
    window.addEventListener("sentinel-session-ending", end);
    document.addEventListener("visibilitychange", checkExpiry);
    return () => { window.removeEventListener("sentinel-session-ending", end); document.removeEventListener("visibilitychange", checkExpiry); void stop(false); };
  }, [workspaceId, registrationId, taskId, stop]);

  const addLine = (line: string) => setTranscript((items) => [...items.slice(-99), line]);

  async function talk() {
    if (starting.current || resources.current.session) return;
    starting.current = true;
    const token = ++generation.current;
    const active = () => generation.current === token;
    setStatus("Starting"); setError(""); setTranscript([]); setDraft(null); setMuted(false); muteRef.current = false;
    try {
      const session = await api<VoiceStart>("/api/voice/sessions", { method: "POST", body: JSON.stringify({ workspaceId, registrationId, taskId }) });
      if (!active()) {
        await api(`/api/voice/sessions/${session.sessionId}/end`, { method: "POST", body: JSON.stringify({ workspaceId }) }).catch(() => undefined);
        return;
      }
      const current = resources.current;
      current.session = session;
      current.timer = setTimeout(() => { addLine("The voice session expired."); void stop(); }, Math.max(0, session.expiresAt - Date.now()));
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Voice requires microphone access on HTTPS or localhost.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!active()) { stream.getTracks().forEach((track) => track.stop()); return; }
      current.stream = stream;
      const context = new AudioContext(); current.audio = context;
      await context.resume();
      await context.audioWorklet.addModule("/audio/capture-worklet.js");
      if (!active()) return;
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "sentinel-capture");
      const silent = context.createGain(); silent.gain.value = 0;
      source.connect(worklet); worklet.connect(silent); silent.connect(context.destination);
      const resampler = new StreamingResampler(context.sampleRate);
      const framer = new AudioFramer(); current.framer = framer;
      const socket = new WebSocket(session.websocketUrl, [`xai-client-secret.${session.ephemeralCredential}`]); current.socket = socket;
      const send = (event: unknown) => { if (active() && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); };
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!active() || muteRef.current || socket.readyState !== WebSocket.OPEN) { framer.clear(); return; }
        for (const frame of framer.push(resampler.process(event.data))) send({ type: "input_audio_buffer.append", audio: bytesToBase64(floatToPcm16(frame)) });
      };
      socket.onopen = () => {
        if (!active()) { socket.close(); return; }
        starting.current = false; setStatus("Connected");
        send({ type: "session.update", session: { instructions: session.instructions, voice: "eve", turn_detection: { type: "server_vad" }, audio: { input: { format: { type: "audio/pcm", rate: 24000 } }, output: { format: { type: "audio/pcm", rate: 24000 } } }, tools: voiceToolDefinitions(session.functions) } });
      };
      socket.onerror = () => { setError("The voice connection failed. Start a new conversation to reconnect."); void stop(); };
      socket.onclose = () => { if (active()) { void stop(); setError("The voice connection closed."); } };
      socket.onmessage = (message) => {
        if (!active()) return;
        try {
          const event = JSON.parse(String(message.data)) as { type: string; delta?: string; transcript?: string; response_id?: string; error?: { message?: string }; response?: { id: string; output?: Array<ProviderCall & { type: string }> } };
          if (event.type === "error") { setError(event.error?.message ?? "The voice provider reported an error."); void stop(); return; }
          if (event.type === "response.created") current.responseId = event.response?.id;
          if (event.type === "input_audio_buffer.speech_started" || event.type === "response.cancelled") {
            if (current.responseId) current.cancelled.add(current.responseId);
            for (const source of current.sources) { try { source.stop(); } catch { /* ended */ } }
            current.sources = []; current.nextPlayAt = 0;
          }
          if ((event.type === "response.output_audio.delta" || event.type === "response.audio.delta") && event.delta && !current.cancelled.has(event.response_id ?? "")) playPcm(current, pcm16ToFloat(Uint8Array.from(atob(event.delta), (char) => char.charCodeAt(0))));
          if (event.transcript && ["conversation.item.input_audio_transcription.completed", "response.output_audio_transcript.done", "response.audio_transcript.done"].includes(event.type)) {
            const speaker = event.type.startsWith("conversation") ? "user" : "assistant";
            addLine(`${speaker}: ${event.transcript}`);
            if (session.retainTranscript) void api(`/api/voice/sessions/${session.sessionId}/transcript`, { method: "POST", headers: { "x-sentinel-voice-token": session.toolToken }, body: JSON.stringify({ workspaceId, speaker, text: event.transcript.slice(0, 4000), final: true }) }).catch(() => setError("A transcript could not be saved."));
          }
          if (event.type === "response.done" && event.response && !current.completed.has(event.response.id)) {
            current.completed.add(event.response.id);
            // Never replay interrupted financial commands or calls from a cancelled response.
            if (current.cancelled.has(event.response.id)) return;
            const calls = (event.response.output ?? []).filter((item) => item.type === "function_call");
            void resolveVoiceCalls(calls, async (call) => {
              if (!active()) throw new Error("The conversation ended before this tool call.");
              const result = await api(`/api/voice/sessions/${session.sessionId}/tools`, { method: "POST", headers: { "x-sentinel-voice-token": session.toolToken }, body: JSON.stringify({ workspaceId, callId: call.call_id, name: call.name, arguments: JSON.parse(call.arguments || "{}") }) });
              if (active()) {
                addLine(`${call.name}: ${JSON.stringify(result)}`);
                if (call.name === "draft_authority_change") setDraft(result as Draft);
                void queryClient.invalidateQueries();
              }
              return result;
            }, send, active);
            if (current.completed.size > 100) current.completed.delete(current.completed.values().next().value!);
            if (current.cancelled.size > 100) current.cancelled.delete(current.cancelled.values().next().value!);
          }
        } catch { setError("An invalid voice event was ignored."); }
      };
    } catch (cause) {
      if (!active()) return;
      setError(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Microphone permission was denied." : cause instanceof Error ? cause.message : "Voice could not start.");
      await stop();
    }
  }

  function toggleMute() {
    const value = !muteRef.current; muteRef.current = value; setMuted(value);
    resources.current.stream?.getAudioTracks().forEach((track) => { track.enabled = !value; });
    resources.current.framer?.clear();
    if (value && resources.current.socket?.readyState === WebSocket.OPEN) resources.current.socket.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
  }

  async function confirmDraft() {
    if (!draft || confirming) return;
    setConfirming(true); setError("");
    try {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      await api(`/api/workspaces/${workspaceId}/authority-drafts/${draft.id}/confirm`, { method: "POST", body: "{}" });
      setDraft(null); setPassword(""); addLine("The owner confirmed the allowance change."); void queryClient.invalidateQueries();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Confirmation failed."); }
    finally { setConfirming(false); }
  }

  return <Card>
    <h2 className="text-xl font-semibold">Sentinel voice</h2>
    <p className="text-sm">Discuss the selected Bot&apos;s shared work. Microphone: {status === "Connected" ? muted ? "muted" : "live" : "off"}. Connection: {status}. Private native Bot chats are unavailable here.</p>
    {!toolsVerified && <p>Connect and verify this Bot&apos;s tools to enable voice.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="mt-3 flex gap-2">
      <Button type="button" disabled={!toolsVerified || status === "Starting" || status === "Connected"} onClick={() => void talk()}>Talk</Button>
      <Button variant="quiet" type="button" disabled={status !== "Connected"} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</Button>
      <Button variant="quiet" type="button" onClick={() => void stop()}>End conversation</Button>
    </div>
    {draft && <div className="mt-4 rounded border p-3"><h3 className="font-semibold">Review exact allowance draft</h3><p>Only an owner can confirm. A replacement creates a new lifetime allowance; previous spending stays recorded.</p><pre className="my-2 overflow-auto text-xs">{JSON.stringify(draft.terms, null, 2)}</pre><Field label="Owner password"><Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field><Button type="button" disabled={!password || confirming} onClick={() => void confirmDraft()}>Confirm these terms</Button></div>}
    <div className="mt-3 max-h-48 overflow-auto text-sm" aria-live="polite">{transcript.map((line, index) => <p key={index}>{line}</p>)}</div>
  </Card>;
}

function playPcm(current: Resources, samples: Float32Array) {
  const context = current.audio;
  if (!context || context.state === "closed" || !samples.length) return;
  if (current.nextPlayAt - context.currentTime > 5) return;
  const buffer = context.createBuffer(1, samples.length, 24000); buffer.copyToChannel(new Float32Array(samples), 0);
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); current.sources.push(source);
  source.onended = () => { current.sources = current.sources.filter((item) => item !== source); };
  const start = Math.max(context.currentTime + 0.03, current.nextPlayAt); source.start(start); current.nextPlayAt = start + buffer.duration;
}

function bytesToBase64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
