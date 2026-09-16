---
name: figma-design-system
description: Use when designing or building UI in Figma on top of an existing design system — discovering its foundations (color/type/spacing tokens, components), reusing components correctly, and binding to tokens instead of hardcoding. Works with ANY Figma design system; if no system reference is provided, ask for one. Triggers on requests to design a screen/feature/component in Figma, extend a product's UI, or work against a Figma library.
---

# Building on a Design System (Figma)

A way to design UI in Figma *on top of an existing design system*. You discover the system, record what you find in a per-project reference, reuse its components, and bind to its tokens — accreting knowledge as you go. **The skill holds the method; the per-project reference holds the system.**

## Rules

1. **Read-only by default.** Every file you're shown is read-only until the user explicitly points you at a workspace to write in.
2. **Confirm before writing.** Name the file you're about to modify and get a clear go-ahead. Don't infer permission from intent.

## How to operate

1. **Get the reference.** If the user hasn't given a design-system source, **ask for it**, and don't invent one. In a Figma file with none subscribed, check the libraries *available to add*, offer the relevant ones as concrete options (lead with general-purpose kits; note any that may be import-restricted), then invite a library/file URL or DTCG tokens for anything not listed. Also confirm *what* you're building and *which* file is the writable workspace.
2. **Discover foundations** by introspection (see checklist) and record them by copying `design-system-reference.template.md` into the project.
3. **Discover components on use.** The first time you reach for a component, introspect its property model; record naming axes + properties + any non-introspectable gotcha.
4. **Build on the system's framework.** Reuse its app shell / page templates / surfaces. If undocumented, inspect or ask where new UI is meant to live.
5. **Capture as you go.** Add confirmed patterns and gotchas to the reference so the next session doesn't re-learn them.

Don't front-load all discovery — probe what the current task needs.

## Working principles

- **Reuse before creating.** Search the library for an existing component before building one. The system is large — assume it exists.
- **Configure via properties; never detach.** Use a component's exposed properties (variant / text / boolean / instance-swap). Detaching severs the link and drifts from the system. A private override you'd repeat 3+ times = a missing variant — flag it, don't keep re-applying it.
- **Bind to *semantic* tokens; never hardcode.** Semantic/alias token first → component token if one fits → primitive only as a last resort (and flag it — it usually means a missing semantic token). Hardcoded values *and* primitive bindings both break theming.
- **Introspect before instantiating an unfamiliar component.** Its property model handles the whole variant space — don't grab a different set when a toggle would do.
- **Cite sources; distinguish observation from rule.** "Seen in [file/node]" ≠ "the system always does X." Confirm before codifying a pattern.

## Foundations: what to discover

Probe all four Figma constructs; record only what exists.

| Foundation | Figma construct |
|---|---|
| Color, spacing, sizing, radius, border-width, opacity, z-index — any single value + theming | **Variables** (collections + modes) |
| Typography (family / size / weight / line-height) | **Text styles** |
| Elevation / shadow / blur | **Effect styles** |
| Layout grids / breakpoints | **Grid styles** |

**Layers to look for** — *universal core* (almost always present): color, typography, spacing, sizing, corner radius, border/stroke, elevation/shadow, motion, iconography, focus & state. *Often present:* breakpoints/grid, z-index, opacity, density scale, brand assets. Don't assume — confirm which exist.

## Token tiers & theming

Three tiers; theming lives in the middle one:
1. **Primitive / global** — raw values (palette steps, base scale). Usually *not* consumed directly.
2. **Semantic / alias** — roles (`background/accent`, `text/primary`, `space/inline-md`). **Consume these.** Modes (light / dark / brand / density) repoint them, so semantic-bound UI themes automatically.
3. **Component** — per-component values; present in some systems, not all.

Systems vary (some use 2 tiers, some insert a computed tier) — map what you find onto this model.

## Components

Two layers to every component:
- **Naming axes** — encoded in the component *name* (size, role, icon-only, static-color, etc.). Pick the right set by name; these are never properties.
- **Properties** — `componentPropertyDefinitions`: variant / text / boolean / instance-swap. The same property model applies across a family.

