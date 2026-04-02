"""Config flow for Home LLM integration."""
from __future__ import annotations

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, OptionsFlow, ConfigEntry
from homeassistant.core import callback

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
)


async def _validate_llm(llm_url: str) -> bool:
    """Validate the LLM server is reachable."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{llm_url}/health",
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                return resp.status == 200
    except (aiohttp.ClientError, TimeoutError):
        return False


class HomeLLMConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Home LLM."""

    VERSION = 6

    async def async_step_user(self, user_input=None):
        errors = {}

        if user_input is not None:
            llm_url = user_input.get(CONF_LLM_URL, DEFAULT_LLM_URL)

            if await _validate_llm(llm_url):
                agent_id = user_input.get(CONF_AGENT_ID, DEFAULT_AGENT_ID)
                return self.async_create_entry(
                    title=f"Home LLM ({agent_id})",
                    data={},
                    options={
                        CONF_AGENT_ID: agent_id,
                        CONF_LLM_URL: llm_url,
                        CONF_LLM_MODEL: user_input.get(CONF_LLM_MODEL, DEFAULT_LLM_MODEL),
                        CONF_PERSONA: user_input.get(CONF_PERSONA, DEFAULT_PERSONA),
                        CONF_QDRANT_URL: user_input.get(CONF_QDRANT_URL, DEFAULT_QDRANT_URL),
                        CONF_EMBED_URL: user_input.get(CONF_EMBED_URL, DEFAULT_EMBED_URL),
                        CONF_RETENTION_MINUTES: user_input.get(CONF_RETENTION_MINUTES, DEFAULT_RETENTION_MINUTES),
                        CONF_TOP_K: user_input.get(CONF_TOP_K, DEFAULT_TOP_K),
                        CONF_OPENCLAW_URL: user_input.get(CONF_OPENCLAW_URL, DEFAULT_OPENCLAW_URL),
                        CONF_OPENCLAW_API_KEY: user_input.get(CONF_OPENCLAW_API_KEY, DEFAULT_OPENCLAW_API_KEY),
                        CONF_ENABLE_CONTROL: user_input.get(CONF_ENABLE_CONTROL, DEFAULT_ENABLE_CONTROL),
                        CONF_THINKING_BUDGET: user_input.get(CONF_THINKING_BUDGET, DEFAULT_THINKING_BUDGET),
                    },
                )
            errors["base"] = "cannot_connect"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_AGENT_ID, default=DEFAULT_AGENT_ID): str,
                    vol.Optional(CONF_LLM_URL, default=DEFAULT_LLM_URL): str,
                    vol.Optional(CONF_LLM_MODEL, default=DEFAULT_LLM_MODEL): str,
                    vol.Optional(CONF_PERSONA, default=DEFAULT_PERSONA): str,
                    vol.Optional(CONF_QDRANT_URL, default=DEFAULT_QDRANT_URL): str,
                    vol.Optional(CONF_EMBED_URL, default=DEFAULT_EMBED_URL): str,
                    vol.Optional(CONF_RETENTION_MINUTES, default=DEFAULT_RETENTION_MINUTES): int,
                    vol.Optional(CONF_TOP_K, default=DEFAULT_TOP_K): int,
                    vol.Optional(CONF_OPENCLAW_URL, default=DEFAULT_OPENCLAW_URL): str,
                    vol.Optional(CONF_OPENCLAW_API_KEY, default=DEFAULT_OPENCLAW_API_KEY): str,
                    vol.Optional(CONF_ENABLE_CONTROL, default=DEFAULT_ENABLE_CONTROL): bool,
                    vol.Optional(CONF_THINKING_BUDGET, default=DEFAULT_THINKING_BUDGET): int,
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return HomeLLMOptionsFlow(config_entry)


class HomeLLMOptionsFlow(OptionsFlow):
    def __init__(self, config_entry: ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        opts = self._config_entry.options

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_AGENT_ID, default=opts.get(CONF_AGENT_ID, DEFAULT_AGENT_ID)): str,
                    vol.Optional(CONF_LLM_URL, default=opts.get(CONF_LLM_URL, DEFAULT_LLM_URL)): str,
                    vol.Optional(CONF_LLM_MODEL, default=opts.get(CONF_LLM_MODEL, DEFAULT_LLM_MODEL)): str,
                    vol.Optional(CONF_PERSONA, default=opts.get(CONF_PERSONA, DEFAULT_PERSONA)): str,
                    vol.Optional(CONF_QDRANT_URL, default=opts.get(CONF_QDRANT_URL, DEFAULT_QDRANT_URL)): str,
                    vol.Optional(CONF_EMBED_URL, default=opts.get(CONF_EMBED_URL, DEFAULT_EMBED_URL)): str,
                    vol.Optional(CONF_RETENTION_MINUTES, default=opts.get(CONF_RETENTION_MINUTES, DEFAULT_RETENTION_MINUTES)): int,
                    vol.Optional(CONF_TOP_K, default=opts.get(CONF_TOP_K, DEFAULT_TOP_K)): int,
                    vol.Optional(CONF_OPENCLAW_URL, default=opts.get(CONF_OPENCLAW_URL, DEFAULT_OPENCLAW_URL)): str,
                    vol.Optional(CONF_OPENCLAW_API_KEY, default=opts.get(CONF_OPENCLAW_API_KEY, DEFAULT_OPENCLAW_API_KEY)): str,
                    vol.Optional(CONF_ENABLE_CONTROL, default=opts.get(CONF_ENABLE_CONTROL, DEFAULT_ENABLE_CONTROL)): bool,
                    vol.Optional(CONF_THINKING_BUDGET, default=opts.get(CONF_THINKING_BUDGET, DEFAULT_THINKING_BUDGET)): int,
                }
            ),
        )
