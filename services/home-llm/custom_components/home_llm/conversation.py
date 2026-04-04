"""Home LLM conversation agent with native tool-calling via Assist API."""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime
from pathlib import Path

import aiohttp

from homeassistant.components import conversation
from homeassistant.components.conversation import ConversationInput, ConversationResult
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent, llm as llm_helper
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DOMAIN,
    CONF_AGENT_ID,
    CONF_PERSONA,
    CONF_QDRANT_URL,
    CONF_EMBED_URL,
    CONF_RETENTION_MINUTES,
    CONF_TOP_K,
    CONF_LLM_URL,
    CONF_LLM_MODEL,
    CONF_OPENCLAW_URL,
    CONF_OPENCLAW_API_KEY,
    CONF_ENABLE_CONTROL,
    CONF_THINKING_BUDGET,
    DEFAULT_AGENT_ID,
    DEFAULT_PERSONA,
    DEFAULT_QDRANT_URL,
    DEFAULT_EMBED_URL,
    DEFAULT_RETENTION_MINUTES,
    DEFAULT_TOP_K,
    DEFAULT_LLM_URL,
    DEFAULT_LLM_MODEL,
    DEFAULT_OPENCLAW_URL,
    DEFAULT_OPENCLAW_API_KEY,
    DEFAULT_ENABLE_CONTROL,
    DEFAULT_THINKING_BUDGET,
    EMBEDDING_MODEL,
    MAX_HISTORY_MESSAGES,
    OPENCLAW_INTENT_PREFIX,
    EXTRA_ATTRIBUTES_TO_EXPOSE,
)

