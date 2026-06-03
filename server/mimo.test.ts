import { describe, expect, it } from "vitest";
import {
  MAX_CLONE_BASE64_LENGTH,
  buildMimoPayload,
  extractNonStreamingAudioBase64,
  extractPcmChunksFromSseText,
  mapMimoError,
  pcm16ToWav,
  sanitizePayload
} from "./mimo";

describe("buildMimoPayload", () => {
  it("builds builtin voice payload", () => {
    const payload = buildMimoPayload({
      mode: "builtin",
      text: "你好，欢迎使用 MiMo。",
      stylePrompt: "用温暖平稳的语气朗读。",
      voice: "Chloe"
    });

    expect(payload).toMatchObject({
      model: "mimo-v2.5-tts",
      messages: [
        { role: "user", content: "用温暖平稳的语气朗读。" },
        { role: "assistant", content: "你好，欢迎使用 MiMo。" }
      ],
      audio: { format: "wav", voice: "Chloe" }
    });
  });

  it("requires a voice design prompt", () => {
    expect(() =>
      buildMimoPayload({
        mode: "design",
        text: "晚安，今晚月色很好。"
      })
    ).toThrow("VoiceDesign 模式需要填写音色描述。");
  });

  it("builds voice design payload without preset voice", () => {
    const payload = buildMimoPayload({
      mode: "design",
      text: "晚安，今晚月色很好。",
      stylePrompt: "温柔舒缓的女声，语速较慢。"
    });

    expect(payload.model).toBe("mimo-v2.5-tts-voicedesign");
    expect(payload.audio).toEqual({ format: "wav" });
  });

  it("builds voice clone payload with data uri and redacts preview", () => {
    const payload = buildMimoPayload({
      mode: "clone",
      text: "这是一段克隆音色测试。",
      cloneSample: {
        fileName: "voice.mp3",
        mimeType: "audio/mpeg",
        base64: Buffer.from("sample").toString("base64")
      }
    });

    expect(payload.model).toBe("mimo-v2.5-tts-voiceclone");
    expect(payload.audio.voice).toMatch(/^data:audio\/mpeg;base64,/);
    expect(sanitizePayload(payload).audio.voice).toBe("data:audio/mpeg;base64,<redacted>");
  });

  it("rejects oversized voice clone base64", () => {
    expect(() =>
      buildMimoPayload({
        mode: "clone",
        text: "oversized",
        cloneSample: {
          fileName: "voice.wav",
          base64: "a".repeat(MAX_CLONE_BASE64_LENGTH + 1)
        }
      })
    ).toThrow("音色样本 Base64 后不能超过 10 MB。");
  });

  it("sets pcm16 for stream-compatible payloads", () => {
    const payload = buildMimoPayload({
      mode: "builtin",
      text: "stream",
      stream: true
    });

    expect(payload.audio.format).toBe("pcm16");
    expect(payload.stream).toBe(true);
  });
});

describe("audio extraction", () => {
  it("extracts non-streaming audio data", () => {
    const response = {
      choices: [{ message: { audio: { data: "UklGRg==" } } }]
    };

    expect(extractNonStreamingAudioBase64(response)).toBe("UklGRg==");
  });

  it("extracts pcm chunks from SSE text", () => {
    const pcm = Buffer.from([1, 2, 3, 4]).toString("base64");
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: pcm } } }] })}`,
      "",
      "data: [DONE]",
      ""
    ].join("\n");

    const chunks = extractPcmChunksFromSseText(sse);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("wraps pcm16 in a wav container", () => {
    const wav = pcm16ToWav(Buffer.from([0, 0, 1, 0]));

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(4);
  });
});

describe("error mapping", () => {
  it("maps common MiMo error statuses", () => {
    expect(mapMimoError(401)).toContain("鉴权失败");
    expect(mapMimoError(429)).toContain("请求过于频繁");
    expect(mapMimoError(503)).toContain("负载较高");
  });
});
