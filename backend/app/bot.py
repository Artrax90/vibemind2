import asyncio
import logging
import traceback
import ast
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
    # 3. Отправить в Whisper API (используя httpx with proxy_url)
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

    # Унифицируй входные данные
    if isinstance(proxy_url, str) and proxy_url.strip().startswith("{"):
        try:
            proxy_url = ast.literal_eval(proxy_url)
        except:
            pass

    try:
        session = None
        final_proxy_url = None
        
        # Приоритет 1: proxy_url как готовая строка
        if isinstance(proxy_url, str) and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
            final_proxy_url = proxy_url
        # Приоритет 2: proxy_url как словарь
        elif isinstance(proxy_url, dict) and proxy_url.get("host"):
            p = proxy_url
            protocol = str(p.get("protocol", "http")).lower()
            host = str(p.get("host"))
            port = p.get("port")
            user = p.get("username")
            password = p.get("password")
            if user and password:
                final_proxy_url = f"{protocol}://{user}:{password}@{host}:{port}"
            else:
                final_proxy_url = f"{protocol}://{host}:{port}"
        # Приоритет 3: proxy_config как словарь
        elif isinstance(proxy_config, dict) and proxy_config.get("host"):
            p = proxy_config
            protocol = str(p.get("protocol", "http")).lower()
            host = str(p.get("host"))
            port = p.get("port")
            user = p.get("username")
            password = p.get("password")
            if user and password:
                final_proxy_url = f"{protocol}://{user}:{password}@{host}:{port}"
            else:
                final_proxy_url = f"{protocol}://{host}:{port}"

        logger.debug(f"Final Proxy URL for start_bot: {final_proxy_url}")

        # 2. Create session
        session = AiohttpSession(proxy=final_proxy_url) if final_proxy_url else AiohttpSession()
            
        async with Bot(token=token, session=session) as bot:
            current_bot = bot
            logger.info(f"Запуск Telegram бота... Прокси: {final_proxy_url or 'Direct'}")
            await dp.start_polling(bot)
    except Exception as e:
        logger.error(f"Ошибка при запуске бота: {e}")
        current_bot = None

async def test_bot_connection(token: str, admin_id: str = None, proxy_url: str = None, proxy_config: dict = None):
    """Тестирование соединения бота и отправка сообщения"""
    # Унифицируй входные данные
    if isinstance(proxy_url, str) and proxy_url.strip().startswith("{"):
        try:
            proxy_url = ast.literal_eval(proxy_url)
        except:
            pass

    session = None
    final_proxy_url = None
    protocol_name = "Direct"
    host = "unknown"
    port = "unknown"
    
    # Приоритет 1: proxy_url как готовая строка
    if isinstance(proxy_url, str) and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
        final_proxy_url = proxy_url
        protocol_name = proxy_url.split("://")[0].upper() if "://" in proxy_url else "Proxy"
    # Приоритет 2: proxy_url как словарь
    elif isinstance(proxy_url, dict) and proxy_url.get("host"):
        p = proxy_url
        protocol = str(p.get("protocol", "http")).lower()
        host = str(p.get("host"))
        port = p.get("port")
        user = p.get("username")
        password = p.get("password")
        if user and password:
            final_proxy_url = f"{protocol}://{user}:{password}@{host}:{port}"
        else:
            final_proxy_url = f"{protocol}://{host}:{port}"
        protocol_name = protocol.upper()
    # Приоритет 3: proxy_config как словарь
    elif isinstance(proxy_config, dict) and proxy_config.get("host"):
        p = proxy_config
        protocol = str(p.get("protocol", "http")).lower()
        host = str(p.get("host"))
        port = p.get("port")
        user = p.get("username")
        password = p.get("password")
        if user and password:
            final_proxy_url = f"{protocol}://{user}:{password}@{host}:{port}"
        else:
            final_proxy_url = f"{protocol}://{host}:{port}"
        protocol_name = protocol.upper()

    logger.debug(f"Final Proxy URL: {final_proxy_url}")

    try:
        # 2. Create session and test
        session = AiohttpSession(proxy=final_proxy_url) if final_proxy_url else AiohttpSession()
            
        async with Bot(token=token, session=session) as test_bot:
            try:
                # Use a longer timeout for get_me as proxies can be slow
                me = await asyncio.wait_for(test_bot.get_me(), timeout=30.0)
                
                # Send message to admin if ID is provided
                if admin_id:
                    try:
                        await test_bot.send_message(chat_id=admin_id, text=f"✅ VibeMind: Connection Successful! Protocol: {protocol_name}")
                    except Exception as msg_err:
                        logger.warning(f"Failed to send test message to admin {admin_id}: {msg_err}")
                
                return True, f"✅ VibeMind: Connection Successful! Protocol: {protocol_name}"
                
            except asyncio.TimeoutError:
                error_msg = f"Тайм-аут при попытке подключения через прокси: {host}:{port}"
                print(f"[DEBUG] {error_msg}")
                return False, "TIMEOUT_ERROR: ❌ Превышено время ожидания. Прокси недоступен или блокирует Telegram."
            finally:
                # Bot session is managed by async with context manager
                pass
            
    except Exception as e:
        print(f"DEBUG ERROR: {str(e)}")
        traceback.print_exc()
        return False, f"❌ Connection Failed: {str(e)}"
    finally:
        if session:
            await session.close()

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
