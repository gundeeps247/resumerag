import type { NextConfig } from "next";

/**
 * Security headers. The Content-Security-Policy allows exactly what the app needs:
 *  - WebAssembly compilation for ONNX Runtime ('wasm-unsafe-eval')
 *  - ONNX Runtime's .wasm files from jsDelivr (its loader re-imports them as blob: URLs,
 *    so blob: scripts must be allowed), model weights from the Hugging Face Hub
 *  - an optional direct connection to a local Ollama server ("private mode")
 * Everything else (scripts from other origins, framing by other sites) is blocked.
 *
 * Cross-origin isolation (COOP + COEP) unlocks SharedArrayBuffer, which ONNX Runtime needs
 * to run its WebAssembly on several threads. Without it, embedding and reranking are
 * single-threaded. Every cross-origin load (model weights, runtime files, local Ollama) is a
 * CORS request, which "require-corp" allows.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net http://localhost:* http://127.0.0.1:*" +
    (isDev ? " ws://localhost:*" : ""),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  devIndicators: { position: "bottom-right" },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
