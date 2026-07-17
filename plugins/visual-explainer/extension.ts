import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";

type VisualExplainerParams = {
  action: "prepare" | "render" | "source";
  topic?: string;
  goal?: string;
  files?: string[];
  audience?: string;
  preferSubagent?: boolean;
  filename?: string;
  title?: string;
  bodyHtml?: string;
  customCss?: string;
  html?: string;
  open?: boolean;
};

type OpenStatus = "disabled" | "unsupported" | "dispatched" | "failed";

type OpenResult = {
  openAttempted: boolean;
  openStatus: OpenStatus;
  openError?: string;
};

type SubagentDetection = {
  available: boolean;
  allToolsHasSubagent?: boolean;
  error?: string;
};

type PrepareDetails = {
  action: "prepare";
  topic: string;
  goal?: string;
  audience?: string;
  files: string[];
  subagentAvailable: boolean;
  subagentAllToolsAvailable?: boolean;
  subagentDetectionError?: string;
  recommendedFlow: string[];
  subagentPrompt?: string;
};

type RenderDetails = OpenResult & {
  action: "render";
  path: string;
  mode: "lean" | "legacy";
};

type SourceDetails = {
  action: "source";
  path: string;
  title: string;
  bodyHtml: string;
  customCss: string;
};

type VisualExplainerDetails = PrepareDetails | RenderDetails | SourceDetails;

const visualExplainerParameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["prepare", "render", "source"],
      description: "Choose prepare to plan, render to wrap freeform content in the lean HTML shell, or source to retrieve editable content from an existing lean page.",
    },
    topic: {
      type: "string",
      description: "For action=prepare: what the visual explanation should cover.",
    },
    goal: {
      type: "string",
      description: "For action=prepare: what the user wants to understand, decide, or communicate.",
    },
    files: {
      type: "array",
      items: { type: "string" },
      description: "For action=prepare: relevant files or paths the agent may inspect before generating the visual explanation.",
    },
    audience: {
      type: "string",
      description: "For action=prepare: intended audience, such as developer, PM, team, reviewer, or executive.",
    },
    preferSubagent: {
      type: "boolean",
      description: "For action=prepare: when true, recommend delegate generation after the main agent gathers context. Defaults to true.",
    },
    filename: {
      type: "string",
      description: "For action=render: basename or slug for the output file. The tool appends .html if missing.",
    },
    title: {
      type: "string",
      description: "For lean action=render: document title.",
    },
    bodyHtml: {
      type: "string",
      description: "For lean action=render: arbitrary semantic HTML fragment. Use <pre class=\"mermaid\"> for diagrams.",
    },
    customCss: {
      type: "string",
      description: "For lean action=render: optional page-specific CSS. Omit when the built-in minimal styles are enough.",
    },
    html: {
      type: "string",
      description: "Legacy action=render fallback: complete HTML document. Prefer title + bodyHtml for lower token use.",
    },
    open: {
      type: "boolean",
      description: "For action=render: open the written HTML file in the browser. Defaults to true.",
    },
  },
  required: ["action"],
  additionalProperties: false,
} as const;

