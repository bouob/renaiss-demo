# Renaiss Merchant Copilot Hackathon Outline

> 來源：使用者提供的策略綱要（2026-07-11 存檔）。本檔為策略真相源；
> 與實作規劃 `../PLAN.md` 的合併/衝突對照見 PLAN.md 的「合併：衝突與調整」段。

## Goal

If the hackathon theme must strengthen Renaiss, Dokipoki should not try to replace the marketplace or become a generic POS first.

The stronger positioning is:

- Renaiss = market infrastructure, asset entry, listing/trade venue
- Dokipoki = intelligence, recommendation, merchandising, and operator guidance

This lets Dokipoki occupy a clear role inside the Renaiss ecosystem:

- turning raw price/trade data into merchant actions
- helping stores decide what to promote, what to hold, and what to clear
- making Renaiss more useful for merchants, not just collectors

---

## Version A: Merchant Copilot

### Positioning

Dokipoki acts as a merchant-facing recommendation and merchandising copilot for Renaiss-powered stores.

This version does not try to manage checkout, cashier flow, or full store operations.
It focuses on one question:

Which cards should a store push right now, and why?

### Core merchant problems

- A store does not know which cards are real movers versus thin-data noise.
- A store does not know which cards deserve homepage placement.
- A store does not know which cards are good for social promotion.
- A store does not know which cards are weakening and should be cleared.

### What Dokipoki does

- detects movers from Renaiss market data
- filters out weak or misleading movers
- recommends promotion candidates
- recommends clearance candidates
- generates action-oriented explanations

### Minimum feature set

#### 1. Market Movers

Use Renaiss price and trade data to find cards with strong market movement.

Minimum inputs:

- card detail
- trades
- FMV series
- featured movers
- optionally Dokipoki momentum/liquidity logic

Minimum logic:

- positive price movement across 7d / 30d windows
- basic liquidity threshold
- confidence threshold
- penalty for thin market behavior

Output example:

- Top 5 rising movers
- each card includes change, liquidity confidence, and a short reason

#### 2. Marketing Picks

From the mover list, choose cards that are worth merchant exposure.

Suggested action buckets:

- homepage hero
- featured shelf
- social-post candidate
- fast-sell candidate

Output example:

- "30d +18.4%, recent trade activity stable, suitable for homepage placement"

#### 3. Clearance Candidates

Use trend weakening plus low-liquidity or overextended behavior to suggest cards that are better sold sooner.

Output example:

- cards with weakening momentum
- cards with low confidence and poor follow-through
- cards whose exposure should be reduced rather than increased

#### 4. Explainable Recommendations

Every recommendation should explain why it is recommended.

Minimum explanation format:

- price movement
- liquidity or trade stability
- confidence
- recommended merchant action

### Merchant-facing outputs

The UI can stay simple:

- Recommended Movers
- Best Cards to Promote
- Clearance Watchlist
- Suggested Merchandising Actions

### Demo flow

1. Pull current Renaiss market data.
2. Rank movers using Dokipoki logic.
3. Surface top promotion candidates.
4. Surface likely clearance candidates.
5. Show a store homepage mock with Dokipoki-driven placements.

### Why this is good for a hackathon

- directly strengthens Renaiss data utility
- uses Renaiss APIs in a visible way
- gives Dokipoki a distinct role
- easier to demo than store operations tooling
- easier to explain than a generic analytics dashboard

### Why Dokipoki earns a place here

Dokipoki is not just showing prices.
It is turning market data into merchant actions.

That is a much clearer moat than building another marketplace surface.

---

## Version B: Merchant Copilot + Lightweight POS Layer

### Positioning

This version keeps the Merchant Copilot as the core product, but adds enough inventory awareness to answer a more practical store question:

Given the cards the store already has, which ones should it push, hold, or clear?

This is not a full POS system.
It is better described as:

- inventory-aware merchant copilot
- merchandising advisor with lightweight store inventory support

### Why add this layer

A pure market mover engine answers:

- what is moving in the market

But a store often cares more about:

- what is moving among the cards I actually have
- what I should feature from my own stock
- what I should clear from my own stock

