//! FTS5 で日本語を引くための bigram 化。
//!
//! SQLite 3.46 には `trigram` トークナイザがあるが、3文字未満のクエリを
//! 原理的にマッチできない。日本語の検索語は「会議」「体調」のような2文字が
//! 多く、この制約は日誌検索には致命的なので採用していない。
//!
//! 代わりに、格納時と検索時の両方でこのモジュールを通し、CJK の連続を
//! 隣接2文字のトークン列に展開してから `unicode61` に索引させる。
//! 例: `会議室` → `会議 議室`。検索語も同じ変換を通してフレーズ検索にすれば、
//! 部分文字列一致と同じ結果が得られる。

/// 索引用: 原文を空白区切りのトークン列へ変換する。
pub fn bigramize(text: &str) -> String {
    let mut tokens = Vec::new();
    for run in runs(text) {
        match run {
            Run::Ascii(word) => tokens.push(word),
            Run::Wide(chars) => tokens.extend(wide_bigrams(&chars)),
        }
    }
    tokens.join(" ")
}

/// 検索用: ユーザー入力を FTS5 の MATCH 式へ変換する。
///
/// 空白区切りは AND、`OR` で OR、先頭の `-` で除外。`"..."` で囲むと
/// ひとつの語として扱う。FTS5 の特殊文字は [`runs`] の段階で区切りとして
/// 落ちるため、ユーザー入力が原因で MATCH の構文エラーになることはない。
pub fn build_match_expression(input: &str) -> Option<String> {
    let mut includes: Vec<String> = Vec::new();
    // includes[i] を前の語に繋ぐ演算子。長さは includes.len().saturating_sub(1)。
    let mut joiners: Vec<&'static str> = Vec::new();
    let mut excludes: Vec<String> = Vec::new();
    let mut next_joiner = "AND";

    for term in split_terms(input) {
        if term.eq_ignore_ascii_case("or") {
            // 次の語を OR で繋ぐ。先頭にある OR は意味がないので捨てる。
            if !includes.is_empty() {
                next_joiner = "OR";
            }
            continue;
        }
        let (negated, body) = match term.strip_prefix('-') {
            Some(rest) => (true, rest.to_string()),
            None => (false, term),
        };
        let Some(expression) = term_expression(&body) else {
            continue;
        };
        if negated {
            excludes.push(expression);
        } else {
            if !includes.is_empty() {
                joiners.push(next_joiner);
            }
            includes.push(expression);
            next_joiner = "AND";
        }
    }

    if includes.is_empty() {
        // 除外だけでは検索できない（FTS5 の NOT は二項演算子）。
        return None;
    }
    let mut expression = includes[0].clone();
    for (joiner, term) in joiners.iter().zip(includes.iter().skip(1)) {
        expression = format!("{expression} {joiner} {term}");
    }
    if !excludes.is_empty() {
        expression = format!("({expression}) NOT ({})", excludes.join(" OR "));
    }
    Some(expression)
}

/// ひとつの検索語を FTS5 の式にする。
fn term_expression(term: &str) -> Option<String> {
    let tokens: Vec<String> = runs(term)
        .into_iter()
        .flat_map(|run| match run {
            Run::Ascii(word) => vec![word],
            Run::Wide(chars) => wide_bigrams(&chars),
        })
        .collect();
    match tokens.len() {
        0 => None,
        // 1トークン（英数1語、CJK 1〜2文字）は前方一致にする。
        // CJK 1文字は索引側では bigram の先頭にしか現れないため、
        // 前方一致にしないと「会」で「会議」を引けない。
        1 => Some(format!("\"{}\"*", tokens[0])),
        // 複数トークンは順序どおり並ぶことを要求するフレーズ検索。
        // これが原文での部分文字列一致と等価になる。
        _ => Some(format!("\"{}\"", tokens.join(" "))),
    }
}

enum Run {
    /// ASCII 英数の連なり。小文字化済みで、そのまま1トークンになる。
    Ascii(String),
    /// CJK・かななど非 ASCII の文字の連なり。bigram に展開する。
    Wide(Vec<char>),
}

