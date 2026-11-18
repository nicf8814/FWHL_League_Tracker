# FWHFFL 2026 — Draft Intelligence Features
## Detailed Coding Specification for Features 3, 6, and 7

### Scope

This document specifies three client-side features for the existing standalone FWHFFL 2026 auction tool:

1. Budget / Roster Calculator
2. Position Scarcity Meter
3. “What Should I Do?” Decision Engine

The implementation should remain fully local:

- No APIs
- No ESPN/Sleeper integration
- No Firebase
- No hosted database
- No server
- No external runtime dependency

The existing 2026 valuation model remains authoritative for player valuation. These features interpret those values in the context of the current draft state.

---

# 1. Architecture

Use a single shared draft-state object.

```text
RAW_PLAYERS
     |
     v
DraftState
     |
     +--------------------+
     |                    |
     v                    v
Budget Calculator    Position Scarcity
     |                    |
     +----------+---------+
                |
                v
        Decision Engine
                |
                v
          Draft UI
```

Do NOT have each feature independently calculate budget, roster needs, or remaining players.

The central state should be the source of truth.

---

# 2. Draft State

Add a global state object:

```javascript
const DraftState = {
  startingBudget: 200,
  budgetRemaining: 200,

  rosterMax: 13,

  roster: [],

  nominations: [],

  currentPlayerId: null,
  currentBid: 1,

  reservedMinimum: 0,
  discretionaryBudget: 200,

  positionNeeds: {},
  positionScarcity: {},

  settings: {
    minimumBid: 1,
    scarcityWeight: 0.35,
    needWeight: 0.35,
    valueWeight: 0.30
  }
};
```

A roster entry should look like:

```javascript
{
  playerId: "player_123",
  name: "Example Player",
  position: "WR",
  price: 34
}
```

The roster should contain both purchased players and their actual auction prices.

---

# 3. Single Source of Truth

Never manually update:

```javascript
budgetRemaining
```

in multiple places.

Instead, recalculate it from the starting budget and roster:

```javascript
function calculateBudgetRemaining() {
  const spent = DraftState.roster.reduce(
    (sum, player) => sum + Number(player.price || 0),
    0
  );

  DraftState.budgetRemaining =
    DraftState.startingBudget - spent;

  return DraftState.budgetRemaining;
}
```

Call this after every purchase.

---

# 4. Roster Slots

The existing 2026 tool uses:

```javascript
STARTER_SLOTS = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "FLEX",
  "LFLEX"
];

ROSTER_MAX = 13;
```

Preserve that structure.

The application should calculate:

```javascript
function getRosterSpotsRemaining() {
  return DraftState.rosterMax - DraftState.roster.length;
}
```

Do not hard-code the number 8 or 6 anywhere else.

---

# 5. Position Requirements

Calculate minimum required positions based on the actual roster.

For the current roster format:

```javascript
function calculatePositionNeeds() {
  const counts = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0
  };

  DraftState.roster.forEach(player => {
    if (counts[player.position] !== undefined) {
      counts[player.position]++;
    }
  });

  return {
    QB: Math.max(0, 1 - counts.QB),
    RB: Math.max(0, 2 - counts.RB),
    WR: Math.max(0, 2 - counts.WR),
    TE: 0
  };
}
```

However, because FLEX and LFLEX are flexible slots, do not treat this as the entire position requirement.

Also calculate a preferred need score:

```javascript
function calculatePositionNeedScore(position) {
  // Higher = more important to fill
}
```

A player should become more strategically important if:

- the position has a starter slot still open
- there are few quality players remaining
- the manager has not filled the position
- the budget permits the purchase

---

# 6. Minimum Spend

The most important budget calculation is:

> How much money must I reserve to fill every remaining roster slot at $1?

```javascript
function calculateMinimumReserve() {
  const spots = getRosterSpotsRemaining();

  return Math.max(
    0,
    spots * DraftState.settings.minimumBid
  );
}
```

For a $200 auction:

```text
$200 starting
$143 remaining
8 spots remaining

Minimum reserve = $8
Discretionary budget = $135
```

---

# 7. Discretionary Budget

