# Prompt Driven Development (PDD)

This directory is now a **stub**.

## Canonical Source of Truth

The live/global PDD skill is managed by **chezmoi** at:

- Source: `/home/jimbo/.local/share/chezmoi/dot_agents/skills/pdd`
- Destination: `~/.agents/skills/pdd`

## Management Workflow

Update the skill in chezmoi source, then apply:

```bash
chezmoi apply ~/.agents/skills/pdd
```

Validate anytime:

```bash
cd ~/.agents/skills/pdd
deno task check
```

## Notes

- `prompt-driven-dev/skills/pdd` has been intentionally removed from this repo.
- `prompt-driven-dev/docs` has been intentionally removed from this repo.