### What gets added

#### 1. Inventory Input

Allow the store to add a lightweight inventory list.

Minimum fields:

- card identity
- grade or raw state
- quantity
- cost basis (optional)
- current ask price (optional)

Input methods can be simple:

- manual entry
- CSV import
- scan/import flow later

#### 2. Inventory Movers

Run the recommendation logic only on cards currently in stock.

This creates a higher-value merchant answer:

- these are the best cards in your own inventory to promote now

#### 3. Push / Hold / Clear Buckets

Classify in-stock cards into:

- Push
- Hold
- Clear

Suggested logic:

- Push: strong momentum, healthy liquidity, in stock
- Hold: stable but not urgent
- Clear: weakening momentum, low confidence, stale inventory, or profit-taking candidate

#### 4. Pricing Guidance

If cost basis and current ask are available, add:

- suggested sell range
- likely clearance range
- margin-sensitive recommendations

This does not need full pricing automation.
Even basic suggested ranges are useful.

#### 5. Merchandising Suggestions from Real Inventory

The system can now recommend:

- homepage placements from stock-on-hand
- social-post picks from stock-on-hand
- bundle or discount candidates from stock-on-hand

### Demo flow

1. Import a small example inventory.
2. Join inventory cards with Renaiss market signals.
3. Rank in-stock cards by merchant opportunity.
4. Show "Push / Hold / Clear" decisions.
5. Show a mock storefront using only store-owned cards.

### Why this version is stronger commercially

It moves from market commentary into operational usefulness.

Instead of saying:

- this card is rising

It says:

- you own this card, it is rising, and you should feature it now

That is a more immediate store use case.

### Why this should still not become a full POS in the hackathon

Full POS work expands too quickly into:

- checkout flow
- cashier operations
- user roles
- order state
- stock synchronization
- tax and receipt concerns
- return/refund logic

Those are valid product directions, but they dilute the Renaiss-strengthening story.

For hackathon scope, the better boundary is:

- inventory-aware recommendations, not full point-of-sale execution

---

## Recommended Direction

For the hackathon:

### Primary recommendation

Build Version A first:

- Merchant Copilot

### Best extension if there is time

Add the light inventory layer from Version B:

- Merchant Copilot + Lightweight POS Layer

### Do not start with

- full cashier POS
- transaction settlement system
- full multi-store inventory software
- chain-based custody or escrow

Those are product-expansion paths, not the best hackathon wedge.

---

## How Other Idea Fragments Fold Into This Product

Several adjacent ideas can be absorbed into the Merchant Copilot without creating a separate product line.

The key rule is:

- if it helps a merchant understand market context, inventory relevance, or action priority, it belongs inside the copilot
- if it only makes the screen feel alive, it is a demo enhancer rather than a core feature

### 1. Market Index Tile

Original idea:

- show the Pokemon market index with value, deltas, sparkline, and top movers

How it fits here:

- this becomes the top-of-dashboard market context block
- it gives merchants a benchmark before any card-specific recommendation appears

Merchant-facing interpretation:

- is the market broadly strong or weak today
- should the store lean into promotion, hold, or more defensive clearance behavior

Role in the product:

- core feature

Best placement:

- top row of Merchant Copilot

### 2. "Your Holdings Made the List"

Original idea:

- top movers intersected with a user's holdings

How it fits here:

- for merchants, this becomes top movers intersected with store inventory
- no product rewrite is needed; only the subject changes from collector holdings to merchant stock

Merchant-facing interpretation:

- the market is moving, and your store already owns one of the winning cards
- this creates immediate merchandising opportunities

Role in the product:

- core feature for the inventory-aware version

Best placement:

- inventory opportunities panel

### 3. Portfolio vs Market Chart

Original idea:

- compare a user's holdings curve against the Pokemon index

How it fits here:

- for merchants, this becomes inventory versus market
- it can compare:
  - all in-stock cards versus the index
  - featured inventory versus the index
  - promoted inventory versus the index

Merchant-facing interpretation:

