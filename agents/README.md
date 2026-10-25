# Health Supply Shopper

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

An agent that restocks over-the-counter health supplies. Tell it what you need, how soon, and a budget. It checks price, stock, and delivery time at three merchant agents, builds the cheapest order that follows your rules, and pays only after you approve.

**Try it in ASI:One:** *"Pollen is spiking, restock my allergy kit today, under $55."*

## Agents
| Agent | Address | Role |
|---|---|---|
| Health Supply Shopper | `agent1qdu6xzjenl05urd5rpqtg59yhyhqx52uanren620nuhv7k8rxfhwqpyntpr` | Talks to you in ASI:One (Agent Chat Protocol), plans the order, pays as the buyer (Agent Payment Protocol) |
| Bayview Pharmacy | `agent1qvcqujqslhg99zhc2frvsmyh37j9pewjrg5zuzh2u8yuhfy64egh52qepza` | Merchant: cheapest, free delivery in 2 days |
| QuickCare Delivery | `agent1qw2qryqdy09dzgugxup0qv6y742ls6ayzhq2wjxd6sfdsm87lc7jyupvxxs` | Merchant: priciest, delivers in 45 minutes |
| Corner Health Market | `agent1qg00hjxn0l0rj2fk4y5r4ly34ahcunsdmg7hlqfrppqu993302wjxzlz5dg` | Merchant: mid-price, delivers in about 4 hours |

## What it can restock
| Kit | Example request | Items (in priority order) |
|---|---|---|
| Diabetes care | "My sensor is almost out, restock my diabetes kit" | Dexcom Stelo OTC CGM, Dex4 glucose gel, alcohol prep pads, lancets, sensor overpatches |
| Allergy and air quality | "AQI is bad, restock my allergy kit today" | Loratadine 10 mg, NeilMed saline spray, HEPA filter, inhaler spacer |
| Post-surgery recovery | "Day 3 after knee surgery, need wound supplies" | Telfa pads, paper tape, cold pack, Voltaren gel, TheraBand |
| Period care | "Cramps are starting, get my period kit today" | ThermaCare heat wraps, Advil, magnesium glycinate, dark chocolate |

## How it works
1. **Understands the request with the ASI:One model** (`asi1-mini`): the kit, the items you mentioned, how soon (within 2 hours, today, or within 3 days), your budget, and where you are. It reads plain speech like *"my nose won't stop running, grab the usual pills, forty bucks tops."* If the model is unavailable, keyword rules take over. The model can only read the request: the safety rules below re-run on your exact words, and it can't add products or raise a budget.
2. **Checks live air quality** for allergy and air-quality orders (US AQI from [Open-Meteo](https://open-meteo.com/)). At AQI 101 or above, the HEPA filter can't be dropped to save money, and delivery moves up to today unless you set a time. When the air is fine, nothing changes.
3. **Asks every merchant agent for a quote.** All three answer in parallel with price, stock, delivery time, and fee.
4. **Builds the cheapest valid order.** Tries every combination of merchants, counting delivery fees, and keeps only products you pre-approved that are in stock and arrive in time. Over budget? It drops optional items from the bottom of your priority list, and tells you which.
5. **Asks you to approve.** Sends an ASI Interactive Card (review card) with every item, merchant, fee, and the total, plus what it saves versus the next cheapest way to buy the same items (or why only one store works). Nothing is charged yet.
6. **Pays each merchant with the Agent Payment Protocol.** Merchant sends `RequestPayment`, the shopper checks the amount and recipient match what you approved, authorizes the card, and sends `CommitPayment`. The merchant verifies the authorization and replies `CompletePayment`.
7. **Sends a receipt** with order IDs and authorization codes, and writes an audit log entry.

## Safety rules (enforced in code)
- **No prescription items.** Prescription products (e.g. Dexcom G7, Libre 3, insulin, albuterol) are refused, and the agent won't swap in an OTC product you didn't ask for.
- **Strict budget.** Never over your stated budget or your profile's cap for that kit. Checked when planning, again before paying, and on every merchant's payment request.
- **No substitutions.** Each item can only be filled by the exact SKU, brand, or active ingredient + strength in your profile (`data/profile.json`).
- **Human approval before payment.** An ambiguous reply ("yes, cancel") cancels.
- **Emergencies aren't shopping.** Messages like "chest pain" get a call-911 reply and no order.

## What's real and what's simulated
| Real | Simulated |
|---|---|
| Fetch.ai agents, Agent Chat Protocol, Agent Payment Protocol messages between agents, ASI Interactive Cards | Merchants, their prices, stock, and delivery times (`data/merchants.json`) |
| ASI:One model reading each request; live US AQI from Open-Meteo | Card payments: `SimulatedCardNetwork` stands in for the Visa sandbox. Nothing real is charged |
| Order planning, guardrails, approval flow, audit log | |
| Product names (real OTC products) | The demo user's profile (`data/profile.json`) |

## Run it
Requires Python 3.11+.

```bash
cd agents
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
cp .env.example .env    # then set SHOPPER_SEED (a long random secret) and, optionally, ASI_ONE_API_KEY
.venv/Scripts/python run.py
```

Open the **Agent Inspector** link from the log, click **Connect**, and choose **Mailbox**. The shopper is then reachable from ASI:One. It listens on port 8001; the merchants on 8002.

## Tests
All three use port 8003, so they run alongside `run.py`, but not at the same time as each other.

| Script | What it checks | Network |
|---|---|---|
| `scripts/smoke.py` | Main flows end to end: every kit, approve and cancel, prescription refusal, emergencies, budgets, split orders, model and air-quality rules, savings line, receipt wording (36 checks) | none |
| `scripts/edge_cases.py` | Merchants going down, prices changing mid-order, inflated payment requests, lost payment confirmations, partial failures, sold-out items, double taps and stale cards, several users at once, odd and hostile input; ends by checking no stock is left on hold and every card authorization was captured or voided (46 checks) | none |
| `scripts/live_check.py` | Talks to the running shopper through the Almanac and the Agentverse mailbox (the same path ASI:One uses) and places one simulated order | real |

The offline tests replace the ASI:One model and the air-quality service with fixed stand-ins, so results are repeatable.

## Known limits
- One synthetic demo profile is shared by every user.
- Each item is ordered in quantity 1.
- Simulated merchants refill to their starting stock every hour, so repeated demos give the same answers.
- Carts wait 15 minutes for approval, then expire.

## Resources
- [Fetch.ai uAgents](https://innovationlab.fetch.ai/resources/docs/agent-creation/uagent-creation)
- [ASI:One](https://asi1.ai/) and [Agentverse](https://agentverse.ai/)
- [ASI Interactive Cards](https://innovationlab.fetch.ai/resources/docs/interactive-cards/asi-interactive-cards)
- [Agent Payment Protocol](https://innovationlab.fetch.ai/resources/docs/agent-transaction/agent-payment-protocol)
