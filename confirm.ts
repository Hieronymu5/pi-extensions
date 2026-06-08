/**
 * This extension provides a confirm dialog that asks the user a yes/no question.
 * Use `/confirm` to trigger it or use the confirm tool from the LLM.
 */
import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  Container,
  type Focusable,
  SelectList,
  SelectItem,
  Text,
  TUI,
  type Theme,
} from "@earendil-works/pi-tui";

interface ConfirmParams {
  question: string;
}

type KeybindingMatcher = {
  matches: (keyData: string, keybindingId: string) => boolean;
};

class ConfirmDialogComponent extends Container implements Focusable {
  private selectList: SelectList;

  private onConfirmCallback: (confirmed: boolean) => void;
  private question: string;
  private theme: Theme;

  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.selectList.focused = value;
  }

  constructor(
    theme: Theme,
    question: string,
    onConfirm: (confirmed: boolean) => void,
  ) {
    super();
    this.theme = theme;
    this.question = question;
    this.onConfirmCallback = onConfirm;

    const options: SelectItem[] = [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];

    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    this.addChild(new Text(theme.fg("accent", theme.bold("Confirm"))));
    this.addChild(new Text(""));
    this.addChild(new Text(theme.fg("text", question)));
    this.addChild(new Text(""));

    this.selectList = new SelectList(options, options.length, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    this.selectList.onSelect = (item) =>
      this.onConfirmCallback(item.value === "yes");
    this.selectList.onCancel = () => this.onConfirmCallback(false);

    this.addChild(this.selectList);
    this.addChild(new Text(""));
    this.addChild(
      new Text(theme.fg("dim", "↑↓ select • Enter to confirm • Esc for No")),
    );
    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  }

  handleInput(keyData: string): void {
    this.selectList.handleInput(keyData);
  }

  override invalidate(): void {
    super.invalidate();
  }
}

export default function confirmExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "confirm",
    label: "Confirm",
    description:
      "Ask the user a yes/no question and wait for their response. " +
      "Returns true if the user confirms (Yes), false if they decline (No). " +
      "Only use this when you genuinely need user confirmation for an action.",
    parameters: Type.Object({
      question: Type.String({
        description: "The question to ask the user (yes or no question)",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const question = params.question;

      // If no UI is available, we can't ask for confirmation
      // This shouldn't normally happen since we require user interaction
      if (!ctx.hasUI) {
        return {
          content: [
            { type: "text", text: "Error: No UI available to confirm" },
          ],
          details: { error: "No UI available", question },
        };
      }

      const result = await ctx.ui.custom<boolean>(
        (tui, theme, _keybindings, done) => {
          let dialog: ConfirmDialogComponent | null = null;

          const rootComponent = {
            get focused() {
              return dialog?.focused ?? false;
            },
            set focused(value: boolean) {
              if (dialog) {
                dialog.focused = value;
              }
            },
            render(width: number) {
              return dialog ? dialog.render(width) : [];
            },
            invalidate() {
              dialog?.invalidate();
            },
            handleInput(data: string) {
              dialog?.handleInput?.(data);
            },
          };

          dialog = new ConfirmDialogComponent(theme, question, (confirmed) => {
            done(confirmed);
          });

          return rootComponent;
        },
        {
          overlay: true,
          overlayOptions: { width: "60%", maxHeight: "60%", anchor: "center" },
        },
      );

      // result could be undefined if the user closed the dialog without responding
      const confirmed = result ?? false;
      const answer = confirmed ? "Yes" : "No";

      return {
        content: [{ type: "text", text: JSON.stringify(confirmed) }],
        details: { question, answer: confirmed },
      };
    },

    renderCall(args, theme) {
      const question = typeof args.question === "string" ? args.question : "";
      const text =
        theme.fg("toolTitle", theme.bold("confirm ")) +
        theme.fg("dim", `"${question}"`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      if (result.isError) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      const details = result.details as
        | { question: string; answer: boolean }
        | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      const { question, answer } = details;
      const answerText = answer
        ? theme.fg("success", "Yes")
        : theme.fg("warning", "No");
      const line = question + " " + answerText;

      if (!expanded) {
        return new Text(line, 0, 0);
      }

      // Expanded view
      const lines = [
        theme.fg("accent", "Question:"),
        "  " + question,
        "",
        theme.fg("accent", "Answer:"),
        "  " + answerText,
      ];
      return new Text(lines.join("\n"), 0, 0);
    },
  });

  pi.registerCommand("confirm", {
    description: "Ask a yes/no confirmation question",
    handler: async (args, ctx) => {
      const question = (args ?? "").trim();

      if (!question) {
        console.log("Usage: /confirm <question>");
        return;
      }

      if (!ctx.hasUI) {
        console.log("Error: No UI available for confirmation");
        return;
      }

      const result = await ctx.ui.custom<boolean>(
        (tui, theme, keybindings, done) => {
          let dialog: ConfirmDialogComponent | null = null;

          let wrapperFocused = false;

          const rootComponent = {
            get focused() {
              return wrapperFocused;
            },
            set focused(value: boolean) {
              wrapperFocused = value;
              if (dialog) {
                dialog.focused = value;
              }
            },
            render(width: number) {
              return dialog ? dialog.render(width) : [];
            },
            invalidate() {
              dialog?.invalidate();
            },
            handleInput(data: string) {
              dialog?.handleInput?.(data);
            },
          };

          dialog = new ConfirmDialogComponent(theme, question, (confirmed) => {
            const answer = confirmed ? "Yes" : "No";
            console.log(`${question} ${answer}`);
            done(confirmed);
          });

          return rootComponent;
        },
        {
          overlay: true,
          overlayOptions: { width: "60%", maxHeight: "60%", anchor: "center" },
        },
      );

      const answer = result ? "Yes" : "No";
      ctx.ui.notify(`${question}? ${answer}`, result ? "success" : "warning");
    },
  });
}
