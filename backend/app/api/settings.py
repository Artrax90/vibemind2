from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, HttpUrl
from typing import List, Optional
from sqlalchemy.orm import Session
import json

# Предполагается, что у вас есть зависимость get_db и модель Config
# from app.db.session import get_db
# from app.models.config import SystemConfig
# from app.core.factory import system_factory

router = APIRouter(prefix="/api/settings", tags=["settings"])

class ProxyConfig(BaseModel):
    enabled: bool = False
    proxy_type: str = Field("HTTP", pattern="^(HTTP|SOCKS5)$")
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None

class LLMProvider(BaseModel):
    provider: str = Field(..., pattern="^(openai|gemini|ollama)$")
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: str
    is_active: bool = False

class SystemSettingsSchema(BaseModel):
    telegram_bot_token: Optional[str] = None
    llm_providers: List[LLMProvider] = []
    proxy: ProxyConfig = ProxyConfig()
    webhook_url: Optional[str] = None

# Заглушка для зависимости БД
def get_db():
    yield None

@router.get("/", response_model=SystemSettingsSchema)
async def get_settings(db: Session = Depends(get_db)):
    """Получить текущие настройки системы из БД."""
    # В реальном приложении:
    # config_record = db.query(SystemConfig).first()
    # if not config_record:
    #     return SystemSettingsSchema()
    # return SystemSettingsSchema.parse_raw(config_record.data)
    
    # Возвращаем дефолтные настройки для примера
    return SystemSettingsSchema()

@router.post("/")
async def update_settings(settings: SystemSettingsSchema, db: Session = Depends(get_db)):
    """Обновить настройки системы, сохранить в БД и перезапустить сервисы."""
    
    # 1. Сохранение в PostgreSQL (таблица configs)
    # config_record = db.query(SystemConfig).first()
    # if not config_record:
    #     config_record = SystemConfig(data=settings.json())
    #     db.add(config_record)
    # else:
    #     config_record.data = settings.json()
    # db.commit()
    
    # 2. Динамическая реинициализация фабрики (LLM и Telegram Bot)
    from app.core.factory import system_factory
    try:
        await system_factory.reconfigure(settings)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Настройки сохранены, но ошибка при запуске сервисов: {str(e)}"
        )
        
    return {"status": "success", "message": "Settings updated and services reloaded"}