_LOGGER = logging.getLogger(__name__)
_TOOL_LOGGER = logging.getLogger(f"{__name__}.tool_calls")


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up conversation platform."""
    async_add_entities([HomeLLMConversationEntity(hass, config_entry)])


class HomeLLMConversationEntity(conversation.ConversationEntity):
    """Home LLM conversation agent with memory recall and native tool-calling."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize."""
        self.hass = hass
        self.entry = entry
        self._attr_unique_id = entry.entry_id
        agent_id = entry.options.get(CONF_AGENT_ID, DEFAULT_AGENT_ID)
        self._attr_name = f"Home LLM ({agent_id})"
        self._buffers: dict[str, list[tuple[float, str, str]]] = {}

        if entry.options.get(CONF_ENABLE_CONTROL, DEFAULT_ENABLE_CONTROL):
            self._attr_supported_features = (
                conversation.ConversationEntityFeature.CONTROL
            )

    # ── Properties ──

    @property
    def _agent_id(self) -> str:
        return self.entry.options.get(CONF_AGENT_ID, DEFAULT_AGENT_ID)

    @property
    def _qdrant_collection(self) -> str:
        return f"memories_{self._agent_id}"

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

    @property
    def _enable_control(self) -> bool:
        return self.entry.options.get(CONF_ENABLE_CONTROL, DEFAULT_ENABLE_CONTROL)

    @property
    def _thinking_budget(self) -> int:
        return self.entry.options.get(CONF_THINKING_BUDGET, DEFAULT_THINKING_BUDGET)

    # ── Lifecycle ──

    async def async_added_to_hass(self) -> None:
        conversation.async_set_agent(self.hass, self.entry, self)

    async def async_will_remove_from_hass(self) -> None:
        conversation.async_unset_agent(self.hass, self.entry)

    # ── Entity context ──

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
        """Build context from HA-exposed entities with entity_id and attributes."""
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

                if state.entity_id.startswith("weather."):
                    condition = condition_map.get(state.state, state.state)
                    parts = [condition]
                    if (temp := attrs.get("temperature")) is not None:
                        parts.append(f"{temp}°C")
                    if (hum := attrs.get("humidity")) is not None:
                        parts.append(f"{hum}%")
                    state_str = ";".join(parts)
                else:
                    unit = attrs.get("unit_of_measurement", "")
                    state_str = f"{state.state} {unit}".strip()

                    extra = []
                    for attr_name in EXTRA_ATTRIBUTES_TO_EXPOSE:
                        val = attrs.get(attr_name)
                        if val is None:
                            continue
                        if attr_name == "brightness":
                            extra.append(f"{int(val / 255 * 100)}%")
                        elif attr_name == "temperature":
                            extra.append(f"{val}°C")
                        elif attr_name == "humidity":
                            extra.append(f"{val}%")
                        elif attr_name == "rgb_color":
                            extra.append(f"rgb{val}")
                        elif attr_name == "color_temp":
                            extra.append(f"{val}K")
                        else:
                            extra.append(str(val))
                    if extra:
                        state_str = state_str + ";" + ";".join(extra)

                area_str = f" ({area})" if area else ""
                entry = f"{name}{area_str}: {state_str}"
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

    # ── Tools ──

    @staticmethod
    def _format_tools_for_api(llm_api: llm_helper.APIInstance) -> list[dict]:
        """Convert Assist API tools to OpenAI-compatible tool definitions."""
        from voluptuous_openapi import convert

        tools = []
        for tool in llm_api.tools:
            try:
                params = convert(tool.parameters)
            except Exception:
                params = {"type": "object", "properties": {}}
            tools.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": params,
                },
            })
        return tools

    # ── System prompt ──

    _PROMPT_TEMPLATE_PATH = Path(__file__).parent / "system_prompt.txt"

    def _build_system_prompt(self, memory_block: str) -> str:
        now = datetime.now()
        current_time = now.strftime("%H:%M")
        daylight = self._build_daylight_context()
        entity_context = self._build_exposed_entities_context()

        # Build entity block with header (or empty)
        entity_block = ""
        if entity_context:
            entity_block = "Aktuelle Geräte- und Sensordaten:\n" + entity_context

        try:
            template = self._PROMPT_TEMPLATE_PATH.read_text(encoding="utf-8")
        except (FileNotFoundError, IOError) as err:
            _LOGGER.warning("system_prompt.txt nicht gefunden (%s), nutze Fallback", err)
            return self._build_system_prompt_fallback(memory_block)

        prompt = template.replace("{{TIME}}", current_time)
        prompt = prompt.replace("{{DAYLIGHT}}", daylight)
        prompt = prompt.replace("{{ENTITIES}}", entity_block)
        prompt = prompt.replace("{{MEMORY_BLOCK}}", memory_block or "")
        prompt = prompt.replace("{{PERSONA}}", self._persona or "")

        # Remove lines that are now empty (from unfilled placeholders)
        prompt = re.sub(r'\n{3,}', '\n\n', prompt)
        return prompt.strip()

    def _build_system_prompt_fallback(self, memory_block: str) -> str:
        """Hardcoded fallback if system_prompt.txt is missing."""
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
            "Format:\n"
            "Antworte in Fließtext, maximal 1-2 Sätze. "
            "Kein Markdown, keine Listen, keine Aufzählungszeichen. "
            "Einheiten ausschreiben: Grad statt °C, Prozent statt %.\n"
            "\n"
            "Daten:\n"
            "Antworte nur mit Daten aus dem Kontext oben. "
            "Erfinde NIEMALS Sensorwerte, Temperaturen, Wetterdaten oder Gerätezustände. "
            "Wenn Daten fehlen, sage ehrlich, dass du keinen Zugriff hast.\n"
            "\n"
            "Gerätesteuerung:\n"
            "Minimale Bestätigung genügt (z.B. 'Erledigt.' oder 'Licht an.'). "
            "Gerät aus aber heller/wärmer gewünscht? Zuerst einschalten. "
            "Mehrere Geräte gleichzeitig steuern ist möglich. "
            "Wenn kein Raum genannt wird, frage nach welchem Raum gemeint ist.\n"
            "\n"
            "OPENCLAW-Delegation:\n"
            "Fragen die aktuelles, lokales oder persönliches Wissen brauchen "
            "(Öffnungszeiten, Restaurants, Produktsuche, Nachrichten, Rezepte, "
            "Kalender, Medien-Bibliothek) delegierst du an OpenClaw. "
            "Antworte dann NUR mit: OPENCLAW: <Anfrage>\n"
            "Kein Text davor oder danach.\n"
            "Einfaches Allgemeinwissen (Geografie, Geschichte, Mathe) beantworte selbst.\n"
            "\n"
            "Beispiele:\n"
            "Nutzer: Hat der Burgerking in Sindelfingen noch offen?\n"
            "Antwort: OPENCLAW: Hat der Burgerking in Sindelfingen noch offen?\n"
            "Nutzer: Was ist die Hauptstadt von Frankreich?\n"
            "Antwort: Paris."
        )

        return "\n".join(parts)

    # ── Embedding + Memory ──

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
            return "[Memory-System: offline]\nLangzeitspeicher nicht erreichbar — antworte mit Kurzzeit-/Konversationswissen.\n[/Memory-System]"

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._qdrant_url}/collections/{self._qdrant_collection}/points/search",
                    json={
                        "vector": vector,
                        "limit": self._top_k,
                        "with_payload": True,
                        "score_threshold": 0.3,
                    },
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as resp:
                    if resp.status != 200:
                        _LOGGER.debug("Qdrant returned HTTP %s", resp.status)
                        return "[Memory-System: offline]\nLangzeitspeicher nicht erreichbar — antworte mit Kurzzeit-/Konversationswissen.\n[/Memory-System]"
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
                    return f"Bekannte Fakten ({self._agent_id}, aus Memory):\n" + lines
        except (aiohttp.ClientError, TimeoutError, Exception) as err:
            _LOGGER.debug("Qdrant search failed: %s", err)
            return "[Memory-System: offline]\nLangzeitspeicher nicht erreichbar — antworte mit Kurzzeit-/Konversationswissen.\n[/Memory-System]"

    # ── Conversation buffer ──

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

    # ── LLM call ──

    async def _call_llm(
        self,
        messages: list[dict[str, str]],
        tools: list[dict] | None = None,
    ) -> tuple[str, list[dict]]:
        """Call llama-server via OpenAI-compatible chat API.

        Returns (content_text, tool_calls_list).
        """
        request_body: dict = {
            "model": self._llm_model,
            "messages": messages,
            "max_tokens": 512,
            "temperature": 0.15,
            "stream": False,
        }

        timeout_sec = 15
        if tools:
            request_body["tools"] = tools
            request_body["tool_choice"] = "auto"
            timeout_sec = 30

        if self._thinking_budget > 0:
            request_body["thinking"] = {
                "type": "enabled",
                "budget_tokens": self._thinking_budget,
            }
        else:
            request_body["chat_template_kwargs"] = {"enable_thinking": False}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._llm_url}/v1/chat/completions",
                    json=request_body,
                    timeout=aiohttp.ClientTimeout(total=timeout_sec),
                ) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        _LOGGER.error("LLM error %s: %s", resp.status, body[:200])
                        return ("Entschuldigung, ich konnte gerade keine Antwort generieren.", [])

                    data = await resp.json()
                    msg = data.get("choices", [{}])[0].get("message", {})
                    content = (msg.get("content") or "").strip()
                    tool_calls = msg.get("tool_calls") or []
                    return (content, tool_calls)

        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("LLM request failed: %s", err)
            return ("Entschuldigung, ich bin gerade nicht erreichbar.", [])

    # ── OpenClaw delegation ──

    async def _call_openclaw(self, query: str) -> str:
        """Forward query to OpenClaw household agent."""
        headers = {}
        if self._openclaw_api_key:
            headers["Authorization"] = f"Bearer {self._openclaw_api_key}"
        headers["X-OpenClaw-Scopes"] = "operator.write"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._openclaw_url}/v1/chat/completions",
                    headers=headers,
                    json={
                        "model": f"openclaw/{self._agent_id}",
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

    # ── Tool-call execution ──

    async def _execute_tool_call(
        self,
        tool_call: dict,
        llm_api: llm_helper.APIInstance,
        llm_context,
        query: str,
    ) -> bool:
        """Execute a native API tool call. Returns True on success."""
        try:
            func = tool_call.get("function", {})
            tool_name = func.get("name", "")
            raw_args = func.get("arguments", "{}")
            tool_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args

            # Clean up name field — some models return "entity_id 'friendly_name'" or quoted names
            if "name" in tool_args and isinstance(tool_args["name"], str):
                name = tool_args["name"]
                # Strip entity_id prefix: "light.ambiente 'Ambiente'" → "Ambiente"
                if "'" in name:
                    import re
                    match = re.search(r"'([^']+)'", name)
                    if match:
                        name = match.group(1)
                # Strip quotes
                name = name.strip("'\"")
                tool_args["name"] = name

        except (json.JSONDecodeError, KeyError) as err:
            _TOOL_LOGGER.warning(
                "TOOL_CALL_FAIL user=%s tool=? args=? error=bad format: %s",
                query[:80], err,
            )
            return False

        matching_tool = None
        for tool in llm_api.tools:
            if tool.name == tool_name:
                matching_tool = tool
                break

        if not matching_tool:
            _TOOL_LOGGER.warning(
                "TOOL_CALL_FAIL user=%s tool=%s args=%s error=tool not found",
                query[:80], tool_name, json.dumps(tool_args),
            )
            return False

        try:
            tool_input = llm_helper.ToolInput(
                tool_name=tool_name,
                tool_args=tool_args,
            )
            await matching_tool.async_call(self.hass, tool_input, llm_context)
            _TOOL_LOGGER.info(
                "TOOL_CALL_SUCCESS user=%s tool=%s args=%s",
                query[:80], tool_name, json.dumps(tool_args),
            )
            return True
        except Exception as err:
            _TOOL_LOGGER.warning(
                "TOOL_CALL_FAIL user=%s tool=%s args=%s error=%s",
                query[:80], tool_name, json.dumps(tool_args), err,
            )
            return False

    # ── Main processing ──

    async def async_process(self, user_input: ConversationInput) -> ConversationResult:
        conversation_id = user_input.conversation_id or user_input.agent_id
        query = user_input.text

        _LOGGER.debug("Processing: %s (conv=%s)", query[:60], conversation_id)

        # Get Assist API for device control
        llm_api = None
        llm_context = None
        formatted_tools = None
        if self._enable_control:
            try:
                llm_context = llm_helper.LLMContext(
                    platform=DOMAIN,
                    context=user_input.context,
                    language=user_input.language or "de",
                    assistant=conversation.DOMAIN,
                    device_id=user_input.device_id,
                )
                llm_api = await llm_helper.async_get_api(
                    self.hass, "assist", llm_context
                )
                formatted_tools = self._format_tools_for_api(llm_api)
            except Exception as err:
                _LOGGER.warning("Assist API nicht verfügbar: %s", err)

        memory_block = await self._search_memories(query)
        system_prompt = self._build_system_prompt(memory_block)
        buf = self._get_or_create_buffer(conversation_id)

        messages: list[dict[str, str]] = [
            {"role": "system", "content": system_prompt}
        ]
        messages.extend(self._buffer_to_messages(buf))
        messages.append({"role": "user", "content": query})

        content, tool_calls = await self._call_llm(messages, tools=formatted_tools)

        # Route: tool-calls first (device action), then text
        if tool_calls and llm_api:
            any_success = False
            for tc in tool_calls:
                if await self._execute_tool_call(tc, llm_api, llm_context, query):
                    any_success = True

            if any_success:
                response_text = content or "Erledigt."
            elif content:
                # Retry: feed speech text to HA intent system
                _TOOL_LOGGER.info("Retry als Intent: %s", content[:80])
                try:
                    retry_result = await conversation.async_converse(
                        self.hass,
                        content,
                        conversation_id=None,
                        context=user_input.context,
                        language=user_input.language or "de",
                        agent_id="conversation.home_assistant",
                    )
                    resp_data = retry_result.response
                    if resp_data.response_type == intent.IntentResponseType.ACTION_DONE:
                        plain = resp_data.speech.get("plain", {})
                        response_text = plain.get("speech", content)
                    else:
                        response_text = content
                except Exception as err:
                    _LOGGER.debug("Intent retry failed: %s", err)
                    response_text = content
            else:
                response_text = "Das hat leider nicht geklappt."

        elif content and content.strip().startswith(OPENCLAW_INTENT_PREFIX):
            # OpenClaw delegation
            openclaw_query = content.strip()[len(OPENCLAW_INTENT_PREFIX):].strip()
            _LOGGER.info("Delegating to OpenClaw: %s", openclaw_query[:80])
            response_text = await self._call_openclaw(openclaw_query)

        else:
            response_text = content

        now = time.time()
        buf.append((now, "user", query))
        buf.append((now, "assistant", response_text))

        response = intent.IntentResponse(language=user_input.language)
        response.async_set_speech(response_text)

        return ConversationResult(
            response=response,
            conversation_id=conversation_id,
        )
