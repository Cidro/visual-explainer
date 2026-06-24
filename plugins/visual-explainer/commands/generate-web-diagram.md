---
description: Generate a beautiful standalone HTML diagram and open it in the browser
---
Load the visual-explainer skill, then generate an HTML diagram for: $@

Follow the visual-explainer skill workflow. Read the reference template and CSS patterns before generating. Pick a distinctive aesthetic that fits the content — vary fonts, palette, and layout style from previous diagrams.

If `surf` CLI is available (`which surf`), consider generating an AI illustration via `surf gemini --generate-image` when an image would genuinely enhance the page — a hero banner, conceptual illustration, or educational diagram that Mermaid can't express. Match the image style to the page's palette. Embed as base64 data URI. See css-patterns.md "Generated Images" for container styles. Skip images when the topic is purely structural or data-driven.

Write to `~/.agent/diagrams/` and open the result in the browser. In Pi package installs, this command is already an explicit visual request, so use `visual_explainer` with `action: "prepare"` first when the topic needs planning or context scouting, then use `action: "render"` as the final step with a basename-style filename and the complete HTML document.