Introspect, then set via `setProperties()` using the exact keys (they carry unique suffixes — don't guess them). Match each value to the property's **type** — variant properties take strings (even `"true"`/`"false"`), boolean properties take real booleans — so read the type from `componentPropertyDefinitions` before setting.

## Framework & surfaces

Above components, a system usually defines higher-order patterns — an app shell, page templates, and **the surfaces where new UI belongs** (a panel slot, a content area, a modal). Reuse these as the foundation for feature work rather than recomposing chrome from primitives. Discover them or ask; record them in the reference. Many systems publish authored guidance (e.g. an "agents"/"getting started" page with dev-mode annotations) — read it before building.

## Figma mechanics & gotchas

- **Verify writes against the real file.** A plugin/sandbox call reporting success ≠ persisted. Confirm significant changes by re-reading the file (metadata/introspection), not by trusting the write call. If top-level creation seems flaky, clone a known-good node and repurpose it.
- **Walk trees safely.** Only descend into container types (frame / group / component / component-set / instance / section). Accessing `.children` on a leaf (text / vector / …) throws; `"children" in n` is not a safe guard.
- **Don't edit inside instance subtrees.** To recolor/modify, configure via properties; don't recurse into a component instance and mutate its internals (breaks rendering and the link). One exception: a component's *exposed* nested instances are still configured through their own properties, which is fair game (configuration, not mutating internals).
- **Load fonts before editing text.** Call `figma.loadFontAsync(node.fontName)` before setting `.characters` or applying a text style, or the call throws. Preload the weights you'll use.
- **Author text on-spec, or it silently falls back to the Figma default font.** New text nodes take the Figma default font and never throw, so off-spec type passes the eye test. Bind text you create to one of the system's **text styles** (or set the system font family + size/weight if none fits), and verify the family against the real file rather than assuming it.
- **Preserve `opacity` when rebinding a fill to a variable** — the default of `1` silently clobbers transparency.
- **New frames default to a solid white fill.** `createFrame()` adds an opaque white fill that won't follow the theme, so for every container you create, bind its fill to a background token or clear it (`fills = []`). Skipping the swatch is not the same as removing it.
- **Deeply-nested instance overrides may not render** even when they persist in data — favor shallow, property-based changes, and verify visually.
- **Full-width components need their justify/fill property set**, not just layout resizing, or the label/icon won't recenter.
- **Size by variant, not by stretching.** A component's height, and often width, is fixed by its size variant. Forcing the instance to a larger `FIXED` size distorts it instead of resizing cleanly. To change its size, switch the size variant by name; set `FIXED`/`FILL` only on the axis you actually mean to drive and leave the other axis `HUG`.
- **Set auto-layout sizing *after* appending children.** `HUG`/`FILL` (`layoutSizing*`) and `layoutPositioning='ABSOLUTE'` often don't take when set at creation — apply them post-`appendChild` (and `ABSOLUTE` needs the parent already in auto-layout).
- **Library keys go stale; names don't.** Prefer finding components/tokens by name/search over hardcoding keys. When you do use a key, a component-*set* needs `importComponentSetByKeyAsync` (then instantiate its default variant) — `importComponentByKeyAsync` throws on a set key.

## The per-project reference

Copy `design-system-reference.template.md` into the project and keep it live — discovered foundations, component entries, framework surfaces, confirmed patterns, and gotchas accumulate there. Keep it lean: capture what introspection *can't* give back (intent, gotchas, decision criteria) and let Figma stay the source of truth for live values.

**Stamp cached components for staleness.** When you record a component by key, also store its `updatedAt` from `search_design_system`. Next session, re-search those keys and re-introspect only the components whose `updatedAt` moved, instead of rediscovering the whole system. The key is the stable identity; `updatedAt` is its version. (Variables and styles expose no `updatedAt`; since their live values resolve from Figma anyway, the only token risk is a renamed or removed key, which fails at bind time.)
