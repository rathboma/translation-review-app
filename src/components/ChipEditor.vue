<script setup lang="ts">
// The new translation's text box. An html translation is shown as text with
// its inline tags (links, bold, code...) as chips: they can be dragged (or
// moved with Alt+arrows) but not typed over, backspaced or cut, so a link can
// move and cannot break or be dropped. Replacing a selection that has chips in
// it replaces its text and leaves the chips. Whatever is typed comes back to
// the parent as html (text encoded, tags exactly as they were).
//
// A browser edits a contenteditable with non-editable chips in it badly where
// the two meet: empty the text between a link's two chips and it drops the text
// node, and what is typed next lands outside the link. So every text node
// beside a chip carries a zero-width guard character at its chip side (never
// part of the translation: it is left out when the text is read). With it the
// words of a link can all be deleted and retyped, by keyboard or IME, in the
// browser's own way, and the link is still where they go. What the browser
// cannot be left to do (anything that touches a chip) is done here, on the text
// nodes; those edits are not on its undo stack, so undo and redo are kept here too.
import { nextTick, onMounted, ref, watch } from "vue";
import { chipLabel, locate, parseParts, plainText, serializeParts, wellNested, type Part } from "../../shared/chips.ts";

type TagPart = Extract<Part, { type: "tag" }>;

const props = defineProps<{
  modelValue: string;
  // An html segment (with tags), or plain text.
  html: boolean;
  // Select this text once shown (a selection made on the translated page), or all of it.
  preselect?: { text: string; hint: number } | "all" | null;
  label: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const GUARD = "\u200b";
const GUARDS = /\u200b/g;
const HISTORY = 200;

const root = ref<HTMLDivElement | null>(null);
const nudge = ref(false);
let dragged: HTMLElement | null = null;
let active: HTMLElement | null = null;
let last = props.modelValue;
let past: string[] = [props.modelValue];
let future: string[] = [];

// ---- the text box and the html ---------------------------------------------

function chipEl(part: TagPart): HTMLElement {
  const el = document.createElement("span");
  el.className = `chip chip-${part.role}`;
  el.contentEditable = "false";
  el.draggable = true;
  el.dataset.html = part.html;
  el.title = part.html;
  el.textContent = chipLabel(part);
  return el;
}

const isChip = (node: Node | null): node is HTMLElement => !!node && node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains("chip");
const isText = (node: Node | null): node is Text => !!node && node.nodeType === Node.TEXT_NODE;

// Every chip with a text node on each side, and a guard at each of their chip-side edges.
function addGuards(): void {
  for (const chip of Array.from(root.value!.querySelectorAll<HTMLElement>(".chip"))) {
    if (!isText(chip.previousSibling)) chip.before(document.createTextNode(""));
    if (!isText(chip.nextSibling)) chip.after(document.createTextNode(""));
    const before = chip.previousSibling as Text;
    const after = chip.nextSibling as Text;
    if (!before.data.endsWith(GUARD)) before.appendData(GUARD);
    if (!after.data.startsWith(GUARD)) after.insertData(0, GUARD);
  }
}

function build(value: string): void {
  const el = root.value!;
  el.replaceChildren();
  const parts: Part[] = props.html ? parseParts(value) : value ? [{ type: "text", value }] : [];
  for (const part of parts) el.append(part.type === "text" ? document.createTextNode(part.value) : chipEl(part));
  addGuards();
  active = null;
}

function readParts(): Part[] {
  const parts: Part[] = [];
  const text = (value: string) => {
    const clean = value.replace(GUARDS, "");
    if (!clean) return;
    const previous = parts[parts.length - 1];
    if (previous?.type === "text") previous.value += clean;
    else parts.push({ type: "text", value: clean });
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (isText(child)) text(child.data);
      else if (isChip(child)) parts.push(parseParts(child.dataset.html!)[0]);
      else if (child instanceof HTMLElement && child.tagName !== "BR") walk(child);
    }
  };
  walk(root.value!);
  return parts;
}

const serialize = (parts: Part[]): string => (props.html ? serializeParts(parts) : plainText(parts));
const read = (): string => serialize(readParts());

