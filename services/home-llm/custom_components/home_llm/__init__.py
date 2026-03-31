"""Home LLM - Local LLM conversation agent for Home Assistant."""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import (
    CONF_AGENT_ID,
    CONF_OPENCLAW_URL,
    CONF_OPENCLAW_API_KEY,
    DEFAULT_AGENT_ID,
    DEFAULT_OPENCLAW_URL,
    DEFAULT_OPENCLAW_API_KEY,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.CONVERSATION]


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate config entry to new version."""
    if entry.version < 4:
        _LOGGER.info("Migrating home_llm config entry from version %s to 4", entry.version)
        new_options = {**entry.options}
        new_options.setdefault(CONF_OPENCLAW_URL, DEFAULT_OPENCLAW_URL)
        new_options.setdefault(CONF_OPENCLAW_API_KEY, DEFAULT_OPENCLAW_API_KEY)
        hass.config_entries.async_update_entry(entry, options=new_options, version=4)
    if entry.version < 5:
        _LOGGER.info("Migrating home_llm config entry from version %s to 5", entry.version)
        new_options = {**entry.options}
        new_options.setdefault(CONF_AGENT_ID, DEFAULT_AGENT_ID)
        hass.config_entries.async_update_entry(entry, options=new_options, version=5)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Home LLM from a config entry."""
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle options update."""
    await hass.config_entries.async_reload(entry.entry_id)
