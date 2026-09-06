use crate::{database::Database, models::*, AppPaths};
use chrono::{DateTime, Datelike, NaiveDate, Weekday};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
};

const EMPTY: &str = "_記録なし_";
const ATTACHMENT_SCHEME: &str = "daylog-attachment:";

fn japanese_date(date: &str) -> Result<String, String> {
    let date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| "日付の形式が正しくありません".to_string())?;
    let weekday = match date.weekday() {
        Weekday::Mon => "月",
        Weekday::Tue => "火",
        Weekday::Wed => "水",
        Weekday::Thu => "木",
        Weekday::Fri => "金",
        Weekday::Sat => "土",
        Weekday::Sun => "日",
    };
    Ok(format!(
        "{:04}年{:02}月{:02}日({weekday})",
        date.year(),
        date.month(),
        date.day()
    ))
}

fn escape_inline(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| {
            if "\\`*_{}[]<>()#+-.!|>".contains(character) {
                vec!['\\', character]
            } else {
                vec![character]
            }
        })
        .collect()
}

fn escaped_lines(value: &str) -> String {
    value
        .lines()
        .map(escape_inline)
        .collect::<Vec<_>>()
        .join("  \n")
}

fn entry_time(value: &str) -> String {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.format("%H:%M").to_string())
        .unwrap_or_else(|_| "--:--".into())
}

fn attachment_ids(markdown: &str) -> HashSet<String> {
    markdown
        .match_indices(ATTACHMENT_SCHEME)
        .filter_map(|(start, _)| {
            let value = &markdown[start + ATTACHMENT_SCHEME.len()..];
            let id = value
                .chars()
                .take_while(|character| character.is_ascii_hexdigit() || *character == '-')
                .take(36)
                .collect::<String>();
            uuid::Uuid::parse_str(&id).ok().map(|_| id.to_lowercase())
        })
        .collect()
}

fn rewrite_attachment_links(markdown: &str, links: &HashMap<String, String>) -> String {
    let mut rewritten = markdown.to_string();
    for (id, link) in links {
        rewritten = rewritten.replace(&format!("{ATTACHMENT_SCHEME}{id}"), link);
    }
    rewritten
}

fn render_markdown(day: &DayData, links: &HashMap<String, String>) -> Result<String, String> {
    let mut output = format!("# {}\n\n## やること\n", japanese_date(&day.day_date)?);
    if day.tasks.is_empty() {
        output.push_str(EMPTY);
        output.push('\n');
    } else {
        for task in &day.tasks {
            let checked = if task.is_completed { "x" } else { " " };
            let carried = if task.carried_over {
                "（持ち越し）"
            } else {
                ""
            };
            output.push_str(&format!(
                "- [{checked}] {}{carried}\n",
                escape_inline(&task.title)
            ));
        }
    }

    output.push_str("\n## 記録\n");
    if day.entries.is_empty() {
        output.push_str(EMPTY);
        output.push('\n');
    } else {
        for entry in &day.entries {
            let tag = if entry.entry_type == "memo" {
                String::new()
            } else {
                format!(" `{}`", escape_inline(&entry.entry_type))
            };
            let body = entry
                .title
                .as_deref()
                .filter(|title| !title.trim().is_empty())
                .map(|title| {
                    format!(
                        "{}  \n{}",
                        escape_inline(title.trim()),
                        escaped_lines(&entry.body)
                    )
                })
                .unwrap_or_else(|| escaped_lines(&entry.body));
            output.push_str(&format!(
                "- {}{tag} {}\n",
                entry_time(&entry.occurred_at),
                body
            ));
        }
    }

    output.push_str("\n## メモ\n");
    if day.notes.is_empty() {
        output.push_str(EMPTY);
        output.push('\n');
    } else {
        for (index, note) in day.notes.iter().enumerate() {
            if index > 0 {
                output.push('\n');
            }
            let title = if note.title.trim().is_empty() {
                "無題のメモ".into()
            } else {
                escape_inline(note.title.trim())
            };
            output.push_str(&format!("### {title}\n"));
            if note.markdown.trim().is_empty() {
                output.push_str(EMPTY);
                output.push('\n');
            } else {
                let markdown = rewrite_attachment_links(&note.markdown, links);
                output.push_str(markdown.trim_end());
                output.push('\n');
            }
        }
    }

    output.push_str("\n## 振り返り\n");
    for (heading, value) in [
        ("今日よかったこと", &day.review.good),
        ("うまくいかなかったこと", &day.review.bad),
        ("明日に持ち越すこと", &day.review.carry_over),
    ] {
        output.push_str(&format!("### {heading}\n"));
        if value.trim().is_empty() {
            output.push_str(EMPTY);
        } else {
            output.push_str(&escaped_lines(value.trim()));
        }
        output.push_str("\n\n");
    }
    Ok(output)
}

