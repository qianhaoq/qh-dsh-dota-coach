# Reading design — 0.5.0

The review is a set of decisions to inspect, rather than a long article to read in order.

- [NN/g: Cards](https://www.nngroup.com/articles/cards-component/) describes a card as a short representation of one conceptual unit, linking to detail. Here the unit is one replay decision.
- [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports showing the important controls first and deferring less common detail. The default card shows one advice sentence; actions, outcomes, prerequisites, reasoning and replay are explicit views.
- [Dotabuff Plus / TrueSight](https://www.dotabuff.com/plus) offers timelines, combat logs and detailed breakdowns. These are useful evidence references; our design puts the player's decision before the complete data breakdown.

Default reading: three moment cards per detailed phase; one visible view per card; a single expanded detail region. Phase narratives and practice editing start collapsed. Chat starts with a brief conclusion and optional short steps; the full explanation remains available.

Existing reports are not regenerated for this change. Cached previews are complete, verbatim sentences. Negations, conditions and numeric precision are not silently clipped. Resource prerequisites remain visible as a dedicated control, and outcome windows crossing death/respawn keep an explicit warning.