// Guards belong at the chip side of a text node, one each. Others (left where a
// chip was moved from, or typed before) are invisible breaks in the middle of
// words, and a Delete or Backspace at one would do nothing.
function tidyGuards(): void {
  for (const node of textNodes()) {
    for (let i = node.data.length - 1; i >= 0; i--) {
      if (node.data[i] !== GUARD) continue;
      const atStart = i === 0 && isChip(node.previousSibling);
      const atEnd = i === node.data.length - 1 && isChip(node.nextSibling);
      // (deleteData keeps a selection in the node where it was.)
      if (!atStart && !atEnd) node.deleteData(i, 1);
    }
    while (node.data.startsWith(GUARD + GUARD)) node.deleteData(0, 1);
    while (node.data.endsWith(GUARD + GUARD)) node.deleteData(node.data.length - 1, 1);
  }
}

// After an edit: text nodes the browser or an edit left empty are gone, stray
// guards too, and the guards that belong are back.
function repair(): void {
  for (const node of textNodes()) if (node.data === "") node.remove();
  tidyGuards();
  addGuards();
}

function changed(): void {
  repair();
  const value = read();
  if (value === last) return;
  last = value;
  if (past[past.length - 1] !== value) {
    past.push(value);
    if (past.length > HISTORY) past.shift();
    future = [];
  }
  emit("update:modelValue", value);
}

const chips = (): HTMLElement[] => Array.from(root.value!.querySelectorAll<HTMLElement>(".chip"));

// ---- selection ------------------------------------------------------------

function textNodes(): Text[] {
  const out: Text[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (isText(child)) out.push(child);
      else if (child instanceof HTMLElement && !isChip(child)) walk(child);
    }
  };
  walk(root.value!);
  return out;
}

// The index in `node.data` where `real` characters that are not guards have
// gone by. Guards may sit there too: a start goes after them, an end before.
function domOffset(node: Text, real: number, edge: "start" | "end"): number {
  const data = node.data;
  let seen = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i <= data.length; i++) {
    if (seen === real) {
      if (first === -1) first = i;
      last = i;
    }
    if (i < data.length && data[i] !== GUARD) seen++;
  }
  if (first === -1) return data.length;
  return edge === "start" ? last : first;
}