- your inventory is outperforming the market
- your featured cards are lagging the market
- your store is pushing the wrong cards relative to current market strength

Role in the product:

- strong core feature in the inventory-aware version
- also a likely wow-moment chart for demo day

Best placement:

- middle dashboard performance comparison block

### 4. Alpha Badge

Original idea:

- subtract index performance from card performance to show excess return

How it fits here:

- this should become a first-class ranking and explanation signal
- it helps distinguish true strength from passive market lift

Merchant-facing interpretation:

- a card that rose less than the market is not truly strong
- a card that rose more than the market deserves more attention

Role in the product:

- core feature

Best placement:

- card badges, recommendation explanations, and ranking logic

### 5. Recent Trades Ticker

Original idea:

- a live rolling feed of recent trades from multiple sources

How it fits here:

- it helps the interface feel alive and active
- it supports the sense that the market is moving in real time

Merchant-facing interpretation:

- the market is active right now
- buyers are seeing real transaction flow, not a dead catalog

Role in the product:

- demo enhancer
- not required for core merchant value

Best placement:

- top banner or upper dashboard strip

### 6. Scan to FMV

Original idea:

- scan a slab or cert and immediately get valuation

How it fits here:

- this is not a separate product; it is the merchant input step
- it is especially useful for intake, quick appraisal, or deciding whether a card should be promoted

Merchant-facing interpretation:

- scan a card or slab
- understand value and confidence immediately
- decide whether it belongs in push, hold, or clear

Role in the product:

- strong supporting workflow
- especially useful in the Merchant Copilot + Lightweight POS Layer version

Best placement:

- intake flow or quick-add flow

---

## What Is Already Conceptually Included

Some of the external ideas do not require a new product concept at all.
They are already covered by the Merchant Copilot framing once the actor changes from collector to merchant.

### Collector framing -> Merchant framing

- "your holdings made the list" -> "your inventory made the list"
- "my portfolio vs market" -> "my store inventory vs market"
- "scan and value my card" -> "intake and evaluate store stock"

This is useful because it means the product direction remains coherent.
We are not stitching unrelated demos together.
We are adapting an existing intelligence pattern to a merchant operator.

---

## Expanded Merchant Copilot Structure

After folding the best external ideas in, the product structure becomes clearer:

### Layer 1: Market Context

- market index tile
- sparkline and index deltas
- optionally recent trades ticker

Purpose:

- show the merchant what kind of market day this is

### Layer 2: Inventory Relevance

- top movers intersected with store inventory
- cards currently in stock that deserve attention

Purpose:

- connect market data to the cards the store can actually sell

### Layer 3: Relative Intelligence

- alpha badge
- inventory versus market chart
- relative outperformance / underperformance

Purpose:

- separate true strength from passive market uplift

### Layer 4: Merchant Actions

- promote
- feature
- hold
- clear

Purpose:

- convert signals into store actions

---

## Suggested Product Framing

### One-line framing

Dokipoki turns Renaiss market data into merchant decisions: what to promote, what to hold, and what to clear.

### Slightly longer framing

Renaiss provides the market infrastructure and pricing signals.
Dokipoki becomes the merchant intelligence layer that helps stores decide which cards deserve attention and how to merchandise them.

---

## Practical MVP Recommendation

If a single MVP needs to be selected, use this scope:

### MVP

- ingest Renaiss market data
- show market index context at the top
- rank merchant-worthy movers
- mark cards with relative-strength or alpha-style logic
- recommend top promotion candidates
- recommend top clearance candidates
- show explanations
- optionally filter by store inventory and highlight inventory that overlaps with movers

### MVP tagline

Not just "what is moving in the market," but "what should this store do with the cards it can actually sell."

---

## Short Comparison

### Merchant Copilot

Best for:

- clean hackathon story
- strong Renaiss alignment
- fast demo
- clear Dokipoki differentiation

### Merchant Copilot + POS Layer

Best for:

- more merchant realism
- stock-aware recommendations
- clearer near-term business utility

### Full POS

Best for:

- later product expansion

Not best for:

- current hackathon focus
- strongest Renaiss narrative
- fast, compelling demo
