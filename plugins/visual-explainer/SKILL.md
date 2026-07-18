---
name: visual-explainer
description: Generate self-contained HTML visual explanations for systems, code changes, plans, data, and technical concepts. Use for diagrams, architecture overviews, diff or plan reviews, project recaps, comparison tables, slide decks, and other visual explanations.
license: MIT
compatibility: Requires a browser to view generated HTML files. Optional surf-cli for AI image generation.
metadata:
  author: nicobailon
  version: "0.8.3"
---

# Visual Explainer

Generate self-contained HTML pages that explain systems, code changes, plans, data, and technical concepts visually. Use this skill for diagram requests, architecture overviews, diff/plan reviews, project recaps, comparison tables, slide decks, and any visual explanation.

## Trigger and delivery rules

- Prefer an HTML page over terminal ASCII when the output is inherently visual.
- If a table would have 4+ rows or 3+ columns, render it as HTML and give only a short chat summary.
- Write files to `~/.agent/diagrams/` or the explicit eval output path. Use descriptive filenames.
- Open generated pages in the browser when running normally. In Pi package installs, prefer `visual_explainer` lean rendering with `title`, freeform `bodyHtml`, and optional minimal `customCss`; the extension supplies the complete document and Mermaid runtime.
- Keep page composition flexible: the model may generate any semantic HTML structure, including sections, cards, timelines, tables, details, and diagrams. Do not force content into a fixed schema.
- Use `<pre class="mermaid">...</pre>` for diagrams. Do not generate Mermaid imports, initialization, zoom controls, or document boilerplate in lean mode.
- **Mandatory:** When the `delegate` subagent is available, you MUST use its configured lower-cost model to generate only `bodyHtml` and optional `customCss`. The main session MUST NOT generate or write the HTML; it may only gather context, invoke `delegate`, and pass the result to `visual_explainer.render`. Invoke `delegate` with `acceptance: false`, request output inline, and do not impose a restrictive tool budget. Generate HTML in the main session only when `delegate` is unavailable or fails, and tell the user when using that fallback.
- Before editing a lean page, call `visual_explainer` with `action=source` and its basename; revise the returned source and render again instead of reading the complete generated document.
- Use legacy complete-HTML rendering only for slide decks or when the lean shell cannot support an explicitly requested interaction.

## Reference routing

Lean pages usually need no reference: use semantic HTML, Mermaid blocks, and minimal page-specific CSS. Read only a reference needed for a specialized composition:

| Need | Read |
|---|---|
| Text-heavy architecture/cards | `./templates/architecture.html` |
| Mermaid flowcharts, sequence, ER, state, class, C4, data flow | `./templates/mermaid-flowchart.html`, Mermaid sections in `./references/libraries.md` |
| Data tables, comparisons, audits | `./templates/data-table.html` |
| Slide decks | `./templates/slide-deck.html`, `./references/slide-patterns.md` |
| CSS layout, overflow, depth, collapsibles, SVG connectors, generated images | `./references/css-patterns.md` |
| Pages with 4+ major sections | `./references/responsive-nav.md` |
| Prose-heavy pages | “Prose Page Elements” in `css-patterns.md`, typography sections in `libraries.md` |

## Choose the representation

| Content | Default representation |
|---|---|
| Flowchart, pipeline, state machine, decision tree | Mermaid |
| Sequence, ER/schema, class, C4, topology-focused architecture | Mermaid |
| Text-heavy architecture, module internals, implementation plans | CSS grid cards, optionally with a Mermaid overview |
| 15+ element architecture | Hybrid: small Mermaid overview + CSS detail cards |
| Comparison/audit/status matrix | Semantic HTML `<table>` |
| Timeline/roadmap | CSS timeline |
| Dashboard/metrics | CSS grid + charts/KPIs |
| Slide deck | `100dvh` slides using slide template patterns |

## Mermaid invariants

- In lean mode, emit bare `<pre class="mermaid">` source blocks; the extension initializes Mermaid 11 with a responsive base theme.
- Prefer `flowchart TD` for complex diagrams. Use `LR` only for simple 3–4 node linear flows.
- Use `<br/>` in quoted flowchart labels. Do not use escaped `\n` labels.
- Never define page-level `.node`; Mermaid uses it internally. Use namespaced page classes such as `.ve-card`.
- For 15+ elements, do not cram everything into one Mermaid diagram. Use a small overview plus semantic HTML detail cards.

## Layout and style invariants

- Use semantic HTML where it helps accessibility and copy/paste: `<table>`, headings, lists, `<details>`, captions.
- Use CSS custom properties for palette: `--bg`, `--surface`, `--border`, `--text`, `--text-dim`, and 3–5 accents.
- Pick a clear aesthetic direction before writing: blueprint, editorial, paper/ink, terminal, IDE-inspired, or data-dense.
- Avoid generic defaults: no body font that is only Inter, Roboto, Arial, Helvetica, or system-ui; no violet/fuchsia Tailwind-default accents as the main palette (`#8b5cf6`, `#7c3aed`, `#a78bfa`, `#d946ef`); no cyan+magenta+purple neon dashboard; no gradient-mesh blobs.
- Good font pair families: DM Sans + Fira Code; Instrument Serif + JetBrains Mono; IBM Plex Sans + IBM Plex Mono; Bricolage Grotesque + Fragment Mono; Plus Jakarta Sans + Azeret Mono.
- Good accent directions: terracotta+sage, teal+slate, rose+cranberry, amber+emerald, deep blue+gold.
- Prevent overflow: `min-width: 0` on grid/flex children, `overflow-wrap: break-word` for long text, and scroll containers for wide tables/code.
- Do not set `display: flex` directly on `<li>` when list markers matter.
- Use depth sparingly: hero/elevated only for primary sections; flat/recessed for reference material.
- Use entrance/hover animation only when it clarifies hierarchy. Respect `prefers-reduced-motion`. Do not use continuous glow, pulse, or breathing effects on static content.

## Slide deck mode

Use slides only when explicitly requested or when a command asks for slides. Slides are a different medium, not a paginated article:

- Each slide is one viewport (`100dvh`) with no page-level scrolling.
- Use larger type, fewer objects per slide, varied compositions, and visible navigation.
- Include slide nav chrome from `slide-deck.html`: prev/next controls, slide count, keyboard navigation, and carousel dots/indicators.
- Before writing HTML, inventory the source and map every source item to slides.
- Do not drop content to fit a fixed slide count. Add slides instead.
- Use the 10 slide types from `slide-patterns.md`: Title, Section Divider, Content, Split, Diagram, Dashboard, Table, Code, Quote, Full-Bleed.

## Optional generated images

If `surf` is available, generated images may be embedded as base64 for hero banners, conceptual illustrations, or educational visuals. Skip images for data-heavy, structural, or Mermaid/CSS-suitable content. Pages must stand on CSS, typography, and diagrams without images.

## Final checklist

Before delivery, verify:

- lean output uses `title` + freeform `bodyHtml` and only necessary `customCss`;
- output written to the requested path;
- no console errors when opened;
- no horizontal overflow at normal desktop width;
- tables preserve rows/columns and wrap long text;
- Mermaid source is valid and uses `<pre class="mermaid">`;
- slides use legacy complete-HTML mode, fit one viewport, include navigation, and preserve source coverage;
- visual hierarchy makes the main idea obvious in the first viewport.