```javascript
function calculateDiscretionaryBudget() {
  const remaining = calculateBudgetRemaining();
  const reserve = calculateMinimumReserve();

  DraftState.reservedMinimum = reserve;

  DraftState.discretionaryBudget =
    Math.max(0, remaining - reserve);

  return DraftState.discretionaryBudget;
}
```

Display:

```text
Remaining:       $143
Minimum reserve:   $8
Discretionary:   $135
Average available: $16.88
```

Average available:

```javascript
function calculateAverageAvailable() {
  const spots = getRosterSpotsRemaining();

  if (spots <= 0) return 0;

  return DraftState.discretionaryBudget / spots;
}
```

---

# 8. Recommended Spending Capacity

Absolute discretionary budget is not the same thing as what the manager should spend on one player.

Calculate:

```javascript
function calculateRecommendedMaxSpend(player) {
  const remainingBudget = calculateBudgetRemaining();
  const spotsRemaining = getRosterSpotsRemaining();

  if (spotsRemaining <= 0) return 0;

  const minimumAfterPurchase =
    Math.max(0, spotsRemaining - 1);

  const requiredReserve =
    minimumAfterPurchase *
    DraftState.settings.minimumBid;

  const maximumAffordable =
    remainingBudget - requiredReserve;

  return Math.max(
    0,
    Math.min(
      player.FinalValue,
      maximumAffordable
    )
  );
}
```

This gives the intersection of:

1. model value
2. actual affordability

The result should never allow the user to spend money required for remaining roster spots.

---

# 9. Position Scarcity

Scarcity should not simply mean:

> “There are 5 RBs left.”

It should incorporate:

- number of usable players remaining
- remaining VORP
- number of players in each tier
- quality of remaining players

Filter out players already purchased:

```javascript
function getAvailablePlayers() {
  const draftedIds = new Set(
    DraftState.roster.map(p => p.playerId)
  );

  return RAW_PLAYERS.filter(
    p => !draftedIds.has(p.playerId)
  );
}
```

---

# 10. Position Player Counts

```javascript
function calculatePositionCounts() {
  const players = getAvailablePlayers();

  return players.reduce((result, player) => {
    const pos = player.position;

    if (!result[pos]) {
      result[pos] = 0;
    }

    result[pos]++;

    return result;
  }, {});
}
```

---

# 11. Position VORP Remaining

Calculate the sum of positive VORP remaining by position.

Use whichever VORP field is authoritative in the current player object.

Example:

```javascript
function calculatePositionVORP() {
  const players = getAvailablePlayers();

  return players.reduce((result, player) => {
    const pos = player.position;
    const vorp = Number(
      player.VORP_tot ??
      player.VORP ??
      0
    );

    if (!result[pos]) {
      result[pos] = 0;
    }

    result[pos] += Math.max(0, vorp);

    return result;
  }, {});
}
```

Do not invent a new VORP calculation here.

Use the valuation engine's existing VORP field.

---

# 12. Tier Availability

Calculate how many players remain in each tier.

```javascript
function calculateTierAvailability() {
  const players = getAvailablePlayers();

  return players.reduce((result, player) => {
    const pos = player.position;
    const tier = player.tier;

    if (!result[pos]) {
      result[pos] = {};
    }

    if (!result[pos][tier]) {
      result[pos][tier] = 0;
    }

    result[pos][tier]++;

    return result;
  }, {});
}
```

This enables messages like:

```text
RB Tier 1: 2 remaining
RB Tier 2: 5 remaining
RB Tier 3: 8 remaining
```

---

# 13. Scarcity Score

Create a normalized 0–100 scarcity score.

A practical starting model:

```text
Scarcity =
    40% quality scarcity
  + 35% player-count scarcity
  + 25% tier scarcity
```

The exact weights should be configurable.

Do not use raw values directly because positions have different player pools.

Normalize each position against the other positions.

Example:

```javascript
function normalize(value, min, max) {
  if (max === min) return 50;

  return ((value - min) / (max - min)) * 100;
}
```

Because scarcity increases when availability decreases:

```javascript
const countScarcity =
  100 - normalizedCount;

const vorpScarcity =
  100 - normalizedVORP;
```

---

# 14. Recommended Scarcity Display

