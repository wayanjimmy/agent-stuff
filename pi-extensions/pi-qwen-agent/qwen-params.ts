import { Type } from "@sinclair/typebox";

export const QwenAgentParams = Type.Object({
  task: Type.String({
    description: "The task/prompt to send to the Qwen Code agent.",
  }),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the Qwen agent. Defaults to the current workspace.",
    }),
  ),
  approval_mode: Type.Optional(
    Type.Union(
      [
        Type.Literal("default"),
        Type.Literal("plan"),
        Type.Literal("auto-edit"),
        Type.Literal("yolo"),
      ],
      {
        description:
          'Approval mode: "default" (prompt for approval), "plan" (plan only), "auto-edit" (auto-approve edits), "yolo" (auto-approve everything).',
        default: "default",
      },
    ),
  ),
  model: Type.Optional(
    Type.String({
      description: "Specific model ID to use (e.g. qwen3-coder).",
    }),
  ),
  include_directories: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional directories to include in the workspace.",
    }),
  ),
  continue: Type.Optional(
    Type.Boolean({
      description: "Resume the most recent session for the current project.",
      default: false,
    }),
  ),
  resume: Type.Optional(
    Type.String({
      description: "Resume a specific session by its ID.",
    }),
  ),
});
