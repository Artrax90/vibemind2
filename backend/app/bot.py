import asyncio
import logging
import traceback
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
        session = None
        
        # 1. Determine proxy URL string
        final_proxy_url = None
        connector = None
        
        # Check proxy_config first (dictionary from UI)
        if proxy_config and proxy_config.get("host"):
            protocol = proxy_config.get("protocol", "http").lower()
            host = str(proxy_config.get("host"))
            if "://" in host:
                host = host.split("://")[-1]
            
            if host and host != "None":
                port = proxy_config.get("port")
                user = proxy_config.get("username")
                password = proxy_config.get("password")
                
                auth = f"{user}:{password}@" if user and password else ""
                port_str = f":{port}" if port else ""
                
                if protocol in ["socks4", "socks5"]:
                    socks_url = f"{protocol}://{auth}{host}{port_str}"
                    connector = ProxyConnector.from_url(socks_url, rdns=True)
                else:
                    final_proxy_url = f"http://{auth}{host}{port_str}"
        
        # Fallback to legacy proxy_url string if it's actually a string
        if not final_proxy_url and not connector and proxy_url and isinstance(proxy_url, str):
            final_proxy_url = proxy_url

        # 2. Create session
        if connector:
            session = AiohttpSession(connector=connector)
        elif final_proxy_url:
            session = AiohttpSession(proxy=final_proxy_url)
        else:
            session = None
            
        current_bot = Bot(token=token, session=session)
        
        logger.info(f"Запуск Telegram бота... Прокси: {final_proxy_url or 'Direct'}")
        await dp.start_polling(current_bot)
    except Exception as e:
        logger.error(f"Ошибка при запуске бота: {e}")
        current_bot = None

async def test_bot_connection(token: str, admin_id: str = None, proxy_url: str = None, proxy_config: dict = None):
    """Тестирование соединения бота и отправка сообщения"""
    print(f"DEBUG PROXY URL: '{proxy_url}'")
    print(f"DEBUG PROXY CONFIG: {proxy_config}")
    
    session = None
    final_proxy_url = None
    connector = None
    protocol_name = "Direct"
    host = "unknown"
    port = "unknown"
    
    try:
        # 1. Determine proxy URL string
        if proxy_config and proxy_config.get("host"):
            protocol = proxy_config.get("protocol", "http").lower()
            host = str(proxy_config.get("host"))
            if "://" in host:
                host = host.split("://")[-1]
            
            if host and host != "None":
                port = proxy_config.get("port")
                user = proxy_config.get("username")
                password = proxy_config.get("password")
                
                auth = f"{user}:{password}@" if user and password else ""
                port_str = f":{port}" if port else ""
                
                if protocol in ["socks4", "socks5"]:
                    socks_url = f"{protocol}://{auth}{host}{port_str}"
                    connector = ProxyConnector.from_url(socks_url, rdns=True)
                    protocol_name = protocol.upper()
                else:
                    final_proxy_url = f"http://{auth}{host}{port_str}"
                    protocol_name = "HTTP"
        
        # Fallback to legacy proxy_url string if it's actually a string
        if not final_proxy_url and not connector and proxy_url and isinstance(proxy_url, str):
            final_proxy_url = proxy_url
            protocol_name = "HTTP (Legacy)"

        # 2. Create session and test
        async with aiohttp.ClientSession(connector=connector) as client_session:
            session = AiohttpSession(session=client_session)
            if final_proxy_url:
                session.proxy = final_proxy_url
                
            test_bot = Bot(token=token, session=session)
            
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
                # Bot session is managed by ClientSession context manager above
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
