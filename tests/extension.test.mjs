import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import register from "../plugins/visual-explainer/extension.ts";

let tool;
register({
  registerTool(definition) { tool = definition; },
  getActiveTools() { return []; },
  getAllTools() { return []; },
});

assert(tool, "visual_explainer tool registered");
const filename = "visual-explainer-extension-test.html";
const path = join(homedir(), ".agent", "diagrams", filename);

try {
  const rendered = await tool.execute("render", {
    action: "render",
    filename,
    title: "Lean test",
    bodyHtml: '<section><h2>Flow</h2><pre class="mermaid">flowchart LR\nA-->B</pre></section>',
    customCss: "section{padding:1rem}",
    open: false,
  });
  assert.equal(rendered.details.mode, "lean");

  const html = await readFile(path, "utf8");
  assert.match(html, /mermaid@11/);
  assert.match(html, /visual-explainer:body:start/);
  assert.doesNotMatch(html, /zoom-controls/);

  const source = await tool.execute("source", { action: "source", filename });
  assert.equal(source.details.title, "Lean test");
  assert.match(source.details.bodyHtml, /flowchart LR/);
  assert.equal(source.details.customCss, "section{padding:1rem}");

  const legacy = await tool.execute("render", {
    action: "render",
    filename,
    html: "<!doctype html><html><head><title>Legacy</title></head><body>Legacy</body></html>",
    open: false,
  });
  assert.equal(legacy.details.mode, "legacy");
} finally {
  await rm(path, { force: true });
}

console.log("visual-explainer lean render/source: ok");
