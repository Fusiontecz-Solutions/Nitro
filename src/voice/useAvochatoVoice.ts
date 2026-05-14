import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Device, type Call } from "@twilio/voice-sdk";
import { axiosGet, axiosPost } from "@/redux/axios";
import { markMicrophoneWarmedThisSession } from "@/voice/microphoneWarmup";

export type AvochatoVoiceStatus = "idle" | "registering" | "in_call" | "error";

async function fetchCallToken(subdomain?: string): Promise<string> {
  const res = await axiosPost(
    "/avochato-voice/call-token",
    subdomain ? { subdomain } : {},
  );
  const data = res.data as { success?: boolean; twilioToken?: string; message?: string };
  const token = data?.twilioToken;
  if (!data?.success || !token) {
    throw new Error(data?.message ?? "Failed to get voice token");
  }
  return token;
}

/**
 * Prompts for microphone permission on a direct user gesture before any network work.
 * Stops tracks immediately; Twilio acquires audio again on connect.
 */
async function requestMicrophoneAccess(): Promise<void> {
  if (!window.isSecureContext) {
    throw new Error(
      "Microphone needs a secure context. Use https:// in production or http://localhost for development.",
    );
  }
  const g = navigator.mediaDevices?.getUserMedia;
  if (!g) {
    throw new Error("This browser does not support microphone access (mediaDevices.getUserMedia).");
  }
  let stream: MediaStream;
  try {
    stream = await g.call(navigator.mediaDevices, { audio: true, video: false });
  } catch (e) {
    const name =
      e && typeof e === "object" && "name" in e ? String((e as DOMException).name) : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error("Microphone access was blocked. Allow the microphone for this site and try again.");
    }
    throw e instanceof Error ? e : new Error("Could not access the microphone.");
  }
  stream.getTracks().forEach((t) => t.stop());
}

export function normalizeE164(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) {
    const digits = "+" + trimmed.slice(1).replace(/\D/g, "");
    return digits.length > 1 ? digits : "";
  }
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }
  if (digitsOnly.length >= 8) {
    return `+${digitsOnly}`;
  }
  return "";
}

/**
 * Browser voice calling via Avochato (Twilio-compatible access token from `POST /v1/calls`).
 * Requirements: HTTPS in production, microphone permission, backend `AVOCHATO_AUTH_ID` / `AVOCHATO_AUTH_SECRET`.
 */
export function useAvochatoVoice() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<AvochatoVoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const subdomainRef = useRef<string | undefined>(undefined);

  const refreshConfigured = useCallback(async () => {
    try {
      const res = await axiosGet("/avochato-voice/status");
      const data = res.data as { success?: boolean; configured?: boolean };
      setConfigured(!!data?.configured);
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => {
    void refreshConfigured();
  }, [refreshConfigured]);

  const teardownDevice = useCallback(() => {
    try {
      callRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    callRef.current = null;
    try {
      deviceRef.current?.destroy();
    } catch {
      /* ignore */
    }
    deviceRef.current = null;
    setIsMuted(false);
    setStatus("idle");
  }, []);

  const ensureDevice = useCallback(async (subdomain?: string) => {
    subdomainRef.current = subdomain;
    if (deviceRef.current) {
      return deviceRef.current;
    }
    setStatus("registering");
    setError(null);
    const token = await fetchCallToken(subdomain);
    const device = new Device(token, {
      logLevel: "error",
      closeProtection: true,
    });

    device.on("error", (err) => {
      setError(err?.message ?? "Voice device error");
      setStatus("error");
    });

    device.on("tokenWillExpire", () => {
      void (async () => {
        try {
          const next = await fetchCallToken(subdomainRef.current);
          device.updateToken(next);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Token refresh failed";
          setError(msg);
        }
      })();
    });

    try {
      await device.register();
    } catch (e) {
      device.destroy();
      throw e;
    }
    deviceRef.current = device;
    setStatus("idle");
    return device;
  }, []);

  const hangUp = useCallback(() => {
    try {
      callRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    callRef.current = null;
    setIsMuted(false);
    setStatus("idle");
  }, []);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !isMuted;
    call.mute(next);
    setIsMuted(next);
  }, [isMuted]);

  const startCall = useCallback(
    async (
      rawPhone: string,
      options?: {
        subdomain?: string;
        /**
         * Promise from `navigator.mediaDevices.getUserMedia(...)` started in the **same synchronous
         * turn** as the user's tap (e.g. in the button `onClick`). Required for a reliable permission
         * prompt in Chromium after any `await` would consume user activation.
         */
        microphonePromise?: Promise<MediaStream>;
      },
    ) => {
      const to = normalizeE164(rawPhone);
      if (!to) {
        setError("Enter a valid phone number (E.164 or 10-digit US).");
        setStatus("error");
        return;
      }
      try {
        setError(null);
        let stream: MediaStream;
        if (options?.microphonePromise) {
          try {
            stream = await options.microphonePromise;
          } catch (e) {
            const name =
              e && typeof e === "object" && "name" in e ? String((e as DOMException).name) : "";
            if (name === "NotAllowedError" || name === "PermissionDeniedError") {
              throw new Error(
                "Microphone access was blocked. Allow the microphone for this site and try again.",
              );
            }
            throw e instanceof Error ? e : new Error("Could not access the microphone.");
          }
          stream.getTracks().forEach((t) => t.stop());
          markMicrophoneWarmedThisSession();
        } else {
          await requestMicrophoneAccess();
          markMicrophoneWarmedThisSession();
        }
        const device = await ensureDevice(options?.subdomain);
        hangUp();
        const call = await device.connect({
          params: {
            To: to,
          },
          rtcConstraints: { audio: true },
        });
        callRef.current = call;
        setStatus("in_call");
        setIsMuted(false);

        call.on("disconnect", () => {
          callRef.current = null;
          setIsMuted(false);
          setStatus("idle");
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Call failed");
        setStatus("error");
      }
    },
    [ensureDevice, hangUp],
  );

  return useMemo(
    () => ({
      configured,
      refreshConfigured,
      status,
      error,
      setError,
      isMuted,
      startCall,
      hangUp,
      toggleMute,
      destroy: teardownDevice,
    }),
    [
      configured,
      refreshConfigured,
      status,
      error,
      isMuted,
      startCall,
      hangUp,
      toggleMute,
      teardownDevice,
    ],
  );
}
