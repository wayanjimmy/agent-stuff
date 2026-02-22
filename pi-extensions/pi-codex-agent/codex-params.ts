import { Type } from "@sinclair/typebox";

export const CodexAgentParams = Type.Object({
  task: Type.String({
    description: "The task/prompt to send to the Codex agent.",
  }),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the Codex subprocess (spawn cwd).",
    }),
  ),
  sandbox: Type.Optional(
    Type.Union(
      [
        Type.Literal("read-only"),
        Type.Literal("workspace-write"),
        Type.Literal("danger-full-access"),
      ],
      {
        description:
          'Sandbox mode: "read-only" (no writes), "workspace-write" (write within workspace), "danger-full-access" (unrestricted — use with caution).',
        default: "workspace-write",
      },
    ),
  ),
  model: Type.Optional(
    Type.String({
      description: "Specific model ID to use. Maps to -m.",
    }),
  ),
  profile: Type.Optional(
    Type.String({
      description: "Named profile to use. Maps to -p.",
    }),
  ),
  full_auto: Type.Optional(
    Type.Boolean({
      description: "Run in full-auto mode without approval prompts. Maps to --full-auto.",
      default: false,
    }),
  ),
  add_dir: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional directories to include. Each maps to --add-dir.",
    }),
  ),
});