Display:

```text
POSITION SCARCITY

RB   HIGH       82
WR   LOW        31
TE   VERY HIGH  91
QB   MEDIUM     57
```

Use text labels in addition to color so the UI remains usable without color.

Suggested thresholds:

```javascript
function scarcityLabel(score) {
  if (score >= 80) return "VERY HIGH";
  if (score >= 65) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 25) return "LOW";
  return "VERY LOW";
}
```

---

# 15. Scarcity Context

The meter should explain itself.

Example:

```text
RB — HIGH (82)

Only 3 Tier 1/2 RBs remain.
$76 of positive RB VORP remains.
Next meaningful tier drop occurs after 2 players.
```

This is much more useful than a gauge with no explanation.

---

# 16. Decision Engine

The decision engine should answer:

> Given this player, my roster, my remaining budget, and the remaining player pool, should I buy, wait, or pass?

The output should contain:

```javascript
{
  action: "BUY",
  confidence: 0.86,

  currentBid: 31,
  modelValue: 34,

  recommendedMax: 35,

  score: 84,

  reasons: [
    "Current bid is below model value.",
    "RB scarcity is high.",
    "Only 2 comparable players remain in this tier."
  ],

  warnings: [],

  alternatives: []
}
```

---

# 17. Decision Inputs

The engine needs:

```javascript
function evaluatePlayer(player) {
  const budget = calculateBudgetRemaining();
  const spots = getRosterSpotsRemaining();

  const affordability =
    calculateAffordability(player);

  const valueScore =
    calculateValueScore(player);

  const needScore =
    calculateNeedScore(player);

  const scarcityScore =
    DraftState.positionScarcity[player.position];

  const tierScore =
    calculateTierUrgency(player);

  // combine
}
```

---

# 18. Value Score

The simplest version:

```javascript
function calculateValueScore(player) {
  const value = Number(player.FinalValue || 0);
  const bid = Number(player.currentBid || 0);

  if (bid <= 0) return 100;

  const discount = (value - bid) / value;

  return Math.max(
    0,
    Math.min(100, 50 + discount * 100)
  );
}
```

Interpretation:

```text
Bid far below value → high score
Bid near value       → ~50
Bid above value      → low score
```

---

# 19. Affordability Score

```javascript
function calculateAffordability(player) {
  const maxSpend =
    calculateRecommendedMaxSpend(player);

  const bid = Number(player.currentBid || 1);

  if (bid <= maxSpend) {
    return 100;
  }

  const excess = bid - maxSpend;

  return Math.max(
    0,
    100 - excess * 15
  );
}
```

---

# 20. Need Score

Position need should be strong but not overpower value.

Example:

```javascript
function calculateNeedScore(player) {
  const needs = DraftState.positionNeeds;

  if (needs[player.position] > 0) {
    return 100;
  }

  return 40;
}
```

Later, make this more granular:

```text
Need starter immediately     = 100
Need position soon            = 80
Useful depth                  = 55
No current need               = 25
Roster already strong         = 10
```

---

# 21. Tier Urgency

Calculate whether buying this player avoids a tier cliff.

```javascript
function calculateTierUrgency(player) {
  const available = getAvailablePlayers()
    .filter(p => p.position === player.position)
    .sort((a, b) =>
      Number(b.FinalValue) -
      Number(a.FinalValue)
    );

  const index = available.findIndex(
    p => p.playerId === player.playerId
  );

  if (index < 0) return 0;

  if (index <= 2) return 100;
  if (index <= 4) return 75;
  if (index <= 7) return 50;

  return 25;
}
```

This is a starting implementation. Once the exact tier-break representation is available, use the actual tier boundaries rather than player rank.

---

# 22. Combined Decision Score

Recommended starting weights:

```javascript
const weights = {
  value: 0.30,
  affordability: 0.20,
  need: 0.20,
  scarcity: 0.20,
  tierUrgency: 0.10
};
```

Then:

```javascript
function calculateDecisionScore(scores) {
  return (
    scores.value * weights.value +
    scores.affordability * weights.affordability +
    scores.need * weights.need +
    scores.scarcity * weights.scarcity +
    scores.tierUrgency * weights.tierUrgency
  );
}
```

