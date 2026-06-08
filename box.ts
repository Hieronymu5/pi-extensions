import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("box", {
    description: "Display an 80x80 box",
    handler: async (_args, ctx) => {
      // Build an 80x80 right triangle
      const lines: string[] = [];

      for (let i = 1; i <= 80; i++) {
        if (i === 1) {
          lines.push("█".repeat(80));
          continue;
        }

        if (i === 80) {
          lines.push("█".repeat(80));
          continue;
        }

        lines.push("█" + " ".repeat(78) + "█");
      }

      // Display as a widget above the editor
      ctx.ui.setWidget("box-triangle", lines);
      ctx.ui.notify("Box displayed!", "info");
    },
  });
}
