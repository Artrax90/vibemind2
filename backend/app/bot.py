import asyncio
import logging
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.client.session.aiohttp import AiohttpSession
from aiohttp_socks import ProxyConnector
import aiohttp

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

dp = Dispatcher()
bot_task = None
current_bot = None

@dp.message(Command("ask"))
async def handle_ask(message: types.Message):
    """Поиск по базе знаний (pgvector)"""
    query = message.text.replace("/ask", "").strip()
    if not query:
        await message.answer("Пожалуйста, напишите ваш вопрос после команды /ask")
        return
        
    # TODO: Здесь логика векторизации запроса через LLM и поиск в PostgreSQL (pgvector)
    await message.answer(f"🔍 Ищу ответ на вопрос: '{query}' в вашей базе знаний...")

@dp.message(F.voice)
async def handle_voice(message: types.Message):
    """Обработка голосовых сообщений (ffmpeg + Whisper)"""
    await message.answer("🎙 Голосовое сообщение получено. Запускаю транскрибацию через Whisper...")
    # TODO: 
    # 1. Скачать файл: await current_bot.download(message.voice, destination="temp.ogg")
    # 2. Конвертировать через ffmpeg (subprocess)
    # 3. Отправить в Whisper API (используя httpx с proxy_url)
    # 4. Сохранить текст как заметку в БД

@dp.message(F.text)
async def handle_text(message: types.Message):
    """Сохранение текстовых сообщений как .md заметок"""
    note_content = message.text
    # TODO: Сохранение note_content в PostgreSQL
    await message.answer("✅ Заметка успешно сохранена!")

async def start_bot(token: str, proxy_url: str = None, proxy_config: dict = None):
    """Запуск бота с поддержкой прокси (HTTP, SOCKS4, SOCKS5)"""
    global current_bot
    try:
        connector = None
        if proxy_config and proxy_config.get("host"):
            protocol = proxy_config.get("protocol", "http").lower()
            host = str(proxy_config.get("host"))
            # Sanitize host: remove any existing protocol prefix
            if "://" in host:
                host = host.split("://")[-1]
            
            if not host or host == "None":
                logger.error("Proxy host is empty after sanitization")
                return {"status": "error", "message": "Invalid proxy host"}

            port = proxy_config.get("port")
            user = proxy_config.get("username")
            password = proxy_config.get("password")
            
            if protocol in ["socks4", "socks5"]:
                proxy_url_socks = f"{protocol}://"
                if user and password:
                    proxy_url_socks += f"{user}:{password}@"
                proxy_url_socks += f"{host}"
                if port:
                    proxy_url_socks += f":{port}"
                connector = ProxyConnector.from_url(proxy_url_socks)
                session = AiohttpSession(connector=connector)
            else:
                # HTTP Proxy
                proxy_url_http = f"http://"
                if user and password:
                    proxy_url_http += f"{user}:{password}@"
                proxy_url_http += f"{host}"
                if port:
                    proxy_url_http += f":{port}"
                session = AiohttpSession(proxy=proxy_url_http)
        elif proxy_url:
            session = AiohttpSession(proxy=proxy_url)
        else:
            session = None
            
        current_bot = Bot(token=token, session=session)
        
        logger.info(f"Запуск Telegram бота... Прокси: {proxy_config or proxy_url}")
        await dp.start_polling(current_bot)
    except Exception as e:
        logger.error(f"Ошибка при запуске бота: {e}")
        current_bot = None

async def test_bot_connection(token: str, admin_id: str = None, proxy_url: str = None, proxy_config: dict = None):
    """Тестирование соединения бота и отправка сообщения"""
    try:
        connector = None
        protocol = "Direct"
        if proxy_config and proxy_config.get("host"):
            protocol = proxy_config.get("protocol", "http").upper()
            host = str(proxy_config.get("host"))
            # Sanitize host: remove any existing protocol prefix
            if "://" in host:
                host = host.split("://")[-1]
            
            if not host or host == "None":
                return {"status": "error", "detail": "Invalid proxy host"}

            port = proxy_config.get("port")
            user = proxy_config.get("username")
            password = proxy_config.get("password")
            
            if protocol.lower() in ["socks4", "socks5"]:
                proxy_url_socks = f"{protocol.lower()}://"
                if user and password:
                    proxy_url_socks += f"{user}:{password}@"
                proxy_url_socks += f"{host}"
                if port:
                    proxy_url_socks += f":{port}"
                connector = ProxyConnector.from_url(proxy_url_socks)
                session = AiohttpSession(connector=connector)
            else:
                proxy_url_http = f"http://"
                if user and password:
                    proxy_url_http += f"{user}:{password}@"
                proxy_url_http += f"{host}"
                if port:
                    proxy_url_http += f":{port}"
                session = AiohttpSession(proxy=proxy_url_http)
        elif proxy_url:
            protocol = "HTTP (Legacy)"
            session = AiohttpSession(proxy=proxy_url)
        else:
            session = None
            
        test_bot = Bot(token=token, session=session)
        me = await test_bot.get_me()
        
        # Send message to admin if ID is provided
        if admin_id:
            try:
                await test_bot.send_message(chat_id=admin_id, text=f"✅ VibeMind: Connection Successful! Protocol: {protocol}")
            except Exception as msg_err:
                logger.warning(f"Failed to send test message to admin {admin_id}: {msg_err}")
        
        await test_bot.session.close()
        return True, f"✅ VibeMind: Connection Successful! Protocol: {protocol}"
    except Exception as e:
        return False, f"❌ Connection Failed: {str(e)}"

async def stop_bot():
    """Остановка текущего инстанса бота"""
    global current_bot
    if current_bot:
        logger.info("Остановка Telegram бота...")
        await current_bot.session.close()
        current_bot = None

async def restart_bot(token: str, proxy_url: str = None, proxy_config: dict = None):
    """Динамический перезапуск бота (вызывается из FastAPI)"""
    global bot_task
    
    # Останавливаем текущего бота
    await stop_bot()
    
    # Отменяем текущую фоновую задачу
    if bot_task and not bot_task.done():
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass
            
    # Запускаем новую задачу, если передан токен
    if token:
        bot_task = asyncio.create_task(start_bot(token, proxy_url, proxy_config))