Keep these weights configurable.

---

# 23. BUY / WAIT / PASS

Do not let score alone determine the decision.

First apply hard constraints.

### PASS

If:

```javascript
currentBid > recommendedMax
```

then:

```text
PASS
```

unless there is an explicit override.

### BUY

If:

```text
currentBid <= modelValue
AND
currentBid <= recommendedMax
AND
decisionScore >= 70
```

then:

```text
BUY
```

### WAIT

Otherwise:

```text
WAIT
```

This creates a hierarchy:

```text
Hard budget constraint
        ↓
Model price constraint
        ↓
Strategic scoring
        ↓
BUY / WAIT / PASS
```

---

# 24. Recommendation Examples

### BUY

```text
🟢 BUY

Current bid: $27
Model value: $34
Recommended max: $31

Why:
• $7 below model value
• RB scarcity is HIGH
• Only 2 Tier 2 RBs remain
• You still have $94 discretionary budget
```

### WAIT

```text
🟡 WAIT

Current bid: $29
Model value: $31
Recommended max: $33

Why:
• Fair price
• WR scarcity is LOW
• 9 comparable WRs remain
• Better opportunities are likely later
```

### PASS

```text
🔴 PASS

Current bid: $39
Model value: $34
Recommended max: $35

Why:
• $4 above recommended maximum
• 6 comparable WRs remain
• WR scarcity is LOW
```

---

# 25. Alternatives

Every WAIT or PASS should identify alternatives.

```javascript
function findAlternatives(player) {
  return getAvailablePlayers()
    .filter(p => p.playerId !== player.playerId)
    .filter(p => p.position === player.position)
    .filter(p => Number(p.FinalValue) >=
                Number(player.FinalValue) * 0.80)
    .sort((a, b) =>
      Number(b.FinalValue) -
      Number(a.FinalValue)
    )
    .slice(0, 3);
}
```

Display:

```text
BETTER ALTERNATIVES

1. Player B — $29 value — projected bid $25
2. Player C — $27 value — projected bid $23
3. Player D — $25 value — projected bid $21
```

---

# 26. Central Recalculation Function

Everything should update through one function:

```javascript
function recalculateDraftIntelligence() {

  calculateBudgetRemaining();

  DraftState.positionNeeds =
    calculatePositionNeeds();

  DraftState.reservedMinimum =
    calculateMinimumReserve();

  DraftState.discretionaryBudget =
    calculateDiscretionaryBudget();

  DraftState.positionScarcity =
    calculatePositionScarcity();

  renderBudgetPanel();
  renderPositionScarcity();

  if (DraftState.currentPlayerId) {
    const player =
      RAW_PLAYERS.find(
        p => p.playerId === DraftState.currentPlayerId
      );

    if (player) {
      renderDecisionPanel(
        evaluatePlayer(player)
      );
    }
  }
}
```

Call this whenever:

- a player is purchased
- a player is removed
- current bid changes
- current nomination changes
- roster is reset
- draft state is imported
- draft state is loaded

---

# 27. Purchase Event

Create one function for purchases:

```javascript
function purchasePlayer(player, price) {

  DraftState.roster.push({
    playerId: player.playerId,
    name: player.name,
    position: player.position,
    price: Number(price)
  });

  DraftState.currentPlayerId = null;
  DraftState.currentBid = 1;

  recalculateDraftIntelligence();

  saveDraftState();
}
```

This ensures every feature updates simultaneously.

---

# 28. UI Layout

Put the three features together.

```text
┌─────────────────────────────────────────────────────┐
│ BUDGET                                              │
│                                                     │
│ $143 remaining                                      │
│ $8 minimum reserve                                  │
│ $135 discretionary                                  │
│ $16.88 average / slot                              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ POSITION SCARCITY                                   │
│                                                     │
│ RB   HIGH       82    3 top-tier remain             │
│ WR   LOW        31    9 comparable remain           │
│ TE   VERY HIGH  91    2 quality players remain      │
│ QB   MEDIUM     57    5 useful players remain       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ WHAT SHOULD I DO?                                   │
│                                                     │
│ PLAYER X — RB                                       │
│                                                     │
│ Current bid       $27                               │
│ Model value       $34                               │
│ Recommended max   $31                               │
│                                                     │
│                 🟢 BUY                              │
│                                                     │
│ • $7 below model                                    │
│ • RB scarcity is high                              │
│ • Only 2 Tier 2 RBs remain                          │
└─────────────────────────────────────────────────────┘
```

