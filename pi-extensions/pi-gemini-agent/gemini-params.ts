import { Type } from "@sinclair/typebox";

export const GeminiAgentParams = Type.Object({
  task: Type.String({
    description: "The task/prompt to send to the Gemini agent.",
  }),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the Gemini agent. Defaults to the current workspace.",
    }),
  ),
  approvalMode: Type.Optional(
    Type.Union(
      [
        Type.Literal("default"),
        Type.Literal("plan"),
        Type.Literal("auto_edit"),
        Type.Literal("yolo"),
      ],
      {
        description:
          'Approval mode: "default" (prompt for approval), "plan" (plan only, read-only), "auto_edit" (auto-approve edit tools), "yolo" (auto-approve all tools).',
        default: "yolo",
      },
    ),
  ),
  model: Type.Optional(
    Type.String({
      description: "Specific model ID to use. Maps to -m.",
    }),
  ),
  includeDirectories: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional directories to include in the workspace. Each maps to --include-directories.",
    }),
  ),
  continueSession: Type.Optional(
    Type.Boolean({
      description: "Resume the most recent session for the current project. Maps to --continue.",
      default: false,
    }),
  ),
  resume: Type.Optional(
    Type.String({
      description: "Resume a specific session by its ID. Maps to --resume.",
    }),
  ),
});
