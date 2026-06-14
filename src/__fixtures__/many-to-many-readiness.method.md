---
id: many-to-many-readiness
title: Many-to-Many Collaboration Readiness
version: 0.1.0
status: draft
summary: A staged sensemaking process that walks a multi-actor collaboration to the point where it can make governance and contracting choices.
source_method: Many-to-Many System (Dark Matter Labs, Beyond the Rules Lab)
license: CC-BY-NC-4.0
attribution: "Adapted from the Many-to-Many System by Dark Matter Labs, CC BY-NC 4.0 — https://manytomany.systems"
runtime:
  reference: harmonica
  artifact: chain
lenses: [value, power, risk, ownership]
roles:
  - { slug: convenor, label: Convenor / steward }
  - { slug: partner, label: Collaboration partner }
  - { slug: funder, label: Funder (optional) }
stages:
  - { id: context-diagnostic, title: Context & readiness diagnostic, roles: [convenor, partner], assignment_strategy: all_participants, context_mode: none, completion: all_submitted, output: readiness-picture }
  - { id: asset-mapping, title: Multi-value asset mapping, roles: [partner], assignment_strategy: all_participants, context_mode: previous_summary, completion: all_submitted, output: asset-map }
  - { id: role-mapping, title: Role & responsibility mapping, roles: [partner, convenor], assignment_strategy: all_participants, context_mode: previous_summary, completion: all_submitted, output: role-map }
  - { id: risk-mapping, title: Risk-flow mapping, roles: [partner, convenor, funder], assignment_strategy: all_participants, context_mode: previous_summary, completion: all_submitted, output: risk-framework }
  - { id: readiness-synthesis, title: Readiness synthesis, roles: [convenor], assignment_strategy: all_participants, context_mode: all_summaries, completion: all_submitted, output: readiness-synthesis }
evals: ./evals
---

# Many-to-Many Collaboration Readiness

A staged sensemaking process that walks a multi-actor collaboration to the point where it can make governance and contracting choices. Adapted from the **Many-to-Many System** by Dark Matter Labs (Beyond the Rules Lab).

**Who it's for:** governance practitioners, funders, and legal/financial professionals in complex, cross-sector collaborations who want governance and organising structures that fit their work rather than inheriting misaligned defaults.

**The lens:** every stage reads through the Many-to-Many "deep codes" (value, power, risk, ownership), asking which assumptions are embedded in the group's structures and which could be reimagined.

**The arc:** sense, then align, then govern. Each stage's synthesis carries into the next, so the group builds a shared picture before it makes structural commitments. Governance follows readiness, not the other way round.

> **Provenance + status.** Stages are drafted from public Many-to-Many material (the launch webinar, the Field Guide, and the published tools); see [`SOURCES.md`](./SOURCES.md). This is a `draft`: faithful prompt wording, and any use beyond an internal draft, need Dark Matter Labs' input (CC BY-NC).

## Stage: context-diagnostic
**Goal:** assess whether this is the kind of collaboration Many-to-Many is for, and where there is an opening to reshape governance.

Help the group locate itself. Is this a complex, multi-actor collaboration crossing sectors, disciplines, or jurisdictions, working on an entangled challenge where the usual norms around value, ownership, and power get in the way? Invite each participant to describe their collaboration in those terms and to name where current structures feel restrictive rather than enabling. If it helps, start from a felt problem (energy fading before a plan forms, getting stuck on what to prioritise, fragmentation when money enters, slipping back into old habits, conditions not yet ripe) and surface which deep code that problem touches. Don't prescribe a fix; establish whether the conditions and the appetite to reshape governance are present.

**Output:** a shared readiness picture: whether this is the right kind of collaboration, where the openings are, and what each participant has the appetite to change.

## Stage: asset-mapping
**Goal:** surface the many forms of value each partner brings, especially the non-financial.

Ask each participant what they bring beyond money: relationships and networks, knowledge and lived experience, time and care, reputation and convening power, material and infrastructural assets. Press gently past the obvious: what is the value that usually goes unwitnessed? Then ask how the group wants to witness and acknowledge these contributions, so value isn't flattened to whatever is easiest to count. Honour every form of capital named.

**Output:** a shared multi-capital asset map and a sense of how contributions will be acknowledged.

## Stage: role-mapping
**Goal:** make roles, responsibilities, and risk-holding explicit, and adaptable.

With the assets in view, turn to who holds what. Ask what capabilities and postures the collaboration's stewardship actually needs, then have participants name the roles they want to hold and the responsibilities (and risks) that come with each. Treat roles as cards that can evolve, not fixed posts: ask how a role should adapt as the context changes and how someone hands it on. Make the often-invisible labour visible, so it can be shared rather than silently carried.

**Output:** a set of flexible role definitions with responsibilities and risk-holding made explicit.

## Stage: risk-mapping
**Goal:** surface risk in all its forms and locate decision rights proportionate to who holds it.

Ask the group to name the risks the collaboration carries: not only financial and legal, but risk to relationships, to reputation, to trust, and the risk of inaction. For each, ask who actually holds it. Then connect risk to power: where should a decision sit, given who bears its consequences? The aim is to locate agency proportionate to the risk held, rather than defaulting to hierarchy or to an off-the-shelf legal form that imposes misaligned assumptions.

**Output:** a documented risk picture with proposed, proportionate decision rights.

## Stage: readiness-synthesis
**Goal:** pull the sensing into alignment and name what the group is now ready to decide.

Draw the prior stages together: the assets the group holds, the roles it has named, the risks it carries, and where decisions should sit. Reflect back where there is alignment and where tension remains. Then name what the collaboration is now *ready* to choose: which governance and contracting questions are open, and which can wait. Do not draft the agreement here; hand off a clear readiness picture so the group can take the structural and legal decisions on a shared foundation.

**Output:** a readiness synthesis: what is aligned, what is unresolved, and which governance/contracting choices are now open.