fn render_note_markdown(note: &NoteCard, links: &HashMap<String, String>) -> String {
    let title = if note.title.trim().is_empty() {
        "無題のメモ".into()
    } else {
        escape_inline(note.title.trim())
    };
    let body = if note.markdown.trim().is_empty() {
        "_本文はありません。_".into()
    } else {
        rewrite_attachment_links(note.markdown.trim_end(), links)
    };
    format!("# {title}\n\n{body}\n")
}

fn markdown_target(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("保存先が指定されていません".into());
    }
    let mut target = PathBuf::from(path);
    if target.extension().is_none() {
        target.set_extension("md");
    }
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "保存先フォルダーが正しくありません".to_string())?;
    if !parent.is_dir() {
        return Err("保存先フォルダーが見つかりません".into());
    }
    Ok(target)
}

fn export_with_attachments<F>(
    path: &str,
    assets_stem: Option<&str>,
    markdowns: &[&str],
    db: &Database,
    paths: &AppPaths,
    render: F,
) -> Result<ExportResult, String>
where
    F: FnOnce(&HashMap<String, String>) -> Result<String, String>,
{
    let target = markdown_target(path)?;
    let target_stem = target
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .ok_or_else(|| "保存先ファイル名が正しくありません".to_string())?;
    let assets_name = format!("{}_assets", assets_stem.unwrap_or(target_stem));
    let assets_path = target
        .parent()
        .expect("markdown_target validates a parent")
        .join(&assets_name);
    let ids = markdowns
        .iter()
        .flat_map(|markdown| attachment_ids(markdown))
        .collect::<HashSet<_>>();

    let mut attachments = Vec::with_capacity(ids.len());
    let mut links = HashMap::new();
    for id in ids {
        let (_, stored_name) = db
            .attachment_record(&id)
            .map_err(|_| format!("添付ファイルの情報が見つかりません: {id}"))?;
        let source = paths.attachments.join(&stored_name);
        if !source.is_file() {
            return Err(format!("添付ファイルが見つかりません: {stored_name}"));
        }
        links.insert(id, format!("./{assets_name}/{stored_name}"));
        attachments.push((source, stored_name));
    }

    let markdown = render(&links)?;
    if !attachments.is_empty() {
        fs::create_dir_all(&assets_path)
            .map_err(|error| format!("添付フォルダーを作成できませんでした: {error}"))?;
        for (source, stored_name) in &attachments {
            fs::copy(source, assets_path.join(stored_name))
                .map_err(|error| format!("添付ファイルを保存できませんでした: {error}"))?;
        }
    }
    fs::write(&target, markdown)
        .map_err(|error| format!("Markdownを保存できませんでした: {error}"))?;

    Ok(ExportResult {
        markdown_path: target.display().to_string(),
        assets_directory: (!attachments.is_empty()).then(|| assets_path.display().to_string()),
        attachment_count: attachments.len(),
    })
}

