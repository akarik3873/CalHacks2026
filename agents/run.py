"""Runs the shopping agent (connected to Agentverse through its mailbox) and the three merchant agents.

    python run.py

Then open the Agent Inspector link printed in the log, click Connect, and choose Mailbox.

The shopper gets its own server so the Agentverse inspector finds it unambiguously; the merchants share a second one.
All four run in one process, so shopper <-> merchant messages are delivered locally.
"""

import asyncio
import hashlib
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from uagents import Bureau

from shopping.catalog import load_catalog, load_merchants
from shopping.merchant import create_merchant
from shopping.payments import SimulatedCardNetwork
from shopping.shopper import create_shopper

SHOPPER_PORT = 8001  # Builder's agent ports (see CLAUDE.md)
MERCHANT_PORT = 8002


def main() -> None:
    load_dotenv(Path(__file__).resolve().parent / ".env")
    seed = os.environ.get("SHOPPER_SEED")
    if not seed:
        sys.exit("Set SHOPPER_SEED in agents/.env (copy agents/.env.example). It fixes the agent's address, so keep it secret.")

    # Agents bind to the current event loop when created, so create it first.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    catalog = load_catalog()
    network = SimulatedCardNetwork()
    infos = load_merchants()
    merchants = [
        create_merchant(info, catalog, network, seed=hashlib.sha256(f"{seed}/merchant/{info.id}".encode()).hexdigest())
        for info in infos
    ]
    shopper = create_shopper(seed, {info.id: m.address for info, m in zip(infos, merchants)}, network, mailbox=True, port=SHOPPER_PORT)
    merchant_bureau = Bureau(agents=merchants, port=MERCHANT_PORT, endpoint=f"http://127.0.0.1:{MERCHANT_PORT}/submit", loop=loop)

    print(f"Health Supply Shopper address: {shopper.address}")
    for m in merchants:
        print(f"{m.name} address: {m.address}")
    print(
        "\nConnect the shopper to Agentverse: "
        f"https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A{SHOPPER_PORT}&address={shopper.address}\n"
    )

    try:
        loop.run_until_complete(asyncio.gather(shopper.run_async(), merchant_bureau.run_async()))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
