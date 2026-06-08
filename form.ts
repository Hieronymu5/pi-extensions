/**
 * This extension displays a form with two yes/no questions.
 * Use `/form` to trigger it.
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
  Input,
  SelectList,
  SelectItem,
  Text,
  Key,
  matchesKey,
  type Theme,
} from "@earendil-works/pi-tui";

interface FormParams {
  question1: string;
  question2: string;
}

interface FormResult {
  name: string;
  answer1: boolean;
  answer2: boolean;
}

class FormComponent extends Container implements Focusable {
  private inputName: Input;
  private selectList1: SelectList;
  private selectList2: SelectList;
  private onDoneCallback: (result: FormResult) => void;
  private question1: string;
  private question2: string;
  private theme: Theme;

  private _focused = false;
  private activeField = 1; // 1 = name, 2 = question1, 3 = question2

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (this.activeField === 1) {
      this.inputName.focused = value;
      this.selectList1.focused = false;
      this.selectList2.focused = false;
    } else if (this.activeField === 2) {
      this.inputName.focused = false;
      this.selectList1.focused = value;
      this.selectList2.focused = false;
    } else {
      this.inputName.focused = false;
      this.selectList1.focused = false;
      this.selectList2.focused = value;
    }
  }

  constructor(
    theme: Theme,
    question1: string,
    question2: string,
    onDone: (result: FormResult) => void,
  ) {
    super();
    this.theme = theme;
    this.question1 = question1;
    this.question2 = question2;
    this.onDoneCallback = onDone;

    const options: SelectItem[] = [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];

    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    this.addChild(new Text(theme.fg("accent", theme.bold("Form"))));
    this.addChild(new Text(""));

    // Name input
    this.addChild(new Text(theme.fg("text", "Name:")));
    this.inputName = new Input();
    this.addChild(this.inputName);
    this.addChild(new Text(""));

    // Question 1
    this.addChild(new Text(theme.fg("text", "1. " + question1)));
    this.selectList1 = new SelectList(options, options.length, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    this.selectList1.onSelect = (item) => {
      this.selectList1.value = item.value;
    };
    this.selectList1.onCancel = () => {
      // Move to next field on cancel (Enter with no selection)
    };
    this.addChild(this.selectList1);
    this.addChild(new Text(""));

    // Question 2
    this.addChild(new Text(theme.fg("text", "2. " + question2)));
    this.selectList2 = new SelectList(options, options.length, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    this.selectList2.onSelect = (item) => {
      this.selectList2.value = item.value;
    };
    this.selectList2.onCancel = () => {
      // Move to next field on cancel (Enter with no selection)
    };
    this.addChild(this.selectList2);
    this.addChild(new Text(""));

    this.addChild(
      new Text(
        theme.fg(
          "dim",
          "↑↓ select • Tab switch fields • Enter submit • Esc cancel • type for name",
        ),
      ),
    );
    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    // Set initial focus
    this.inputName.focused = true;
    this.selectList1.focused = false;
    this.selectList2.focused = false;
  }

  handleInput(keyData: string): void {
    // Handle Tab to switch between fields
    if (matchesKey(keyData, Key.tab) || matchesKey(keyData, Key.right)) {
      if (this.activeField === 1) {
        this.activeField = 2;
        this.inputName.focused = false;
        this.selectList1.focused = this._focused;
        this.selectList2.focused = false;
        this.inputName.invalidate();
        this.selectList1.invalidate();
        this.selectList2.invalidate();
      } else if (this.activeField === 2) {
        this.activeField = 3;
        this.inputName.focused = false;
        this.selectList1.focused = false;
        this.selectList2.focused = this._focused;
        this.inputName.invalidate();
        this.selectList1.invalidate();
        this.selectList2.invalidate();
      } else {
        this.activeField = 1;
        this.inputName.focused = this._focused;
        this.selectList1.focused = false;
        this.selectList2.focused = false;
        this.inputName.invalidate();
        this.selectList1.invalidate();
        this.selectList2.invalidate();
      }
      this.invalidate();
      return;
    }

    // Handle Shift+Tab to go backwards
    if (matchesKey(keyData, Key.shift("tab")) || matchesKey(keyData, Key.left)) {
      if (this.activeField === 1) {
        this.activeField = 3;
        this.inputName.focused = false;
        this.selectList1.focused = false;
        this.selectList2.focused = this._focused;
        this.inputName.invalidate();
        this.selectList1.invalidate();
        this.selectList2.invalidate();
      } else if (this.activeField === 2) {
        this.activeField = 1;
        this.inputName.focused = this._focused;
        this.selectList1.focused = false;
        this.selectList2.focused = false;
        this.inputName.invalidate();
        this.selectList1.invalidate();
        this.selectList2.invalidate();
      } else {
        this.activeField = 2;
        this.inputName.focused = false;
        this.selectList1.focused = this._focused;
        this.selectList2.focused = false;
        this.inputName.invalidate();
        this.selectList1.invalidate();
        this.selectList2.invalidate();
      }
      this.invalidate();
      return;
    }

    // Handle Escape to cancel
    if (matchesKey(keyData, Key.escape)) {
      this.onDoneCallback({ name: "", answer1: false, answer2: false });
      return;
    }

    // Handle Enter to submit
    if (matchesKey(keyData, Key.enter)) {
      const name = this.inputName.value || "";
      const answer1 = this.selectList1.value === "yes";
      const answer2 = this.selectList2.value === "yes";
      this.onDoneCallback({ name, answer1, answer2 });
      return;
    }

    // Pass input to active field
    if (this.activeField === 1) {
      this.inputName.handleInput(keyData);
    } else if (this.activeField === 2) {
      this.selectList1.handleInput(keyData);
    } else {
      this.selectList2.handleInput(keyData);
    }
  }

  override invalidate(): void {
    super.invalidate();
  }
}

export default function formExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "form",
    label: "Form",
    description:
      "Display a form with two yes/no questions and wait for user response. " +
      "Returns the answers to both questions.",

    parameters: Type.Object({
      question1: Type.String({
        description: "The first yes/no question to ask the user",
      }),
      question2: Type.String({
        description: "The second yes/no question to ask the user",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const question1 = params.question1;
      const question2 = params.question2;

      if (!ctx.hasUI) {
        return {
          content: [
            { type: "text", text: "Error: No UI available to display form" },
          ],
          details: { error: "No UI available", question1, question2 },
        };
      }

      const result = await ctx.ui.custom<FormResult>(
        (tui, theme, _keybindings, done) => {
          let form: FormComponent | null = null;

          const rootComponent = {
            get focused() {
              return form?.focused ?? false;
            },
            set focused(value: boolean) {
              if (form) {
                form.focused = value;
              }
            },
            render(width: number) {
              return form ? form.render(width) : [];
            },
            invalidate() {
              form?.invalidate();
            },
            handleInput(data: string) {
              form?.handleInput?.(data);
            },
          };

          form = new FormComponent(
            theme,
            question1,
            question2,
            (result: FormResult) => {
              done(result);
            },
          );

          return rootComponent;
        },
        {
          overlay: true,
          overlayOptions: { width: "60%", maxHeight: "60%", anchor: "center" },
        },
      );

      // result could be undefined if the user closed the dialog without responding
      const name = result?.name ?? "";
      const answer1 = result?.answer1 ?? false;
      const answer2 = result?.answer2 ?? false;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ name, answer1, answer2 }),
          },
        ],
        details: { question1, question2, name, answer1, answer2 },
      };
    },

    renderCall(args, theme) {
      const question1 =
        typeof args.question1 === "string" ? args.question1 : "";
      const question2 =
        typeof args.question2 === "string" ? args.question2 : "";
      const text =
        theme.fg("toolTitle", theme.bold("form ")) +
        theme.fg("dim", `"${question1}", "${question2}"`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      if (result.isError) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      const details = result.details as
        | { question1: string; question2: string; name: string; answer1: boolean; answer2: boolean }
        | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      const { question1, question2, name, answer1, answer2 } = details;
      const answer1Text = answer1
        ? theme.fg("success", "Yes")
        : theme.fg("warning", "No");
      const answer2Text = answer2
        ? theme.fg("success", "Yes")
        : theme.fg("warning", "No");

      if (!expanded) {
        const line = `${name ? name + ": " : ""}${question1} ${answer1Text}, ${question2} ${answer2Text}`;
        return new Text(line, 0, 0);
      }

      // Expanded view
      const lines = [
        name ? `${theme.fg("accent", "Name:")} ${name}` : "",
        name ? "" : "",
        theme.fg("accent", "Question 1:"),
        "  " + question1 + " " + answer1Text,
        "",
        theme.fg("accent", "Question 2:"),
        "  " + question2 + " " + answer2Text,
      ];
      return new Text(lines.join("\n"), 0, 0);
    },
  });

  pi.registerCommand("form", {
    description: "Display a form with two yes/no questions",
    handler: async (args, ctx) => {
      // Parse args - expect two questions separated by delimiter or use defaults
      let question1 = "";
      let question2 = "";

      // Default form questions if none provided
      if (!args || args.trim() === "") {
        question1 = "Do you agree?";
        question2 = "Are you sure?";
      } else {
        // Try to parse as "question1 | question2" or just use args as question1
        const parts = args.split("|").map((s: string) => s.trim());
        question1 = parts[0] || "Do you agree?";
        question2 = parts[1] || "Are you sure?";
      }

      if (!ctx.hasUI) {
        console.log("Error: No UI available for form");
        return;
      }

      const result = await ctx.ui.custom<FormResult>(
        (tui, theme, keybindings, done) => {
          let form: FormComponent | null = null;

          let wrapperFocused = false;

          const rootComponent = {
            get focused() {
              return wrapperFocused;
            },
            set focused(value: boolean) {
              wrapperFocused = value;
              if (form) {
                form.focused = value;
              }
            },
            render(width: number) {
              return form ? form.render(width) : [];
            },
            invalidate() {
              form?.invalidate();
            },
            handleInput(data: string) {
              form?.handleInput?.(data);
            },
          };

          form = new FormComponent(
            theme,
            question1,
            question2,
            (result: FormResult) => {
              const name = result.name || "(no name)";
              const a1 = result.answer1 ? "Yes" : "No";
              const a2 = result.answer2 ? "Yes" : "No";
              console.log(`${name}: ${question1}: ${a1}, ${question2}: ${a2}`);
              done(result);
            },
          );

          return rootComponent;
        },
        {
          overlay: true,
          overlayOptions: { width: "60%", maxHeight: "60%", anchor: "center" },
        },
      );

      const name = result?.name || "(no name)";
      const a1 = result?.answer1 ? "Yes" : "No";
      const a2 = result?.answer2 ? "Yes" : "No";
      ctx.ui.notify(
        `${name}: ${question1}: ${a1}, ${question2}: ${a2}`,
        result ? "success" : "warning",
      );
    },
  });
}
