"""Home LLM conversation agent."""
from __future__ import annotations

import logging
import time
from datetime import datetime

import aiohttp

from homeassistant.components import conversation
from homeassistant.components.conversation import ConversationInput, ConversationResult
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DOMAIN,
    CONF_PERSONA,
    CONF_QDRANT_URL,
    CONF_EMBED_URL,
    CONF_RETENTION_MINUTES,
    CONF_TOP_K,
    CONF_LLM_URL,
    CONF_LLM_MODEL,
    CONF_OPENCLAW_URL,
    CONF_OPENCLAW_API_KEY,
    DEFAULT_PERSONA,
    DEFAULT_QDRANT_URL,
    DEFAULT_EMBED_URL,
    DEFAULT_RETENTION_MINUTES,
    DEFAULT_TOP_K,
    DEFAULT_LLM_URL,
    DEFAULT_LLM_MODEL,
    DEFAULT_OPENCLAW_URL,
    DEFAULT_OPENCLAW_API_KEY,
    EMBEDDING_MODEL,
    QDRANT_COLLECTION,
    MAX_HISTORY_MESSAGES,
    OPENCLAW_INTENT_PREFIX,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up conversation platform."""
    async_add_entities([HomeLLMConversationEntity(hass, config_entry)])


class HomeLLMConversationEntity(conversation.ConversationEntity):
    """Home LLM conversation agent with memory recall."""

    _attr_has_entity_name = True
    _attr_name = "Home LLM"
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize."""
        self.hass = hass
        self.entry = entry
        self._attr_unique_id = entry.entry_id
        self._buffers: dict[str, list[tuple[float, str, str]]] = {}

    @property
    def supported_languages(self) -> list[str]:
        return ["de", "en"]

    @property
    def _persona(self) -> str:
        return self.entry.options.get(CONF_PERSONA, DEFAULT_PERSONA)

    @property
    def _qdrant_url(self) -> str:
        return self.entry.options.get(CONF_QDRANT_URL, DEFAULT_QDRANT_URL)

    @property
    def _embed_url(self) -> str:
        return self.entry.options.get(CONF_EMBED_URL, DEFAULT_EMBED_URL)

    @property
    def _retention_minutes(self) -> int:
        return self.entry.options.get(CONF_RETENTION_MINUTES, DEFAULT_RETENTION_MINUTES)

    @property
    def _top_k(self) -> int:
        return self.entry.options.get(CONF_TOP_K, DEFAULT_TOP_K)

    @property
    def _llm_url(self) -> str:
        return self.entry.options.get(CONF_LLM_URL, DEFAULT_LLM_URL)

    @property
    def _llm_model(self) -> str:
        return self.entry.options.get(CONF_LLM_MODEL, DEFAULT_LLM_MODEL)

    @property
    def _openclaw_url(self) -> str:
        return self.entry.options.get(CONF_OPENCLAW_URL, DEFAULT_OPENCLAW_URL)

    @property
    def _openclaw_api_key(self) -> str:
        return self.entry.options.get(CONF_OPENCLAW_API_KEY, DEFAULT_OPENCLAW_API_KEY)

    async def async_added_to_hass(self) -> None:
        conversation.async_set_agent(self.hass, self.entry, self)

    async def async_will_remove_from_hass(self) -> None:
        conversation.async_unset_agent(self.hass, self.entry)

    def _build_daylight_context(self) -> str:
        sun_state = self.hass.states.get("sun.sun")
        if not sun_state:
            return "Tageszeit unbekannt"
        elevation = sun_state.attributes.get("elevation", 0)
        if elevation > 10:
            return "Tag, neutrales Licht bevorzugt"
        elif elevation > -6:
            return "Dämmerung/Abend, warmes Licht bevorzugt"
        else:
            return "Nacht, gedimmtes warmes Licht bevorzugt"

    def _build_exposed_entities_context(self) -> str:
        """Build context from HA-exposed entities (Settings > Voice Assistants > Expose)."""
        try:
            from homeassistant.components.homeassistant.exposed_entities import (
                async_should_expose,
            )
        except ImportError:
            _LOGGER.warning("exposed_entities module not available")
            return ""

        try:
            condition_map = {
                "sunny": "sonnig", "partlycloudy": "teilweise bewölkt",
                "cloudy": "bewölkt", "rainy": "regnerisch", "pouring": "starker Regen",
                "snowy": "Schnee", "fog": "Nebel", "clear-night": "klare Nacht",
                "lightning-rainy": "Gewitter", "windy": "windig",
            }

            lines = []
            for state in sorted(
                self.hass.states.async_all(),
                key=lambda s: s.attributes.get("friendly_name", s.entity_id),
            ):
                if not async_should_expose(self.hass, "conversation", state.entity_id):
                    continue
                if state.state in ("unknown", "unavailable"):
                    continue

                name = state.attributes.get("friendly_name", state.entity_id)
                area = self._get_entity_area(state.entity_id)
                attrs = state.attributes

                # Weather entities: include temp + humidity from attributes
                if state.entity_id.startswith("weather."):
                    condition = condition_map.get(state.state, state.state)
                    parts = [condition]
                    if (temp := attrs.get("temperature")) is not None:
                        parts.append(f"{temp}°C")
                    if (hum := attrs.get("humidity")) is not None:
                        parts.append(f"{hum}% Luftfeuchtigkeit")
                    val = ", ".join(parts)
                else:
                    unit = attrs.get("unit_of_measurement", "")
                    val = f"{state.state} {unit}".strip()

                entry = f"- {name} ({area}): {val}" if area else f"- {name}: {val}"
                lines.append(entry)

            _LOGGER.debug("Exposed entities context: %d entities", len(lines))
            return "\n".join(lines) if lines else ""
        except Exception as err:
            _LOGGER.warning("Failed to build exposed entities context: %s", err)
            return ""

    def _get_entity_area(self, entity_id: str) -> str | None:
        """Get area name for an entity."""
        try:
            ent_reg = self.hass.data.get("entity_registry")
            if not ent_reg:
                return None
            entry = ent_reg.async_get(entity_id)
            if not entry:
                return None
            area_id = entry.area_id
            if not area_id and entry.device_id:
                dev_reg = self.hass.data.get("device_registry")
                if dev_reg:
                    device = dev_reg.async_get(entry.device_id)
                    if device:
                        area_id = device.area_id
            if area_id:
                area_reg = self.hass.data.get("area_registry")
                if area_reg:
                    area = area_reg.async_get_area(area_id)
                    if area:
                        return area.name
        except Exception:
            pass
        return None

    def _build_system_prompt(self, memory_block: str) -> str:
        now = datetime.now()
        current_time = now.strftime("%H:%M")
        daylight = self._build_daylight_context()

        entity_context = self._build_exposed_entities_context()

        parts = [
            "Du bist ein smarter Haushaltsassistent. Antworte auf Deutsch, "
            "kurz und natürlich (Sprachausgabe, kein Markdown).",
            "",
            "Kontext:",
            f"- Uhrzeit: {current_time}",
            f"- Tageszeit: {daylight}",
        ]

        if entity_context:
            parts.append("")
            parts.append("Aktuelle Geräte- und Sensordaten:")
            parts.append(entity_context)

        if memory_block:
            parts.append("")
            parts.append(memory_block)

        if self._persona:
            parts.append("")
            parts.append(self._persona)

        parts.append("")
        parts.append(
            "Wichtige Regeln:\n"
            "- Antworte nur mit Daten, die dir im Kontext gegeben wurden. "
            "Erfinde NIEMALS Sensorwerte, Temperaturen, Wetterdaten oder Gerätezustände.\n"
            "- Wenn du nach Daten gefragt wirst, die nicht im Kontext stehen, "
            "sage ehrlich, dass du darauf keinen Zugriff hast.\n"
            "- NUR wenn eine Frage echtes externes Wissen erfordert "
            "(z.B. Filmtermine, Nachrichten, Rezepte, Wissensfragen, Produktsuche), "
            "antworte mit: OPENCLAW: <die Anfrage in eigenen Worten>\n"
            "Beispiel: OPENCLAW: Wann kommt die nächste Scrubs-Folge in Deutschland?\n"
            "- Im Zweifel antworte selbst. Nutze OPENCLAW nur wenn du sicher bist, "
            "dass externes Wissen nötig ist."
        )

        return "\n".join(parts)

    async def _get_embedding(self, text: str) -> list[float] | None:
        """Get bge-m3 embedding via OpenAI-compatible API."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._embed_url}/v1/embeddings",
                    json={"model": EMBEDDING_MODEL, "input": text},
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    emb = data.get("data", [{}])[0].get("embedding")
                    if emb and len(emb) == 1024:
                        return emb
                    return None
        except (aiohttp.ClientError, TimeoutError, Exception) as err:
            _LOGGER.debug("Embedding failed: %s", err)
            return None

    async def _search_memories(self, query: str) -> str:
        vector = await self._get_embedding(query)
        if not vector:
            return ""

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._qdrant_url}/collections/{QDRANT_COLLECTION}/points/search",
                    json={
                        "vector": vector,
                        "limit": self._top_k,
                        "with_payload": True,
                        "score_threshold": 0.3,
                    },
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as resp:
                    if resp.status != 200:
                        return ""
                    data = await resp.json()
                    results = data.get("result", [])
                    if not results:
                        return ""

                    facts = []
                    seen = set()
                    for r in results:
                        fact = r.get("payload", {}).get("fact", "")
                        if fact and fact not in seen:
                            facts.append(fact)
                            seen.add(fact)

                    if not facts:
                        return ""

                    lines = "\n".join(f"- {f}" for f in facts)
                    return "Bekannte Fakten über den Haushalt (aus Memory):\n" + lines
        except (aiohttp.ClientError, TimeoutError, Exception) as err:
            _LOGGER.debug("Qdrant search failed: %s", err)
            return ""

    def _get_or_create_buffer(self, conversation_id: str) -> list[tuple[float, str, str]]:
        now = time.time()
        retention_secs = self._retention_minutes * 60
        buf = self._buffers.get(conversation_id)
        if buf and buf[-1][0] > now - retention_secs:
            while len(buf) > MAX_HISTORY_MESSAGES:
                buf.pop(0)
            return buf
        self._buffers[conversation_id] = []
        return self._buffers[conversation_id]

    def _buffer_to_messages(self, buf: list[tuple[float, str, str]]) -> list[dict[str, str]]:
        return [{"role": role, "content": content} for _, role, content in buf]

    async def _call_llm(self, messages: list[dict[str, str]]) -> str:
        """Call llama-server via OpenAI-compatible chat API."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._llm_url}/v1/chat/completions",
                    json={
                        "model": self._llm_model,
                        "messages": messages,
                        "max_tokens": 256,
                        "temperature": 0.15,
                        "stream": False,
                        "chat_template_kwargs": {"enable_thinking": False},
                    },
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        _LOGGER.error("LLM error %s: %s", resp.status, body[:200])
                        return "Entschuldigung, ich konnte gerade keine Antwort generieren."

                    data = await resp.json()
                    result = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    return result.strip() if result else "Ich habe keine Antwort."

        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("LLM request failed: %s", err)
            return "Entschuldigung, ich bin gerade nicht erreichbar."

    async def _call_openclaw(self, query: str) -> str:
        """Forward query to OpenClaw household agent."""
        headers = {}
        if self._openclaw_api_key:
            headers["Authorization"] = f"Bearer {self._openclaw_api_key}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._openclaw_url}/v1/chat/completions",
                    headers=headers,
                    json={
                        "model": "openclaw/household",
                        "messages": [{"role": "user", "content": query}],
                    },
                    timeout=aiohttp.ClientTimeout(total=60),
                ) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        _LOGGER.error("OpenClaw error %s: %s", resp.status, body[:200])
                        return "Entschuldigung, ich konnte die Information nicht abrufen."
                    data = await resp.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    return content.strip() if content else "Leider keine Antwort erhalten."
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("OpenClaw request failed: %s", err)
            return "Entschuldigung, mein Wissens-Service ist gerade nicht erreichbar."

    async def async_process(self, user_input: ConversationInput) -> ConversationResult:
        conversation_id = user_input.conversation_id or user_input.agent_id
        query = user_input.text

        _LOGGER.debug("Processing: %s (conv=%s)", query[:60], conversation_id)

        memory_block = await self._search_memories(query)
        system_prompt = self._build_system_prompt(memory_block)
        buf = self._get_or_create_buffer(conversation_id)

        messages: list[dict[str, str]] = [
            {"role": "system", "content": system_prompt}
        ]
        messages.extend(self._buffer_to_messages(buf))
        messages.append({"role": "user", "content": query})

        response_text = await self._call_llm(messages)

        # Check for OpenClaw delegation intent
        if response_text.strip().startswith(OPENCLAW_INTENT_PREFIX):
            openclaw_query = response_text.strip()[len(OPENCLAW_INTENT_PREFIX):].strip()
            _LOGGER.info("Delegating to OpenClaw: %s", openclaw_query[:80])
            response_text = await self._call_openclaw(openclaw_query)

        now = time.time()
        buf.append((now, "user", query))
        buf.append((now, "assistant", response_text))

        response = intent.IntentResponse(language=user_input.language)
        response.async_set_speech(response_text)

        return ConversationResult(
            response=response,
            conversation_id=conversation_id,
        )
