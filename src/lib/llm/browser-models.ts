/**
 * Language models that run inside the visitor's browser (Transformers.js, WebGPU or WASM).
 *
 * They make generation free and always available on a static deployment: no server, no API key,
 * and prompts never leave the device. Both entries were picked with the browser benchmark in
 * scripts/llm-bench, which scores grounded answers, refusals, citations and JSON output over the
 * app's real prompts; the table and the rejected candidates are in docs/DESIGN_DECISIONS.md.
 *
 * Weights are the 4-bit "q4" ONNX exports: 4-bit matrix weights with 32-bit activations. The
 * smaller "q4f16" files (16-bit activations) produced garbage on a mainstream integrated GPU in
 * that benchmark, so they are not used.
 */
export interface BrowserModelInfo {
  id: string;
  label: string;
  parameters: string;
  /** Size of the q4 ONNX weights, downloaded once and cached by the browser. */
  downloadMb: number;
  license: string;
  licenseUrl: string;
  description: string;
}

export const BROWSER_MODELS: BrowserModelInfo[] = [
  {
    id: "onnx-community/LFM2-1.2B-ONNX",
    label: "LFM2 1.2B",
    parameters: "1.2B",
    downloadMb: 850,
    license: "LFM Open License v1.0",
    licenseUrl: "https://huggingface.co/LiquidAI/LFM2-1.2B/blob/main/LICENSE",
    description: "Recommended: cited every answer in our benchmark, invented no numbers and refused what the documents do not cover.",
  },
  {
    id: "onnx-community/LFM2-700M-ONNX",
    label: "LFM2 700M",
    parameters: "0.7B",
    downloadMb: 559,
    license: "LFM Open License v1.0",
    licenseUrl: "https://huggingface.co/LiquidAI/LFM2-700M/blob/main/LICENSE",
    description: "Half the download and about twice as fast, but it invents details more often — watch the verification badges.",
  },
];

export const DEFAULT_BROWSER_MODEL_ID = BROWSER_MODELS[0].id;

export function getBrowserModel(id: string | undefined): BrowserModelInfo {
  return BROWSER_MODELS.find((m) => m.id === id) ?? BROWSER_MODELS[0];
}

/** URL of the largest file of a model, used to check whether it is already in the browser cache. */
export function browserModelWeightsUrl(id: string): string {
  return `https://huggingface.co/${id}/resolve/main/onnx/model_q4.onnx`;
}