pub fn export_day(
    date: &str,
    path: &str,
    db: &Database,
    paths: &AppPaths,
) -> Result<ExportResult, String> {
    let day = db.get_day(date)?;
    let date_label = japanese_date(date)?;
    let markdowns = day
        .notes
        .iter()
        .map(|note| note.markdown.as_str())
        .collect::<Vec<_>>();
    export_with_attachments(path, Some(&date_label), &markdowns, db, paths, |links| {
        render_markdown(&day, links)
    })
}

pub fn export_note(
    note_id: i64,
    path: &str,
    db: &Database,
    paths: &AppPaths,
) -> Result<ExportResult, String> {
    let note = db.get_note_card(note_id)?;
    export_with_attachments(path, None, &[&note.markdown], db, paths, |links| {
        Ok(render_note_markdown(&note, links))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Local;

    fn sample_day() -> DayData {
        DayData {
            id: 1,
            day_date: "2026-09-05".into(),
            is_closed: false,
            tasks: vec![
                Task {
                    id: 1,
                    title: "仕様 *確認*".into(),
                    is_completed: true,
                    sort_order: 0,
                    priority: None,
                    carried_over: false,
                    completed_at: None,
                },
                Task {
                    id: 2,
                    title: "残作業".into(),
                    is_completed: false,
                    sort_order: 1,
                    priority: None,
                    carried_over: true,
                    completed_at: None,
                },
            ],
            entries: vec![Entry {
                id: 1,
                entry_type: "仕事".into(),
                title: None,
                body: "原因を確認\n修正案を作成".into(),
                occurred_at: "2026-09-05T09:18:00+09:00".into(),
            }],
            notes: vec![NoteCard {
                id: 1,
                title: "設計メモ".into(),
                markdown: "**Markdown** を保持".into(),
                sort_order: 0,
            }],
            review: Review {
                good: "予定どおり完了".into(),
                bad: String::new(),
                carry_over: "確認 [続き]".into(),
            },
            ai_summary: None,
            national_holiday_name: Some("休日".into()),
            custom_holiday_name: None,
        }
    }

    #[test]
    fn formats_file_name_and_all_sections() {
        assert_eq!(japanese_date("2026-09-05").unwrap(), "2026年09月05日(土)");
        let markdown = render_markdown(&sample_day(), &HashMap::new()).unwrap();
        assert!(markdown.starts_with("# 2026年09月05日(土)\n"));
        assert!(markdown.contains("- [x] 仕様 \\*確認\\*"));
        assert!(markdown.contains("- [ ] 残作業（持ち越し）"));
        assert!(markdown.contains("- 09:18 `仕事` 原因を確認  \n修正案を作成"));
        assert!(markdown.contains("### 設計メモ\n**Markdown** を保持"));
        assert!(markdown.contains("### うまくいかなかったこと\n_記録なし_"));
        assert!(markdown.contains("確認 \\[続き\\]"));
        assert!(!markdown.contains("休日"));

        let mut titled = sample_day();
        titled.entries[0].title = Some("調査結果".into());
        let markdown = render_markdown(&titled, &HashMap::new()).unwrap();
        assert!(markdown.contains("- 09:18 `仕事` 調査結果  \n原因を確認"));
    }

    #[test]
    fn leaves_empty_sections_visible() {
        let mut day = sample_day();
        day.tasks.clear();
        day.entries.clear();
        day.notes.clear();
        day.review = Review::default();
        let markdown = render_markdown(&day, &HashMap::new()).unwrap();
        assert_eq!(markdown.matches(EMPTY).count(), 6);
    }

    #[test]
    fn formats_a_single_note_with_a_title_and_empty_body() {
        let note = NoteCard {
            id: 1,
            title: "設計 *確認*".into(),
            markdown: String::new(),
            sort_order: 0,
        };
        assert_eq!(
            render_note_markdown(&note, &HashMap::new()),
            "# 設計 \\*確認\\*\n\n_本文はありません。_\n"
        );

        let untitled = NoteCard {
            title: "  ".into(),
            ..note
        };
        assert!(render_note_markdown(&untitled, &HashMap::new()).starts_with("# 無題のメモ\n"));
    }

    #[test]
    fn copies_each_attachment_once_and_rewrites_links() {
        let root = std::env::temp_dir().join(format!(
            "daylog-export-test-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let attachments_path = root.join("data").join("attachments");
        fs::create_dir_all(&attachments_path).unwrap();
        let holidays = root.join("holidays.csv");
        let db = Database::open(&root.join("daylog.db"), holidays.clone()).unwrap();
        let paths = AppPaths {
            root: root.clone(),
            backups: root.join("backups"),
            attachments: attachments_path.clone(),
            holidays,
        };
        let id = uuid::Uuid::new_v4().to_string();
        let stored_name = format!("{id}.png");
        let attachment = Attachment {
            id: id.clone(),
            name: "同名画像.png".into(),
            mime_type: "image/png".into(),
            size_bytes: 8,
            is_image: true,
        };
        db.register_attachment(&attachment, &stored_name).unwrap();
        fs::write(attachments_path.join(&stored_name), b"png-data").unwrap();
        let mut note = db.create_note_card("2026-09-05").unwrap();
        note.markdown =
            format!("![画像](daylog-attachment:{id})\n[もう一度](daylog-attachment:{id})");
        db.update_note_card(&note).unwrap();

        let target_without_extension = root.join("export");
        let result = export_day(
            "2026-09-05",
            &target_without_extension.display().to_string(),
            &db,
            &paths,
        )
        .unwrap();
        assert_eq!(result.attachment_count, 1);
        assert!(result.markdown_path.ends_with("export.md"));
        let markdown = fs::read_to_string(root.join("export.md")).unwrap();
        let relative = format!("./2026年09月05日(土)_assets/{stored_name}");
        assert_eq!(markdown.matches(&relative).count(), 2);
        assert_eq!(
            fs::read(root.join("2026年09月05日(土)_assets").join(&stored_name)).unwrap(),
            b"png-data"
        );

        let note_target = root.join("card");
        let note_result =
            export_note(note.id, &note_target.display().to_string(), &db, &paths).unwrap();
        assert_eq!(note_result.attachment_count, 1);
        assert!(note_result.markdown_path.ends_with("card.md"));
        let note_markdown = fs::read_to_string(root.join("card.md")).unwrap();
        let note_relative = format!("./card_assets/{stored_name}");
        assert_eq!(note_markdown.matches(&note_relative).count(), 2);
        assert_eq!(
            fs::read(root.join("card_assets").join(&stored_name)).unwrap(),
            b"png-data"
        );

        drop(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_attachment_does_not_change_existing_markdown() {
        let root = std::env::temp_dir().join(format!(
            "daylog-export-missing-test-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let attachments_path = root.join("attachments");
        fs::create_dir_all(&attachments_path).unwrap();
        let holidays = root.join("holidays.csv");
        let db = Database::open(&root.join("daylog.db"), holidays.clone()).unwrap();
        let paths = AppPaths {
            root: root.clone(),
            backups: root.join("backups"),
            attachments: attachments_path,
            holidays,
        };
        let id = uuid::Uuid::new_v4().to_string();
        db.register_attachment(
            &Attachment {
                id: id.clone(),
                name: "missing.pdf".into(),
                mime_type: "application/pdf".into(),
                size_bytes: 10,
                is_image: false,
            },
            "missing.pdf",
        )
        .unwrap();
        let mut note = db.create_note_card("2026-09-05").unwrap();
        note.markdown = format!("[資料](daylog-attachment:{id})");
        db.update_note_card(&note).unwrap();
        let target = root.join("existing.md");
        fs::write(&target, "変更しない").unwrap();

        let error = export_note(note.id, &target.display().to_string(), &db, &paths).unwrap_err();
        assert!(error.contains("添付ファイルが見つかりません"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "変更しない");

        drop(db);
        let _ = fs::remove_dir_all(root);
    }
}
