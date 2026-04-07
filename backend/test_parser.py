import re
import json

def parse_commands(text: str) -> list[dict]:
    text = text.lower()
    
    # Нормализация
    text = re.sub(r'\bдобавив\b', 'добавь', text)
    text = re.sub(r'\bдобавить\b', 'добавь', text)
    
    stop_words = ["пожалуйста", "мне", "сделай", "хочу", "можешь"]
    for word in stop_words:
        text = re.sub(rf'\b{word}\b', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    commands = []
    
    # Проверяем конструкцию CREATE + UPDATE
    create_update_match = re.search(r'^(создай.*?|создать.*?|новая заметка.*?)\s+(?:и\s+)?(добавь\s+.*)$', text)
    if create_update_match:
        parts = [create_update_match.group(1), create_update_match.group(2)]
    else:
        parts = [text]
        
    for i, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
            
        if part.startswith("создай") or part.startswith("создать") or part.startswith("новая заметка"):
            title = re.sub(r'\b(создай|создать|новую|новая|заметку|заметка)\b', '', part).strip()
            title = re.sub(r'\s+', ' ', title).strip()
            commands.append({
                "type": "CREATE",
                "title": title
            })
        elif part.startswith("добавь"):
            if i > 0 and commands and commands[-1]["type"] == "CREATE":
                append_text = re.sub(r'^добавь\s+(туда|в не[её]|в эту заметку|в заметку|в)\s*', '', part).strip()
                if append_text == part:
                    append_text = re.sub(r'^добавь\s+', '', part).strip()
                commands.append({
                    "type": "UPDATE",
                    "append": append_text
                })
            else:
                cleaned = re.sub(r'^добавь\s+(в заметку|в не[её]|туда|в)\s*', '', part).strip()
                if cleaned == part:
                    cleaned = re.sub(r'^добавь\s+', '', part).strip()
                
                subparts = cleaned.split(maxsplit=1)
                if len(subparts) == 2:
                    commands.append({
                        "type": "UPDATE",
                        "search_query": subparts[0],
                        "append": subparts[1]
                    })
                else:
                    commands.append({
                        "type": "UPDATE",
                        "search_query": cleaned,
                        "append": cleaned
                    })
        elif part.startswith("найди") or part.startswith("покажи") or part.startswith("что есть про"):
            query = re.sub(r'^(найди заметку про|найди заметку|найди|покажи|что есть про)\s*', '', part).strip()
            commands.append({
                "type": "SEARCH",
                "query": query
            })
        else:
            commands.append({
                "type": "SEARCH",
                "query": part
            })
            
    return commands

print(json.dumps(parse_commands("создай заметку фильмы"), ensure_ascii=False, indent=2))
print(json.dumps(parse_commands("добавь в заметку фильмы интерстеллар"), ensure_ascii=False, indent=2))
print(json.dumps(parse_commands("создай заметку фильмы и добавь туда интерстеллар"), ensure_ascii=False, indent=2))
print(json.dumps(parse_commands("найди заметку про фильмы"), ensure_ascii=False, indent=2))