// Selects characters [start, end) of the text (chips and guards take no room).
// Where a boundary is the end of one text node and the start of the next (a
// chip between), a start belongs to the later node and an end to the earlier:
// the selection is the words, not the chip beside them.
function selectText(start: number, end: number): void {
  const nodes = textNodes();
  let offset = 0;
  let from: [Text, number] | null = null;
  let to: [Text, number] | null = null;
  nodes.forEach((node, i) => {
    const length = node.data.replace(GUARDS, "").length;
    if (!from && (start < offset + length || i === nodes.length - 1)) from = [node, domOffset(node, Math.min(start - offset, length), "start")];
    if (!to && end <= offset + length) to = [node, domOffset(node, end - offset, "end")];
    offset += length;
  });
  if (!from || !to) return selectAll();
  const range = document.createRange();
  range.setStart(...(from as [Text, number]));
  range.setEnd(...(to as [Text, number]));
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectAll(): void {
  const range = document.createRange();
  range.selectNodeContents(root.value!);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretToEnd(): void {
  const range = document.createRange();
  range.selectNodeContents(root.value!);
  range.collapse(false);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function focus(): void {
  root.value?.focus();
}

function applyPreselect(): void {
  focus();
  const wanted = props.preselect;
  if (!wanted) return;
  if (wanted === "all") return selectAll();
  const found = locate(plainText(props.html ? parseParts(props.modelValue) : [{ type: "text", value: props.modelValue }]), wanted.text, wanted.hint);
  if (found) selectText(found[0], found[1]);
  else selectAll();
}

// ---- editing ---------------------------------------------------------------

function flash(): void {
  nudge.value = true;
  setTimeout(() => (nudge.value = false), 900);
}

// What an edit applies to: the selection, if there is one (the browser's own
// target range for it is moved to the outside of any chip beside it), else its target range.
function targetRange(event: InputEvent): Range | null {
  const selection = window.getSelection();
  const el = root.value!;
  if (selection && selection.rangeCount && !selection.isCollapsed && el.contains(selection.anchorNode) && el.contains(selection.focusNode)) {
    return selection.getRangeAt(0);
  }
  const [target] = event.getTargetRanges();
  if (target) {
    const range = document.createRange();
    range.setStart(target.startContainer, target.startOffset);
    range.setEnd(target.endContainer, target.endOffset);
    return range;
  }
  return selection && selection.rangeCount ? selection.getRangeAt(0) : null;
}

// Deletes the text in `range` and puts `text` where it started, in the same
// text node when it can be; chips stay.
function replaceKeepingChips(range: Range, text: string): void {
  const container = range.startContainer;
  const offset = range.startOffset;
  for (const node of textNodes()) {
    if (!range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    if (to > from) node.deleteData(from, to - from);
  }
  let node: Text;
  let at: number;
  if (isText(container)) {
    node = container;
    at = Math.min(offset, node.data.length);
  } else {
    // The range started between nodes: use the text node beside the point.
    const next = container.childNodes[offset] ?? null;
    const previous = container.childNodes[offset - 1] ?? null;
    // (After a guard at the start of the next node, before one at the end of the previous.)
    if (isText(next)) [node, at] = [next, domOffset(next, 0, "start")];
    else if (isText(previous)) [node, at] = [previous, domOffset(previous, previous.data.replace(GUARDS, "").length, "end")];
    else {
      node = document.createTextNode("");
      container.insertBefore(node, next);
      at = 0;
    }
  }
  if (text) node.insertData(at, text);
  window.getSelection()!.collapse(node, Math.min(at + text.length, node.data.length));
}

function onBeforeInput(event: InputEvent): void {
  const type = event.inputType;
  if (type === "insertParagraph" || type === "insertLineBreak") return event.preventDefault();
  if (type === "historyUndo" || type === "historyRedo") {
    event.preventDefault();
    return type === "historyUndo" ? undo() : redo();
  }
  // An IME (Japanese input) composes where the caret is and cannot be
  // cancelled: onCompositionStart has made room for it.
  if (event.isComposing || type === "insertCompositionText") return;
  if (!(type.startsWith("delete") || type.startsWith("insert"))) return;
  const range = targetRange(event);
  if (!range) return;
  // A chip in the way, or nothing but a guard to delete (the caret is at a
  // chip): the chip stays. Anything else is the browser's, guards and all.
  const touchesChip = chips().some((chip) => range.intersectsNode(chip));
  const onlyGuard = !range.collapsed && range.toString().replace(GUARDS, "") === "" && type.startsWith("delete");
  if (!touchesChip && !onlyGuard) return;
  event.preventDefault();
  const text = type.startsWith("insert") ? (event.data ?? event.dataTransfer?.getData("text/plain") ?? "").replace(/\s+/g, " ") : "";
  if (text || touchesChip) replaceKeepingChips(range, text);
  flash();
  changed();
}

// A composition that starts over a selection with a chip in it would replace
// the chip: delete the selected text first, here, and compose at a caret.
function onCompositionStart(): void {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !root.value!.contains(range.commonAncestorContainer)) return;
  if (!chips().some((chip) => range.intersectsNode(chip))) return;
  replaceKeepingChips(range, "");
  flash();
  changed();
}

// The words in a range, without the chips' labels or the guards (what a person
// means by copying a sentence with a link in it).
function wordsIn(range: Range): string {
  let out = "";
  for (const node of textNodes()) {
    if (!range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    out += node.data.slice(from, to);
  }
  return out.replace(GUARDS, "");
}

function onCopy(event: ClipboardEvent, cut = false): void {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed || !root.value!.contains(selection.anchorNode)) return;
  const range = selection.getRangeAt(0);
  event.preventDefault();
  event.clipboardData?.setData("text/plain", wordsIn(range));
  if (!cut) return;
  if (chips().some((chip) => range.intersectsNode(chip))) flash();
  replaceKeepingChips(range, "");
  changed();
}

function onPaste(event: ClipboardEvent): void {
  event.preventDefault();
  const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\s+/g, " ");
  if (!text) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  replaceKeepingChips(selection.getRangeAt(0), text);
  changed();
}

function onKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === "Enter" && !mod) event.preventDefault();
  if (mod && !event.altKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    return event.shiftKey ? redo() : undo();
  }
  if (mod && !event.altKey && event.key.toLowerCase() === "y") {
    event.preventDefault();
    return redo();
  }
  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && active) {
    event.preventDefault();
    moveChip(active, event.key === "ArrowRight" ? 1 : -1);
  }
}

// ---- undo ------------------------------------------------------------------

function restore(value: string): void {
  last = value;
  build(value);
  caretToEnd();
  emit("update:modelValue", value);
}

function undo(): void {
  if (past.length < 2) return;
  future.push(past.pop()!);
  restore(past[past.length - 1]);
}

function redo(): void {
  const value = future.pop();
  if (value === undefined) return;
  past.push(value);
  restore(value);
}

// ---- moving chips -----------------------------------------------------------

// Puts the text box as it was if a move left a tag closed before it was opened,
// or two overlapping: the lint compares tags as a list, and would let it through.
// `index` is the chip's place among the chips before it moved.
function keepNested(before: Part[], index: number): boolean {
  if (!wellNested(before) || wellNested(readParts())) return true;
  build(serialize(before));
  active = chips()[index] ?? null;
  active?.classList.add("chip-active");
  flash();
  return false;
}