/// 文字列を「ASCII 英数の語」と「非 ASCII の語」に切り分ける。
/// どちらにも当てはまらない文字（記号・空白・Markdown 記法）は区切りとして捨てる。
fn runs(text: &str) -> Vec<Run> {
    let mut result = Vec::new();
    let mut ascii = String::new();
    let mut wide: Vec<char> = Vec::new();
    for character in text.chars() {
        if character.is_ascii_alphanumeric() || character == '_' {
            if !wide.is_empty() {
                result.push(Run::Wide(std::mem::take(&mut wide)));
            }
            ascii.push(character.to_ascii_lowercase());
        } else if !character.is_ascii() && character.is_alphanumeric() {
            if !ascii.is_empty() {
                result.push(Run::Ascii(std::mem::take(&mut ascii)));
            }
            wide.push(character);
        } else {
            if !ascii.is_empty() {
                result.push(Run::Ascii(std::mem::take(&mut ascii)));
            }
            if !wide.is_empty() {
                result.push(Run::Wide(std::mem::take(&mut wide)));
            }
        }
    }
    if !ascii.is_empty() {
        result.push(Run::Ascii(ascii));
    }
    if !wide.is_empty() {
        result.push(Run::Wide(wide));
    }
    result
}

/// 非 ASCII の文字列を隣接2文字ずつに展開する。1文字ならその1文字。
fn wide_bigrams(chars: &[char]) -> Vec<String> {
    if chars.len() == 1 {
        return vec![chars[0].to_string()];
    }
    chars
        .windows(2)
        .map(|pair| pair.iter().collect::<String>())
        .collect()
}

