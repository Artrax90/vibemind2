import os
from cryptography.fernet import Fernet

# В реальном приложении ENCRYPTION_KEY должен быть сгенерирован (Fernet.generate_key()) 
# и сохранен в .env файле.
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")

# Fallback для разработки, если ключ не задан
if not ENCRYPTION_KEY or len(ENCRYPTION_KEY) < 32:
    _fallback = Fernet.generate_key()
    cipher_suite = Fernet(_fallback)
else:
    cipher_suite = Fernet(ENCRYPTION_KEY.encode())

def encrypt_api_key(api_key: str) -> str:
    """Шифрует API ключ для безопасного хранения в БД."""
    if not api_key:
        return ""
    return cipher_suite.encrypt(api_key.encode()).decode()

def decrypt_api_key(encrypted_key: str) -> str:
    """Расшифровывает API ключ из БД."""
    if not encrypted_key:
        return ""
    try:
        return cipher_suite.decrypt(encrypted_key.encode()).decode()
    except Exception as e:
        # Здесь будет использоваться loguru для логирования ошибки
        print(f"Ошибка расшифровки ключа: {e}")
        return ""
