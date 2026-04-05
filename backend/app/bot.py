import asyncio
import logging
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.client.session.aiohttp import AiohttpSession

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

async def start_bot(token: str, proxy_url: str = None):
    """Запуск бота с поддержкой прокси"""
    global current_bot
    try:
        # Настраиваем прокси для aiogram через AiohttpSession
        session = AiohttpSession(proxy=proxy_url) if proxy_url else None
        current_bot = Bot(token=token, session=session)
        
        logger.info(f"Запуск Telegram бота... Прокси: {proxy_url}")
        await dp.start_polling(current_bot)
    except Exception as e:
        logger.error(f"Ошибка при запуске бота: {e}")
        current_bot = None

async def stop_bot():
    """Остановка текущего инстанса бота"""
    global current_bot
    if current_bot:
        logger.info("Остановка Telegram бота...")
        await current_bot.session.close()
        current_bot = None

async def restart_bot(token: str, proxy_url: str = None):
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
        bot_task = asyncio.create_task(start_bot(token, proxy_url))