/// 入力を検索語に割る。`"..."` の中は空白を含めてひとつの語。
fn split_terms(input: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for character in input.chars() {
        match character {
            '"' => {
                quoted = !quoted;
                if !quoted && !current.is_empty() {
                    terms.push(std::mem::take(&mut current));
                }
            }
            // is_whitespace() は全角スペース(U+3000)も含む。
            c if !quoted && c.is_whitespace() => {
                if !current.is_empty() {
                    terms.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        terms.push(current);
    }
    terms
}

/// 検索結果に出す抜粋を原文から切り出す。
///
/// FTS5 の `snippet()` は bigram 化した列に対して働くので「会議 議室」のような
/// 壊れた文字列が返る。そのため抜粋は原文から自前で作る。
pub fn excerpt(content: &str, needles: &[String], radius: usize) -> String {
    let lowered = content.to_lowercase();
    let hit = needles
        .iter()
        .filter(|needle| !needle.is_empty())
        .filter_map(|needle| lowered.find(&needle.to_lowercase()))
        .min();
    let Some(hit) = hit else {
        return head(content, radius * 2);
    };
    // マッチ位置の前後 radius 文字を、文字境界を壊さないように切り出す。
    let start = floor_char_boundary(content, hit.saturating_sub(radius * 3));
    let start = align_back(content, start, hit, radius);
    let end = align_forward(content, hit, radius * 2);
    let mut excerpt = String::new();
    if start > 0 {
        excerpt.push('…');
    }
    excerpt.push_str(&content[start..end]);
    if end < content.len() {
        excerpt.push('…');
    }
    excerpt
}

fn head(content: &str, chars: usize) -> String {
    let end = align_forward(content, 0, chars);
    if end < content.len() {
        format!("{}…", &content[..end])
    } else {
        content.to_string()
    }
}

/// `from` から最大 `chars` 文字ぶん進んだバイト位置。
fn align_forward(content: &str, from: usize, chars: usize) -> usize {
    content[from..]
        .char_indices()
        .nth(chars)
        .map(|(offset, _)| from + offset)
        .unwrap_or(content.len())
}

/// `target` から最大 `chars` 文字ぶん戻ったバイト位置。
fn align_back(content: &str, lower: usize, target: usize, chars: usize) -> usize {
    let mut boundaries: Vec<usize> = content[lower..target]
        .char_indices()
        .map(|(offset, _)| lower + offset)
        .collect();
    boundaries.push(target);
    let index = boundaries.len().saturating_sub(chars + 1);
    boundaries[index]
}

fn floor_char_boundary(content: &str, mut index: usize) -> usize {
    if index >= content.len() {
        return content.len();
    }
    while !content.is_char_boundary(index) {
        index -= 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_japanese_into_overlapping_bigrams() {
        assert_eq!(bigramize("会議室"), "会議 議室");
        assert_eq!(bigramize("あ"), "あ");
        assert_eq!(bigramize(""), "");
    }

    #[test]
    fn keeps_ascii_words_whole_and_lowercased() {
        assert_eq!(bigramize("Rust入門"), "rust 入門");
        assert_eq!(bigramize("API v2"), "api v2");
    }

    #[test]
    fn drops_punctuation_and_markdown_syntax() {
        assert_eq!(bigramize("## 見出し, [link](url)"), "見出 出し link url");
    }

    #[test]
    fn handles_characters_outside_the_basic_plane() {
        // サロゲートペアになる漢字でも panic しない。
        assert_eq!(bigramize("𠮷野家"), "𠮷野 野家");
    }

    #[test]
    fn builds_a_phrase_for_multi_character_japanese() {
        assert_eq!(build_match_expression("会議室").unwrap(), "\"会議 議室\"");
    }

    #[test]
    fn joins_multiple_terms_with_and() {
        // 2文字の語は bigram が1つなので、1トークン＝前方一致の形になる。
        assert_eq!(
            build_match_expression("会議 資料").unwrap(),
            "\"会議\"* AND \"資料\"*"
        );
    }

    #[test]
    fn uses_a_prefix_match_for_a_single_character() {
        // 「会」だけでは索引の bigram に一致しないので前方一致にする。
        assert_eq!(build_match_expression("会").unwrap(), "\"会\"*");
        assert_eq!(build_match_expression("rust").unwrap(), "\"rust\"*");
    }

    #[test]
    fn supports_or_and_exclusion() {
        assert_eq!(
            build_match_expression("会議 OR 打合せ").unwrap(),
            "\"会議\"* OR \"打合 合せ\""
        );
        assert_eq!(
            build_match_expression("会議 -資料").unwrap(),
            "(\"会議\"*) NOT (\"資料\"*)"
        );
    }

    #[test]
    fn treats_a_quoted_run_as_one_term() {
        // 空白は索引側でも区切りなので bigram は跨がない。
        // 「会議」の直後に「資料」が来ることを求めるフレーズになる。
        assert_eq!(
            build_match_expression("\"会議 資料\"").unwrap(),
            "\"会議 資料\""
        );
    }

    #[test]
    fn returns_none_when_nothing_searchable_remains() {
        assert!(build_match_expression("").is_none());
        assert!(build_match_expression("   ").is_none());
        // FTS5 の特殊文字だけでも構文エラーにならず None になる。
        assert!(build_match_expression("*").is_none());
        assert!(build_match_expression("(").is_none());
        assert!(build_match_expression("\"").is_none());
        // 除外だけでは検索できない。
        assert!(build_match_expression("-会議").is_none());
    }

    #[test]
    fn excerpt_centres_on_the_first_match() {
        let content = "朝は準備をして、昼から会議室で打ち合わせ、夕方は資料を作った。";
        let result = excerpt(content, &["会議".to_string()], 6);
        assert!(result.contains("会議室"), "抜粋: {result}");
    }

    #[test]
    fn excerpt_falls_back_to_the_head_without_a_match() {
        let content = "あいうえおかきくけこさしすせそ";
        let result = excerpt(content, &["存在しない".to_string()], 3);
        assert!(result.starts_with("あいうえおか"), "抜粋: {result}");
        assert!(result.ends_with('…'));
    }

    #[test]
    fn excerpt_never_splits_a_multibyte_character() {
        let content = "𠮷野家で牛丼を食べた𠮷野家で牛丼を食べた";
        for radius in 1..12 {
            let _ = excerpt(content, &["牛丼".to_string()], radius);
        }
    }

    #[test]
    fn excerpt_returns_short_content_untouched() {
        assert_eq!(excerpt("短い", &["無".to_string()], 20), "短い");
    }
}