// One character (or one other chip) along.
function moveChip(chip: HTMLElement, direction: 1 | -1): void {
  const neighbour = direction === 1 ? chip.nextSibling : chip.previousSibling;
  if (!neighbour) return;
  const before = readParts();
  const index = chips().indexOf(chip);
  const parent = chip.parentNode!;
  if (isText(neighbour)) {
    const real = neighbour.data.replace(GUARDS, "");
    if (real.length === 0) {
      // A guard, or nothing: step over it to what is beyond.
      const beyond = direction === 1 ? neighbour.nextSibling : neighbour.previousSibling;
      if (!beyond) return;
      parent.insertBefore(chip, direction === 1 ? beyond.nextSibling : beyond);
    } else if (direction === 1) {
      parent.insertBefore(chip, neighbour.splitText(domOffset(neighbour, 1, "end")));
    } else {
      parent.insertBefore(chip, neighbour.splitText(domOffset(neighbour, real.length - 1, "end")));
    }
  } else if (direction === 1) {
    parent.insertBefore(chip, neighbour.nextSibling);
  } else {
    parent.insertBefore(chip, neighbour);
  }
  settle();
  if (keepNested(before, index)) changed();
}

// After chips move: text nodes joined, empty ones gone, the guards back (and
// one where two guards have met).
function settle(): void {
  root.value!.normalize();
  for (const node of textNodes()) node.data = node.data.replace(/\u200b{2,}/g, GUARD);
  repair();
}

// The place in the text nearest a point: a position before or after a
// character, on the line the point is on. Worked out from where the characters
// are drawn, not from the browser's caret-from-point, which in the middle of a
// drag answers with a position between the text box's children.
function dropPosition(x: number, y: number): [Text, number] | null {
  let best: { node: Text; offset: number; cost: number } | null = null;
  const probe = document.createRange();
  for (const node of textNodes()) {
    for (let i = 0; i < node.data.length; i++) {
      if (node.data[i] === GUARD) continue;
      probe.setStart(node, i);
      probe.setEnd(node, i + 1);
      const rect = probe.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const line = Math.abs(y - (rect.top + rect.bottom) / 2);
      for (const [offset, edge] of [[i, rect.left], [i + 1, rect.right]] as const) {
        // The right line first, then the nearest edge along it.
        const cost = line * 1000 + Math.abs(x - edge);
        if (!best || cost < best.cost) best = { node, offset, cost };
      }
    }
  }
  return best && [best.node, best.offset];
}

function onDragStart(event: DragEvent): void {
  const chip = (event.target as HTMLElement).closest?.(".chip") as HTMLElement | null;
  if (!chip) return;
  dragged = chip;
  event.dataTransfer!.effectAllowed = "move";
  event.dataTransfer!.setData("text/plain", chip.textContent ?? "");
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = dragged ? "move" : "none";
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  const chip = dragged;
  dragged = null;
  if (!chip) return;
  const place = dropPosition(event.clientX, event.clientY);
  if (!place) return;
  const before = readParts();
  const index = chips().indexOf(chip);
  const range = document.createRange();
  range.setStart(...place);
  range.collapse(true);
  range.insertNode(chip);
  settle();
  if (keepNested(before, index)) changed();
}

function onClick(event: MouseEvent): void {
  const chip = (event.target as HTMLElement).closest?.(".chip") as HTMLElement | null;
  active?.classList.remove("chip-active");
  active = chip;
  chip?.classList.add("chip-active");
}

// ---- the parent changing the text -----------------------------------------

watch(() => props.modelValue, (value) => {
  if (value === last) return;
  last = value;
  past.push(value);
  future = [];
  build(value);
});

onMounted(async () => {
  build(props.modelValue);
  await nextTick();
  applyPreselect();
});

defineExpose({ focus, selectAll });
</script>

<template>
  <div
    ref="root"
    class="chip-editor"
    :class="{ nudge }"
    contenteditable="true"
    role="textbox"
    aria-multiline="false"
    :aria-label="label"
    spellcheck="true"
    @input="changed"
    @beforeinput="onBeforeInput"
    @compositionstart="onCompositionStart"
    @paste="onPaste"
    @copy="onCopy($event)"
    @cut="onCopy($event, true)"
    @keydown="onKeydown"
    @click="onClick"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @drop="onDrop"
    @dragend="dragged = null"
  ></div>
</template>
