"""Constants for Home LLM integration."""

DOMAIN = "home_llm"

CONF_API_KEY = "api_key"
CONF_PERSONA = "persona"
CONF_QDRANT_URL = "qdrant_url"
CONF_EMBED_URL = "embed_url"
CONF_RETENTION_MINUTES = "retention_minutes"
CONF_TOP_K = "top_k"
CONF_LLM_URL = "llm_url"
CONF_LLM_MODEL = "llm_model"

DEFAULT_PERSONA = ""
DEFAULT_QDRANT_URL = "http://localhost:6333"
DEFAULT_EMBED_URL = "http://localhost:8081"
DEFAULT_RETENTION_MINUTES = 15
DEFAULT_TOP_K = 3
DEFAULT_LLM_URL = "http://localhost:8080"
DEFAULT_LLM_MODEL = "Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M"

EMBEDDING_MODEL = "bge-m3"
QDRANT_COLLECTION = "memories_household"
EMBEDDING_DIM = 1024

MAX_HISTORY_MESSAGES = 20

CONF_OPENCLAW_URL = "openclaw_url"
CONF_OPENCLAW_API_KEY = "openclaw_api_key"
DEFAULT_OPENCLAW_URL = "http://localhost:18789"
DEFAULT_OPENCLAW_API_KEY = ""
OPENCLAW_INTENT_PREFIX = "OPENCLAW:"
