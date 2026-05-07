# PDD Canvas Review Checklist

Use this checklist to validate that a PDD Canvas is ready for AI implementation.

## Agent-Readiness (Critical)

- [ ] Could an agent implement this from the canvas alone?
- [ ] Are there no ambiguous instructions that require human interpretation?
- [ ] Are all file paths specific and verifiable?

## Spike Findings

- [ ] Is there evidence of research (not just assumptions)?
- [ ] Are there PoC results that validate the approach?
- [ ] Are rejected alternatives documented with reasons?

## Approach

- [ ] Is the chosen approach clearly justified?
- [ ] Are trade-offs explicitly stated?
- [ ] Are alternatives documented?

## Requirements

- [ ] Are functional requirements testable?
- [ ] Are non-functional requirements measurable?
- [ ] Is "done" clearly defined?

## Tasks

- [ ] Are tasks ordered with dependencies?
- [ ] Are tasks specific (not "implement X service")?
- [ ] Are T-shirt sizes realistic?
- [ ] Are affected files listed for each task?

## Entities

- [ ] Are method signatures included?
- [ ] Are relationships documented?
- [ ] Is the domain model complete?

## Design

- [ ] Are specific files/patterns referenced?
- [ ] Are configuration options documented?
- [ ] Are data flows visualized?

## Risks

- [ ] Are risks identified with likelihood and impact?
- [ ] Are mitigations specific (not "monitor closely")?
- [ ] Are fallback plans documented?

## Safeguards

- [ ] Are "DO NOT" rules specific and enforceable?
- [ ] Are error handling constraints defined?
- [ ] Are testing constraints specified?
- [ ] Are verification criteria testable?

## Overall Quality

- [ ] Is the canvas free of placeholder text?
- [ ] Are all sections filled out completely?
- [ ] Would a developer joining tomorrow understand this?
