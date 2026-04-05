import os
from openai import AsyncOpenAI

# 1. UNIVERSAL LLM ARCHITECTURE
async def get_ai_response(provider_url: str, api_key: str, model_name: str, prompt: str):
    """
    Generic OpenAI client that points to the Base URL provided in the settings.
    This automatically makes VibeMind compatible with 99% of current AI services.
    """
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=provider_url
    )
    response = await client.chat.completions.create(
        model=model_name,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content