---

# 29. Local Persistence

Use `localStorage`.

```javascript
function saveDraftState() {
  localStorage.setItem(
    "fwhffl_2026_draft_state",
    JSON.stringify(DraftState)
  );
}
```

Load:

```javascript
function loadDraftState() {
  const saved =
    localStorage.getItem(
      "fwhffl_2026_draft_state"
    );

  if (!saved) return;

  Object.assign(
    DraftState,
    JSON.parse(saved)
  );

  recalculateDraftIntelligence();
}
```

For production, validate the imported object before applying it.

---

# 30. Important Edge Cases

Handle these explicitly.

### Zero remaining roster spots

Decision engine should return:

```text
ROSTER FULL
```

### $1 remaining

No player can be recommended above $1.

### More money than roster spots

This is normal and means the user has discretionary spending power.

### Very little money and many spots

Show:

```text
BUDGET CONSTRAINT
You must average at least $X per remaining player.
```

### No players remaining at a position

Scarcity becomes:

```text
POSITION EMPTY
```

### Player already drafted

Do not evaluate them as available.

### Current bid above ceiling

Immediately show:

```text
PASS
```

---

# 31. Testing

Before connecting the UI, create deterministic tests.

### Test 1 — Initial state

```text
Budget = $200
Roster = 0
Spots = 13
Reserve = $13
Discretionary = $187
```

### Test 2 — Five $1 players

```text
Spent = $5
Remaining = $195
Spots = 8
Reserve = $8
Discretionary = $187
```

### Test 3 — Expensive player

```text
Remaining = $143
Spots = 8
Player value = $41

Recommended max must never exceed:
$136
```

because seven other slots must still be funded at $1.

### Test 4 — Scarcity

Remove all but two Tier 1 RBs.

RB scarcity should increase.

### Test 5 — PASS

If:

```text
Model = $30
Recommended max = $31
Current bid = $36
```

the result must be:

```text
PASS
```

### Test 6 — BUY

```text
Model = $35
Recommended max = $33
Current bid = $27
High need
High scarcity
```

Result:

```text
BUY
```

---

# 32. Implementation Order

Implement in this order.

## Step 1

Create:

```javascript
DraftState
```

and centralize roster/budget state.

## Step 2

Implement:

```javascript
calculateBudgetRemaining()
getRosterSpotsRemaining()
calculateMinimumReserve()
calculateDiscretionaryBudget()
calculateAverageAvailable()
```

## Step 3

Build the Budget panel.

Do not move on until these numbers are reliable.

## Step 4

Implement:

```javascript
getAvailablePlayers()
calculatePositionCounts()
calculatePositionVORP()
calculateTierAvailability()
calculatePositionScarcity()
```

## Step 5

Build the Position Scarcity panel.

## Step 6

Implement the individual player calculations:

```javascript
calculateValueScore()
calculateAffordability()
calculateNeedScore()
calculateTierUrgency()
```

## Step 7

Combine them into:

```javascript
evaluatePlayer()
```

## Step 8

Add:

```text
BUY / WAIT / PASS
```

## Step 9

Add explanation generation.

## Step 10

Add alternatives.

## Step 11

Connect everything through:

```javascript
recalculateDraftIntelligence()
```

## Step 12

Add localStorage persistence.

---

# 33. Design Principle

The most important rule for these features:

**Do not change the valuation model.**

Your existing model answers:

> “What is this player worth?”

The new system answers:

> “Given what I have, what remains, and what the auction looks like right now, what should I do?”

Those are different questions.

That separation keeps the 2026 model analytically clean while making the draft interface dramatically more useful.

The existing 2026 build already has measured replacement levels, MAE, dynamic tiers, barbell inflation, historical prices, and position-cap enforcement; these features should consume those outputs rather than recreate them. fileciteturn0file0L131-L138
