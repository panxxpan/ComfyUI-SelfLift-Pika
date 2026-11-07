// Adaptive high-res LoRA slots for "SelfLift Pika Upscale Refine".
// Picking a LoRA in the last slot adds an empty slot below; clearing trailing
// slots back to "None" removes the extras, always keeping one empty slot.
import { app } from "../../scripts/app.js";

const NODE_NAME = "SelfLiftPikaUpscaleRefine";
const NONE = "None";
const NAME_RE = /^hires_lora_(\d+)$/;

const findWidget = (node, name) => node.widgets?.find((w) => w.name === name);

function slotIndices(node) {
  return (node.widgets || [])
    .map((w) => NAME_RE.exec(w.name))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

function resize(node) {
  const size = node.computeSize();
  node.setSize([Math.max(node.size[0], size[0]), size[1]]);
  node.setDirtyCanvas(true, true);
}

function watch(node, widget) {
  if (widget.__selfliftWatched) return;
  widget.__selfliftWatched = true;
  const original = widget.callback;
  widget.callback = function (...args) {
    const result = original?.apply(this, args);
    sync(node);
    return result;
  };
}

function addSlot(node, index, name = NONE, strength) {
  const baseName = findWidget(node, "hires_lora_1");
  const baseStrength = findWidget(node, "hires_lora_1_strength");
  if (!baseName || !baseStrength) return;
  const nameWidget = node.addWidget("combo", `hires_lora_${index}`, name, () => {}, {
    values: baseName.options.values,
  });
  node.addWidget("number", `hires_lora_${index}_strength`,
    strength ?? baseStrength.options?.default ?? 0.5, () => {}, { ...baseStrength.options });
  watch(node, nameWidget);
}

function removeSlot(node, index) {
  for (const name of [`hires_lora_${index}`, `hires_lora_${index}_strength`]) {
    const i = node.widgets.findIndex((w) => w.name === name);
    if (i >= 0) {
      node.widgets[i].onRemove?.();
      node.widgets.splice(i, 1);
    }
  }
}

function sync(node) {
  let slots = slotIndices(node);
  if (!slots.length) return;
  const isEmpty = (i) => (findWidget(node, `hires_lora_${i}`)?.value ?? NONE) === NONE;
  // drop trailing empty slots beyond the first, keep exactly one empty slot at the end
  while (slots.length > 1 && isEmpty(slots[slots.length - 1]) && isEmpty(slots[slots.length - 2])) {
    removeSlot(node, slots.pop());
  }
  const last = slots[slots.length - 1];
  if (!isEmpty(last)) addSlot(node, last + 1);
  resize(node);
}

app.registerExtension({
  name: "selflift.PikaUpscaleRefine.hiresLoras",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = onNodeCreated?.apply(this, args);
      const first = findWidget(this, "hires_lora_1");
      if (first) watch(this, first);
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = onConfigure?.apply(this, arguments);
      const values = Array.isArray(info?.widgets_values) ? info.widgets_values : [];
      // Saved workflows hold extra (name, strength) pairs after the declared widgets.
      const base = this.widgets?.length ?? 0;
      let index = Math.max(1, ...slotIndices(this)) + 1;
      for (let i = base; i + 1 < values.length; i += 2, index += 1) {
        addSlot(this, index, values[i], values[i + 1]);
      }
      const first = findWidget(this, "hires_lora_1");
      if (first) watch(this, first);
      sync(this);
      return result;
    };
  },
});
