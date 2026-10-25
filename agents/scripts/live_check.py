"""Talks to the running shopper over the real network, through Fetch.ai's Almanac and the Agentverse mailbox: the same
path ASI:One uses. Start run.py first. Uses port 8003 (don't run it at the same time as the offline tests).

    python scripts/live_check.py

Places one simulated order (nothing real is charged).
"""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents.crypto import Identity
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    MetadataContent,
    TextContent,
    chat_protocol_spec,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
SHOPPER = Identity.from_seed(os.environ["SHOPPER_SEED"], 0).address
PORT = 8003
REPLY_WAIT_SECONDS = 90

client = Agent(name="live-check-client", seed="calhacks-live-check-client", port=PORT, endpoint=[f"http://127.0.0.1:{PORT}/submit"])
inbox: asyncio.Queue[ChatMessage] = asyncio.Queue()
acks: asyncio.Queue[ChatAcknowledgement] = asyncio.Queue()
chat = Protocol(spec=chat_protocol_spec)
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'' if ok else f'  -> {detail}'}", flush=True)
    if not ok:
        failures.append(name)


@chat.on_message(ChatMessage)
async def on_reply(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
    await inbox.put(msg)


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    await acks.put(msg)


client.include(chat)


async def ask(ctx: Context, text: str):
    started = asyncio.get_running_loop().time()
    await ctx.send(SHOPPER, ChatMessage(content=[TextContent(text=text)]))
    msg = await asyncio.wait_for(inbox.get(), timeout=REPLY_WAIT_SECONDS)
    elapsed = asyncio.get_running_loop().time() - started
    card = next((c.metadata for c in msg.content if isinstance(c, MetadataContent)), None)
    ended = any(isinstance(c, EndSessionContent) for c in msg.content)
    print(f"      reply in {elapsed:.1f}s", flush=True)
    return msg.text(), card, ended


async def run(ctx: Context):
    await asyncio.sleep(8)  # let the Almanac registration land so the shopper can find us
    try:
        text, card, ended = await ask(ctx, "Pollen is spiking, restock my allergy kit today, under $55")
        check("live: review card over the network", card is not None and card.get("card_kind") == "review" and not ended, text[:300])
        check("live: expected total", "Total: $50.96" in text, text[:300])
        check("live: real air-quality reading included", "Live air quality in San Francisco" in text or "couldn't get live air quality" in text, text[:400])
        check("live: acknowledgement received", not acks.empty())
        selection = json.loads(card["card_payload"])["approve_cta"]["selection"]
        text, _, ended = await ask(ctx, json.dumps(selection))
        check("live: approval pays through the payment protocol", "**Order placed**" in text and "$50.96 paid" in text and ended, text[:300])
        text, card, ended = await ask(ctx, "My Dexcom G7 sensor is running out, I need it ASAP")
        check("live: prescription refused", "can't order Dexcom G7 Sensor" in text and card is None, text[:300])
    except asyncio.TimeoutError:
        check("live: shopper replied in time", False, f"no reply within {REPLY_WAIT_SECONDS}s: is run.py up and the mailbox connected?")
    print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: ' + ', '.join(failures)}", flush=True)
    os._exit(1 if failures else 0)


@client.on_event("startup")
async def start(ctx: Context):
    asyncio.create_task(run(ctx))


if __name__ == "__main__":
    client.run()