function detectSubagent(pi: ExtensionAPI): SubagentDetection {
  let error: string | undefined;

  try {
    return { available: pi.getActiveTools().includes("subagent") };
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  try {
    return {
      available: false,
      allToolsHasSubagent: pi.getAllTools().some((tool) => tool.name === "subagent"),
      error,
    };
  } catch (caught) {
    const fallbackError = caught instanceof Error ? caught.message : String(caught);
    return { available: false, error: error ? `${error}; ${fallbackError}` : fallbackError };
  }
}

function outputFilename(input: string) {
  const raw = input.trim().replace(/^@/, "");

  if (!raw) throw new Error("filename is required");
  if (raw.includes("/") || raw.includes("\\")) throw new Error("filename must be a basename, not a path");
  if (raw.includes("..")) throw new Error("filename must not contain '..'");
  if (/[\0-\x1f\x7f]/.test(raw)) throw new Error("filename must not contain control characters");

  return /\.html?$/i.test(raw) ? raw : `${raw}.html`;
}

function assertHtmlDocument(html: string) {
  const trimmed = html.trim();
  if (!trimmed) throw new Error("html is required");

  const start = trimmed.replace(/^\s*<!doctype\s+html\b[^>]*>\s*/i, "").replace(/^(?:<!--[\s\S]*?-->\s*)+/, "");
  if (!/^<html[\s>]/i.test(start) || !/<\/html>\s*$/i.test(trimmed)) {
    throw new Error("html must be a complete HTML document starting with <!doctype html> or <html> and ending with </html>");
  }
}

const BODY_START = "<!-- visual-explainer:body:start -->";
const BODY_END = "<!-- visual-explainer:body:end -->";
const CSS_START = "/* visual-explainer:css:start */";
const CSS_END = "/* visual-explainer:css:end */";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function markedContent(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error("file was not created with the lean visual-explainer renderer");
  return source.slice(from + start.length, to).trim();
}

function leanHtmlDocument(title: string, bodyHtml: string, customCss: string) {
  if (!title.trim()) throw new Error("title is required for lean render");
  if (!bodyHtml.trim()) throw new Error("bodyHtml is required for lean render");
  if (bodyHtml.includes(BODY_START) || bodyHtml.includes(BODY_END)) throw new Error("bodyHtml contains reserved visual-explainer markers");
  if (/<\/style\s*>/i.test(customCss) || customCss.includes(CSS_START) || customCss.includes(CSS_END)) {
    throw new Error("customCss contains reserved or closing style markup");
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title.trim())}</title>
<style>
:root{--bg:#f7f7f5;--surface:#fff;--border:#d8d8d2;--text:#20201d;--text-dim:#66665f;--accent:#176b5b;font:16px/1.55 ui-sans-serif,system-ui,sans-serif;color-scheme:light dark}
@media(prefers-color-scheme:dark){:root{--bg:#151716;--surface:#1e211f;--border:#3a3e3b;--text:#eceeea;--text-dim:#aeb4af;--accent:#67c5ad}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{width:min(100% - 2rem,72rem);margin:auto;padding:2rem 0 4rem}h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.05}h2{margin-top:2.5rem}h1,h2,h3{line-height:1.2}p,li{max-width:75ch}a{color:var(--accent)}section,article,details{min-width:0}pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.mermaid{margin:1rem 0;padding:1rem;overflow:auto;border:1px solid var(--border);border-radius:.5rem;background:var(--surface);text-align:center}.mermaid svg{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;background:var(--surface)}th,td{padding:.7rem;text-align:left;vertical-align:top;border:1px solid var(--border)}.table-wrap{overflow-x:auto}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid var(--accent);color:var(--text-dim)}img,svg{max-width:100%}@media(max-width:40rem){main{width:min(100% - 1rem,72rem);padding-top:1rem}th,td{padding:.5rem}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
${CSS_START}
${customCss.trim()}
${CSS_END}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title.trim())}</h1>
${BODY_START}
${bodyHtml.trim()}
${BODY_END}
</main>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
const dark=matchMedia("(prefers-color-scheme: dark)").matches;
mermaid.initialize({startOnLoad:true,theme:"base",themeVariables:{primaryColor:dark?"#1e4d43":"#dcefe9",primaryTextColor:dark?"#eceeea":"#20201d",primaryBorderColor:dark?"#67c5ad":"#176b5b",lineColor:dark?"#aeb4af":"#66665f",secondaryColor:dark?"#303833":"#eef4f1",tertiaryColor:dark?"#3a3220":"#fff5d6"}});
</script>
</body>
</html>`;
}

async function openInBrowser(path: string): Promise<OpenResult> {
  let command: string;
  let args: string[];

  if (process.platform === "darwin") {
    command = "open";
    args = [path];
  } else if (process.platform === "linux") {
    command = "xdg-open";
    args = [path];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", path];
  } else {
    return { openAttempted: false, openStatus: "unsupported" };
  }

  return await new Promise<OpenResult>((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    let settled = false;

    const settle = (result: OpenResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.once("error", (error) => {
      settle({
        openAttempted: true,
        openStatus: "failed",
        openError: error.message,
      });
    });

    child.once("exit", (code, signal) => {
      if (code !== 0) {
        settle({
          openAttempted: true,
          openStatus: "failed",
          openError: code === null ? `opener exited with signal ${signal ?? "unknown"}` : `opener exited with code ${code}`,
        });
      }
    });

    const timer = setTimeout(() => {
      settle({ openAttempted: true, openStatus: "dispatched" });
    }, 250);

    child.unref();
  });
}

function prepareVisualExplanation(pi: ExtensionAPI, params: VisualExplainerParams): AgentToolResult<VisualExplainerDetails> {
  if (typeof params.topic !== "string") throw new Error("topic must be a string for action=prepare");
  if (params.goal !== undefined && typeof params.goal !== "string") throw new Error("goal must be a string when provided");
  if (params.audience !== undefined && typeof params.audience !== "string") throw new Error("audience must be a string when provided");
  if (params.files !== undefined && (!Array.isArray(params.files) || !params.files.every((file) => typeof file === "string"))) {
    throw new Error("files must be an array of strings when provided");
  }
  if (params.preferSubagent !== undefined && typeof params.preferSubagent !== "boolean") {
    throw new Error("preferSubagent must be a boolean when provided");
  }

  const topic = params.topic.trim();
  if (!topic) throw new Error("topic is required");

  const goal = params.goal?.trim();
  const audience = params.audience?.trim();
  const files = params.files?.map((file) => file.trim()).filter(Boolean) ?? [];
  const subagent = detectSubagent(pi);
  const shouldUseSubagent = params.preferSubagent !== false && subagent.available;
  const subagentPrompt = shouldUseSubagent
    ? `Generate only a freeform semantic HTML fragment for a visual explanation about ${topic}.${goal ? ` The user goal is: ${goal}.` : ""}${files.length ? ` Use the gathered context from these files/paths: ${files.join(", ")}.` : ""} Use <pre class="mermaid"> blocks for diagrams. Return bodyHtml and only the minimal customCss the composition needs; do not generate document boilerplate, Mermaid JavaScript, a Markdown fence, or an acceptance report.`
    : undefined;
  const recommendedFlow = shouldUseSubagent
    ? [
        "Gather the needed repo context directly in the main agent.",
        "Synthesize the findings into a concise visual outline for the target audience.",
        "Read a visual-explainer reference only when the content needs a specialized pattern.",
        "Run the delegate with acceptance=false and inline output to generate only freeform bodyHtml plus optional minimal customCss.",
        "Call visual_explainer with action=render, filename, title, bodyHtml, customCss, and optional open.",
      ]
    : [
        "Gather the needed context directly in the main agent.",
        "Create a concise visual outline for the target audience.",
        "Read a visual-explainer reference only when the content needs a specialized pattern.",
        "Generate freeform semantic bodyHtml with <pre class=\"mermaid\"> diagrams and optional minimal customCss.",
        "Call visual_explainer with action=render, filename, title, bodyHtml, customCss, and optional open.",
      ];

  const summaryLines = [
    `Prepared visual explanation for: ${topic}`,
    goal ? `Goal: ${goal}` : undefined,
    audience ? `Audience: ${audience}` : undefined,
    shouldUseSubagent ? "Recommended generation: use the delegate subagent after gathering context." : "Recommended start: gather context directly in this session.",
    "Recommended flow:",
    ...recommendedFlow.map((step, i) => `${i + 1}. ${step}`),
    subagentPrompt ? `Suggested subagent task:\n${subagentPrompt}` : undefined,
  ];

  return {
    content: [{ type: "text" as const, text: summaryLines.filter((line): line is string => Boolean(line)).join("\n") }],
    details: {
      action: "prepare",
      topic,
      goal,
      audience,
      files,
      subagentAvailable: subagent.available,
      subagentAllToolsAvailable: subagent.allToolsHasSubagent,
      subagentDetectionError: subagent.error,
      recommendedFlow,
      subagentPrompt,
    },
  };
}

function diagramPath(params: VisualExplainerParams) {
  if (typeof params.filename !== "string") throw new Error("filename must be a string");
  return join(homedir(), ".agent", "diagrams", outputFilename(params.filename));
}

function readVisualSource(params: VisualExplainerParams): AgentToolResult<VisualExplainerDetails> {
  const path = diagramPath(params);
  const html = readFileSync(path, "utf8");
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&") ?? "";
  const bodyHtml = markedContent(html, BODY_START, BODY_END);
  const customCss = markedContent(html, CSS_START, CSS_END);
  const details: SourceDetails = { action: "source", path, title, bodyHtml, customCss };

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ title, bodyHtml, customCss }) }],
    details,
  };
}

async function renderVisualExplanation(params: VisualExplainerParams, signal?: AbortSignal): Promise<AgentToolResult<VisualExplainerDetails>> {
  if (params.open !== undefined && typeof params.open !== "boolean") throw new Error("open must be a boolean when provided");

  const lean = params.bodyHtml !== undefined || params.title !== undefined || params.customCss !== undefined;
  let html: string;
  if (lean) {
    if (typeof params.title !== "string") throw new Error("title must be a string for lean render");
    if (typeof params.bodyHtml !== "string") throw new Error("bodyHtml must be a string for lean render");
    if (params.customCss !== undefined && typeof params.customCss !== "string") throw new Error("customCss must be a string when provided");
    html = leanHtmlDocument(params.title, params.bodyHtml, params.customCss ?? "");
  } else {
    if (typeof params.html !== "string") throw new Error("render requires title + bodyHtml, or legacy html");
    assertHtmlDocument(params.html);
    html = params.html;
  }

  signal?.throwIfAborted();
  const outputPath = diagramPath(params);
  const outputDir = join(homedir(), ".agent", "diagrams");
  mkdirSync(outputDir, { recursive: true });
  if (lstatSync(outputDir).isSymbolicLink()) throw new Error(`${outputDir} must not be a symlink`);
  if (existsSync(outputPath) && lstatSync(outputPath).isSymbolicLink()) throw new Error(`${outputPath} must not be a symlink`);

  signal?.throwIfAborted();
  writeFileSync(outputPath, html, "utf8");
  signal?.throwIfAborted();

  const openResult = params.open === false
    ? { openAttempted: false, openStatus: "disabled" as const }
    : await openInBrowser(outputPath);
  let message = `Wrote ${outputPath} using the ${lean ? "lean" : "legacy"} renderer.`;
  if (openResult.openStatus === "dispatched") message += " Browser open requested.";
  else if (openResult.openStatus === "failed") message += ` Browser open failed: ${openResult.openError ?? "unknown error"}.`;
  else if (openResult.openStatus === "unsupported") message += " Browser opening is unsupported on this platform.";

  return {
    content: [{ type: "text" as const, text: message }],
    details: { action: "render", path: outputPath, mode: lean ? "lean" : "legacy", ...openResult },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof visualExplainerParameters, VisualExplainerDetails>({
    name: "visual_explainer",
    label: "Visual Explainer",
    description: "Plan a visual explanation, render freeform body HTML through a lean Mermaid shell, or retrieve lean source for efficient edits under ~/.agent/diagrams/.",
    promptSnippet: "Prefer lean render with title, freeform bodyHtml, and optional minimal customCss; use source before editing an existing lean page.",
    promptGuidelines: [
      "After generating or reviewing a plan, architecture, diff, or substantial implementation, consider offering a visual explanation if it would clarify the work for the user.",
      "Because visual explanations can consume many tokens, ask before calling visual_explainer with action=prepare unless the user explicitly requested a diagram, visual review, recap, or visual plan.",
      "When prepare recommends delegation, gather context first, then run the delegate with acceptance=false and inline output; request only freeform bodyHtml and optional minimal customCss, not document boilerplate or Mermaid JavaScript.",
      "Render with filename, title, bodyHtml, and optional customCss. Use <pre class=\"mermaid\"> for diagrams; the extension supplies the document shell and Mermaid runtime.",
      "Before editing a lean page, use action=source to retrieve only its title, bodyHtml, and customCss, then render the revision.",
    ],
    parameters: visualExplainerParameters,
    executionMode: "sequential",
    async execute(_toolCallId: string, params: VisualExplainerParams, signal?: AbortSignal) {
      if (params.action !== "prepare" && params.action !== "render" && params.action !== "source") {
        throw new Error("action must be 'prepare', 'render', or 'source'");
      }

      if (params.action === "prepare") return prepareVisualExplanation(pi, params);
      if (params.action === "source") return readVisualSource(params);
      return await renderVisualExplanation(params, signal);
    },
  });
}
