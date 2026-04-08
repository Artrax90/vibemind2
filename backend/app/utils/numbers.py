import re

def words_to_digits(text: str) -> str:
    """
    Converts Russian number words to digits in a string.
    Example: "двадцать пять" -> "25"
    """
    if not text:
        return text

    units = {
        "ноль": 0, "один": 1, "одна": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9,
        "десять": 10, "одиннадцать": 11, "двенадцать": 12, "тринадцать": 13, "четырнадцать": 14, "пятнадцать": 15, "шестнадцать": 16, "семнадцать": 17, "восемнадцать": 18, "девятнадцать": 19
    }
    tens = {
        "двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50, "шестьдесят": 60, "семьдесят": 70, "восемьдесят": 80, "девяносто": 90
    }
    hundreds = {
        "сто": 100, "двести": 200, "триста": 300, "четыреста": 400, "пятьсот": 500, "шестьсот": 600, "семьсот": 700, "восемьсот": 800, "девятьсот": 900
    }
    thousands = {
        "тысяча": 1000, "тысячи": 1000, "тысяч": 1000
    }

    # Combine all words for easier matching
    all_num_words = list(units.keys()) + list(tens.keys()) + list(hundreds.keys()) + list(thousands.keys())
    
    # Regex to find sequences of number words
    pattern = r'\b(' + '|'.join(all_num_words) + r')\b'
    
    def replace_match(match):
        # This is a bit complex because we need to handle sequences like "одна тысяча триста пять"
        return match.group(0)

    # We'll use a more manual approach to find sequences
    words = text.split()
    new_words = []
    i = 0
    while i < len(words):
        word = words[i].lower().strip(".,!?")
        if word in all_num_words:
            # Start of a potential number sequence
            current_val = 0
            temp_val = 0
            found_num = False
            
            j = i
            while j < len(words):
                w = words[j].lower().strip(".,!?")
                if w in units:
                    temp_val += units[w]
                    found_num = True
                elif w in tens:
                    temp_val += tens[w]
                    found_num = True
                elif w in hundreds:
                    temp_val += hundreds[w]
                    found_num = True
                elif w in thousands:
                    if temp_val == 0: temp_val = 1
                    current_val += temp_val * 1000
                    temp_val = 0
                    found_num = True
                else:
                    break
                j += 1
            
            if found_num:
                current_val += temp_val
                new_words.append(str(current_val))
                i = j
                continue
        
        new_words.append(words[i])
        i += 1
        
    return " ".join(new_words)
