"""Shared setup for the offline test scripts: the shopper, the three merchants, and fake ASI:One users in one Bureau.

The ASI:One model and the air-quality service are replaced by fixed fakes, so every run gives the same answers."""

import asyncio
import json
import os
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from uagents import Agent, Bureau, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    MetadataContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.registration import BatchRegistrationPolicy

from shopping.airquality import AirReading
from shopping.catalog import load_catalog, load_kits, load_merchants
from shopping.merchant import create_merchant
from shopping.payments import SimulatedCardNetwork
from shopping.shopper import create_shopper

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'' if ok else f'  -> {detail}'}", flush=True)
    if not ok:
        failures.append(name)


class NoRegistration(BatchRegistrationPolicy):
    async def register(self):
        pass

    def add_agent(self, agent_info, identity):
        pass


@dataclass
class Reply:
    text: str
    card: dict | None  # the card's metadata
    payload: dict | None  # the card's parsed card_payload
    ended: bool  # EndSessionContent present


class Harness:
    def __init__(
        self,
        port: int,
        users: tuple[str, ...] = ("user",),
        model_replies: dict[str, str] | None = None,
        air: dict[str, AirReading] | None = None,
        reply_timeout: float = 20,
    ):
        self.port = port
        self.catalog = load_catalog()
        self.kits = load_kits()
        self.infos = load_merchants()
        self.network = SimulatedCardNetwork()
        self.model_replies = model_replies or {}
        self.air = air or {}
        self.merchants = {info.id: create_merchant(info, self.catalog, self.network, seed=f"test-merchant-{info.id}") for info in self.infos}
        self.addresses = {mid: m.address for mid, m in self.merchants.items()}
        self.shopper = create_shopper(
            "test-shopper",
            self.addresses,
            self.network,
            mailbox=False,
            readme=False,
            model_call=self._fake_model,
            air_lookup=self._fake_air,
            reply_timeout=reply_timeout,
        )
        self.users: dict[str, Agent] = {}
        self.inboxes: dict[str, asyncio.Queue[ChatMessage]] = {}
        self.contexts: dict[str, Context] = {}
        for name in users:
            self._add_user(name)

    async def _fake_model(self, system: str, user: str) -> str | None:
        reply = self.model_replies.get(user)
        if reply == "RAISE":
            raise RuntimeError("model exploded")
        return reply

    async def _fake_air(self, location: str) -> AirReading | None:
        return self.air.get(location)

    def _add_user(self, name: str) -> None:
        user = Agent(name=f"test-{name}", seed=f"test-user-{name}")
        inbox: asyncio.Queue[ChatMessage] = asyncio.Queue()
        chat = Protocol(spec=chat_protocol_spec)

        @chat.on_message(ChatMessage)
        async def on_reply(ctx: Context, sender: str, msg: ChatMessage):
            await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
            await inbox.put(msg)

        @chat.on_message(ChatAcknowledgement)
        async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
            pass

        @user.on_event("startup")
        async def remember(ctx: Context):
            self.contexts[name] = ctx

        user.include(chat)
        self.users[name] = user
        self.inboxes[name] = inbox

    async def send(self, text: str, user: str = "user") -> None:
        await self.contexts[user].send(self.shopper.address, ChatMessage(content=[TextContent(text=text)]))

    async def receive(self, user: str = "user", timeout: float = 30) -> Reply:
        msg = await asyncio.wait_for(self.inboxes[user].get(), timeout=timeout)
        card = next((c.metadata for c in msg.content if isinstance(c, MetadataContent)), None)
        payload = json.loads(card["card_payload"]) if card and "card_payload" in card else None
        return Reply(msg.text(), card, payload, any(isinstance(c, EndSessionContent) for c in msg.content))

    async def ask(self, text: str, user: str = "user", timeout: float = 30) -> Reply:
        await self.send(text, user)
        return await self.receive(user, timeout)

    async def nothing_received(self, user: str = "user", wait: float = 2) -> bool:
        try:
            await asyncio.wait_for(self.inboxes[user].get(), timeout=wait)
            return False
        except asyncio.TimeoutError:
            return True

    def captured(self) -> int:
        return sum(1 for a in self.network._auths.values() if a.status == "captured")

    def run(self, scenarios: Callable[["Harness"], Awaitable[None]]) -> None:
        async def go():
            while len(self.contexts) < len(self.users):
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.5)
            try:
                await scenarios(self)
            except Exception as error:  # a crash in a scenario is a failure, not a hang
                import traceback

                traceback.print_exc()
                check("scenarios ran to the end", False, repr(error))
            print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: ' + ', '.join(failures)}", flush=True)
            os._exit(1 if failures else 0)

        first = next(iter(self.users.values()))

        @first.on_event("startup")
        async def start(ctx: Context):
            asyncio.create_task(go())

        bureau = Bureau(
            agents=[self.shopper, *self.merchants.values(), *self.users.values()],
            port=self.port,
            registration_policy=NoRegistration(),
            log_level="WARNING",
        )
        bureau.run()
