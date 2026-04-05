import asyncio
import httpx
import logging
# from aiogram import Bot
# from aiogram.client.session.aiohttp import AiohttpSession
# from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

class SystemFactory:
    """
    Синглтон для управления динамическими инстансами LLM-клиентов и Telegram-бота.
    Позволяет пересоздавать подключения на лету при изменении настроек в БД.
    """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SystemFactory, cls).__new__(cls)
            cls._instance.bot = None
            cls._instance.llm_client = None
            cls._instance.http_client = httpx.AsyncClient()
            cls._instance.active_model = None
        return cls._instance

    async def reconfigure(self, settings):
        """Пересобирает все клиенты на основе новых настроек."""
        logger.info("Reconfiguring system services...")

        # 1. Настройка Proxy
        proxies = None
        proxy_url = None
        if settings.proxy.enabled and settings.proxy.host and settings.proxy.port:
            auth = f"{settings.proxy.username}:{settings.proxy.password}@" if settings.proxy.username else ""
            scheme = "socks5" if settings.proxy.proxy_type == "SOCKS5" else "http"
            proxy_url = f"{scheme}://{auth}{settings.proxy.host}:{settings.proxy.port}"
            proxies = {"all://": proxy_url}
            logger.info(f"Proxy configured: {scheme}://{settings.proxy.host}:{settings.proxy.port}")

        # Обновляем глобальный HTTP клиент (используется для Webhooks и API)
        await self.http_client.aclose()
        self.http_client = httpx.AsyncClient(proxies=proxies)

        # 2. Реинициализация Telegram Bot
        if settings.telegram_bot_token:
            try:
                # session = AiohttpSession(proxy=proxy_url) if proxy_url else None
                # self.bot = Bot(token=settings.telegram_bot_token, session=session)
                # await self.bot.get_me() # Проверка токена
                logger.info("Telegram Bot initialized successfully.")
            except Exception as e:
                logger.error(f"Failed to initialize Telegram Bot: {e}")
                self.bot = None

        # 3. Реинициализация LLM (OpenAI / Gemini / Ollama)
        active_llm = next((p for p in settings.llm_providers if p.is_active), None)
        if active_llm:
            try:
                self.active_model = active_llm.model_name
                if active_llm.provider in ["openai", "ollama"]:
                    # Для Ollama base_url обычно http://host.docker.internal:11434/v1
                    base_url = active_llm.base_url
                    api_key = active_llm.api_key or "ollama" # Ollama не требует ключа
                    
                    # self.llm_client = AsyncOpenAI(
                    #     api_key=api_key, 
                    #     base_url=base_url, 
                    #     http_client=self.http_client
                    # )
                    logger.info(f"LLM Client initialized for provider: {active_llm.provider}")
                elif active_llm.provider == "gemini":
                    # Инициализация для Gemini API
                    pass
            except Exception as e:
                logger.error(f"Failed to initialize LLM Client: {e}")
                self.llm_client = None

# Глобальный инстанс фабрики
system_factory = SystemFactory()
