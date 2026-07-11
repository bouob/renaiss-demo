# Merchant Copilot

Merchant Copilot is a merchant-facing card shop intelligence app built on top of Renaiss market data.

It helps card shops understand market conditions, compare their inventory against the broader market, identify which cards are worth promoting, and decide which cards to hold or clear.

The product is designed as a lightweight two-page merchant workflow:

- `Dashboard`: market overview, featured cards, promotion candidates, fast-selling cards, and inventory cards that deserve attention
- `Inventory`: merchant inventory management with cost, pricing, market comparison, relative strength, trade-history views, and Push / Hold / Clear suggestions

---

## Core Concept

Merchant Copilot turns raw market data into merchant decisions.

Instead of acting as a marketplace, it works as an intelligence and merchandising layer for card shops:

- understand the overall market
- spot cards with strong momentum
- identify inventory that is outperforming
- find cards worth promoting
- find cards worth clearing
- support pricing and sell-through decisions

---

## Features

### Dashboard

The Dashboard gives merchants a fast view of what matters now.

It includes:

- market index overview
- mini charts and market change indicators
- featured cards of the day
- promotion candidates
- fast-selling cards
- inventory cards appearing in index movers
- cards worth special attention

### Inventory

The Inventory page helps merchants make decisions on the cards they actually hold.

It includes:

- add inventory by search or scan flow
- simple inventory inputs such as cost and asking price
- inventory vs market comparison
- relative strength view
- trade-history demo views
- suggested actions such as `Promote`, `Hold`, and `Clear`
- lightweight inventory actions such as marking a card for promotion, temporarily hiding it, or marking it sold

---

## Data Model

The app is designed around merchant-specific demo data collections such as:

- `hackathonMerchantInventory`
- `hackathonCardCache`
- `hackathonFeed`

Depending on the environment, some sections may use preloaded or seeded demo data for showcase purposes.

---

## Renaiss Relationship

Merchant Copilot is built around Renaiss market infrastructure and market data.

Examples of how Renaiss data is used:

- Index data: show overall market conditions for card shops
- FMV series: compare store inventory performance against the broader market
- Card-level market data: identify high-potential cards for featuring and promotion
- Trading data: surface cards with real momentum and liquidity
- Graded card lookup: support fast valuation and merchant decision-making
- Market signals: convert live card data into Promote, Hold, and Clear actions

---

## Getting Started

### Install

```bash
npm install
