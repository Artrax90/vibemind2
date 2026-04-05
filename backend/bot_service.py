import os
import asyncio
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart, Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
import pytesseract
from PIL import Image
import io

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

bot = Bot(token=TELEGRAM_BOT_TOKEN) if TELEGRAM_BOT_TOKEN else None
dp = Dispatcher()

def get_note_keyboard(note_id: str):
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="Edit in Web", url=f"https://vibemind.local/note/{note_id}"),
            InlineKeyboardButton(text="Summarize", callback_data=f"summarize_{note_id}"),
            InlineKeyboardButton(text="Delete", callback_data=f"delete_{note_id}")
        ]
    ])

@dp.message(CommandStart())
async def send_welcome(message: types.Message):
    await message.reply("Welcome to VibeMind Bot! Use /ask to query your notes.")

@dp.message(Command("ask"))
async def ask_notes(message: types.Message):
    query = message.text.replace("/ask", "").strip()
    if not query:
        await message.reply("Please provide a query. Example: /ask what is my project about?")
        return
    
    await message.reply(f"Searching your notes for: {query}...\n(RAG integration placeholder)")

@dp.message(F.photo)
async def handle_photo(message: types.Message):
    if not bot: return
    await message.reply("Image received. Running OCR...")
    
    # Download photo
    photo = message.photo[-1]
    file = await bot.get_file(photo.file_id)
    file_bytes = await bot.download_file(file.file_path)
    
    # Run OCR
    try:
        image = Image.open(io.BytesIO(file_bytes.read()))
        extracted_text = pytesseract.image_to_string(image)
        
        if extracted_text.strip():
            reply_text = f"Extracted Text:\n\n{extracted_text[:500]}..."
            await message.reply(reply_text, reply_markup=get_note_keyboard("new_ocr_note"))
        else:
            await message.reply("No text could be extracted from the image.")
    except Exception as e:
        await message.reply(f"OCR failed: {str(e)}")

@dp.message(F.voice)
async def handle_voice(message: types.Message):
    await message.reply("Voice message received. Transcribing...")
    # ffmpeg + Whisper API logic here

async def main():
    if bot:
        await dp.start_polling(bot)
    else:
        print("TELEGRAM_BOT_TOKEN not set. Bot will not start.")

if __name__ == "__main__":
    asyncio.run(main())
