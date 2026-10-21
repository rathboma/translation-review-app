<script setup lang="ts">
// The English page on the left, the translated copy on the right, each in an
// iframe (srcdoc, sandbox="allow-same-origin": no scripts, but this component
// can read selections and clicks in them). Hovering a segment lights it and its
// counterpart on the other side; the two scroll together, by segment; a click
// or a selection says which segment the translator is after.
import { onBeforeUnmount, ref, watch } from "vue";
import type { AnnotatedPage } from "../../shared/types.ts";
import { clickedSegment, readSelection, segmentOf } from "../lib/selection.ts";
import { anchorAt, clearClass, scrollToAnchor, toggleClass } from "../lib/sync.ts";
import { state, type Anchor } from "../lib/state.ts";

type Side = "english" | "translated";

const props = defineProps<{ page: AnnotatedPage; label: string; selectedId: string | null }>();
const emit = defineEmits<{
  pick: [pick: { id: string; side: Side; selection: { text: string; hint: number } | null; anchor: Anchor }];
  notice: [message: string];
}>();

const english = ref<HTMLIFrameElement | null>(null);
const translated = ref<HTMLIFrameElement | null>(null);
const frameOf = (side: Side) => (side === "english" ? english : translated).value;
const docs: Partial<Record<Side, Document>> = {};
const other = (side: Side): Side => (side === "english" ? "translated" : "english");
const loaded = () => Object.values(docs).filter((d): d is Document => !!d && !!d.defaultView);

let hovered: string | null = null;
// A scroll we caused ourselves, which must not scroll the other page back.
const echo: Record<Side, boolean> = { english: false, translated: false };
let frame = 0;

const idAt = (target: EventTarget | null) => segmentOf(target as Node | null)?.getAttribute("data-seg") ?? null;

// A rectangle in a page's viewport, in the app's.
function anchorOf(side: Side, box: { top: number; bottom: number; left: number; right: number }): Anchor {
  const at = frameOf(side)!.getBoundingClientRect();
  return { top: at.top + box.top, bottom: at.top + box.bottom, left: at.left + box.left, right: at.left + box.right, side };
}

function hover(id: string | null): void {
  if (id === hovered) return;
  if (hovered) toggleClass(loaded(), hovered, "rv-hover", false);
  hovered = id;
  if (id) toggleClass(loaded(), id, "rv-hover", true);
}

// The segments with notes, and the one being edited.
function marks(): void {
  const all = loaded();
  clearClass(all, "rv-noted");
  clearClass(all, "rv-selected");
  for (const note of state.notes) {
    if (note.lang !== props.page.lang || note.path !== props.page.path) continue;
    const segment = props.page.segments.find((s) => s.scope === note.scope && s.key === note.key);
    if (segment) toggleClass(all, segment.id, "rv-noted", true);
  }
  if (props.selectedId) toggleClass(all, props.selectedId, "rv-selected", true);
}

// A click opens the editor, but a double or triple click is a person selecting
// a word or a paragraph: the editor waits a moment to see which it is.
const CLICK_WAIT = 250;
let pending: ReturnType<typeof setTimeout> | undefined;
const cancelPending = () => clearTimeout(pending);

function onClick(side: Side, event: MouseEvent): void {
  // The pages are for reading: nothing in them is followed or submitted.
  event.preventDefault();
  cancelPending();
  if (event.detail > 1) return;
  const selection = docs[side]?.getSelection();
  if (selection && !selection.isCollapsed) return;
  const element = clickedSegment(event.target);
  if (!element) return;
  const id = element.getAttribute("data-seg")!;
  pending = setTimeout(() => {
    if (docs[side]?.getSelection()?.isCollapsed === false) return;
    emit("pick", { id, side, selection: null, anchor: anchorOf(side, element.getBoundingClientRect()) });
  }, CLICK_WAIT);
}

function onSelect(side: Side): void {
  const doc = docs[side];
  if (!doc) return;
  const result = readSelection(doc);
  // Only a selection cancels a click that is waiting: a mouse-up with none is the click's own.
  if (result.kind !== "none") cancelPending();
  if (result.kind === "several") emit("notice", "Select within one paragraph.");
  if (result.kind !== "segment") return;
  const { id, text, start, rect } = result.selection;
  // On the translated page the selected words are the ones to retype; on the
  // English page they say which paragraph, and the whole translation is shown.
  emit("pick", { id, side, selection: side === "translated" ? { text, hint: start } : null, anchor: anchorOf(side, rect) });
}

function onScroll(side: Side): void {
  if (echo[side]) {
    echo[side] = false;
    return;
  }
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const from = docs[side];
    const to = docs[other(side)];
    if (!from || !to) return;
    const anchor = anchorAt(from);
    if (anchor && scrollToAnchor(to, anchor)) {
      echo[other(side)] = true;
      // If it did not need to scroll, no event comes to clear this.
      setTimeout(() => (echo[other(side)] = false), 120);
    }
  });
}

function attach(side: Side): void {
  const el = frameOf(side);
  const doc = el?.contentDocument;
  const win = el?.contentWindow;
  if (!doc || !win) return;
  docs[side] = doc;
  doc.addEventListener("mouseover", (event) => hover(idAt(event.target)));
  doc.addEventListener("mouseleave", () => hover(null));
  doc.addEventListener("mousedown", cancelPending);
  doc.addEventListener("click", (event) => onClick(side, event as MouseEvent));
  doc.addEventListener("mouseup", () => setTimeout(() => onSelect(side), 0));
  win.addEventListener("scroll", () => onScroll(side), { passive: true });
  hovered = null;
  marks();
}

watch(() => [props.selectedId, props.page, state.notes.length, state.notes.map((n) => n.key + n.scope).join("|")], marks, { flush: "post" });
watch(() => props.page, () => {
  delete docs.english;
  delete docs.translated;
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  cancelPending();
});
</script>

<template>
  <div class="split">
    <section class="pane" aria-label="English page">
      <header class="pane-head"><span>English</span></header>
      <iframe ref="english" title="English page" :srcdoc="page.english" sandbox="allow-same-origin" @load="attach('english')"></iframe>
    </section>
    <section class="pane" :aria-label="`${label} page`">
      <header class="pane-head"><span>{{ label }}</span></header>
      <iframe ref="translated" :title="`${label} page`" :srcdoc="page.translated" sandbox="allow-same-origin" @load="attach('translated')"></iframe>
    </section>
  </div>
</template>
