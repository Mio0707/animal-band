use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{webview::WebviewWindowBuilder, Emitter, Manager, WebviewUrl};
use tiny_http::{Header, Response, Server, StatusCode};
use zip::ZipArchive;

const MAX_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 20_000;
const MAX_EXTRACTED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackManifest {
    pack_id: String,
    revision: String,
    preparation_id: String,
    song_id: String,
    title: String,
    entrypoint: String,
    file_count: u64,
    total_bytes: u64,
    files: Vec<PackFile>,
}

#[derive(Clone, Debug, Serialize)]
struct CourseSummary {
    pack_id: String,
    revision: String,
    preparation_id: String,
    song_id: String,
    title: String,
    file_count: u64,
    total_bytes: u64,
}

impl From<&PackManifest> for CourseSummary {
    fn from(value: &PackManifest) -> Self {
        Self {
            pack_id: value.pack_id.clone(),
            revision: value.revision.clone(),
            preparation_id: value.preparation_id.clone(),
            song_id: value.song_id.clone(),
            title: value.title.clone(),
            file_count: value.file_count,
            total_bytes: value.total_bytes,
        }
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut source = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn safe_pack_directory(pack_id: &str) -> String {
    pack_id
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '@') {
                value
            } else {
                '_'
            }
        })
        .collect()
}

fn courses_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("courses");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn read_manifest(path: &Path) -> Result<PackManifest, String> {
    let value = fs::read_to_string(path.join("offline/manifest.json"))
        .map_err(|_| "课包缺少 manifest.json。".to_string())?;
    serde_json::from_str(&value).map_err(|error| format!("课包清单无效：{error}"))
}

fn list_course_values(app: &tauri::AppHandle) -> Result<Vec<CourseSummary>, String> {
    let root = courses_root(app)?;
    let mut courses = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if !path.is_dir()
            || path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .starts_with('.')
        {
            continue;
        }
        if let Ok(manifest) = read_manifest(&path) {
            courses.push(CourseSummary::from(&manifest));
        }
    }
    courses.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(courses)
}

fn validate_relative_path(value: &str, is_directory: bool) -> Result<PathBuf, String> {
    let path = if is_directory {
        value.strip_suffix('/').unwrap_or(value)
    } else {
        value
    };
    let bytes = path.as_bytes();
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || Path::new(path).is_absolute()
        || (bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic())
    {
        return Err("课包包含不安全路径。".into());
    }

    let mut relative = PathBuf::new();
    for component in path.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err("课包包含不安全路径。".into());
        }
        if component.chars().any(|character| {
            character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        }) {
            return Err("课包路径包含 Windows 非法字符。".into());
        }
        if matches!(component.chars().last(), Some(' ' | '.')) {
            return Err("课包路径包含 Windows 非法文件名。".into());
        }
        if is_windows_reserved_name(component) {
            return Err("课包路径包含 Windows 保留文件名。".into());
        }
        relative.push(component);
    }
    Ok(relative)
}

fn is_windows_reserved_name(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or(component);
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.as_bytes()[3].is_ascii_digit()
            && upper.as_bytes()[3] != b'0')
}

fn path_key(value: &str, is_directory: bool) -> String {
    if is_directory {
        value.strip_suffix('/').unwrap_or(value).to_lowercase()
    } else {
        value.to_lowercase()
    }
}

fn is_valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|character| character.is_ascii_hexdigit())
}

fn unique_path(target_root: &Path, prefix: &str) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(target_root.join(format!(
        ".{prefix}-{}-{stamp}-{sequence}",
        std::process::id()
    )))
}

fn create_unique_directory(target_root: &Path, prefix: &str) -> Result<PathBuf, String> {
    for _ in 0..1024 {
        let path = unique_path(target_root, prefix)?;
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("无法创建唯一的课包临时目录。".into())
}

fn remove_path(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())
    } else {
        Ok(())
    }
}

fn extract_and_verify(source_path: &Path, target_root: &Path) -> Result<PackManifest, String> {
    if !source_path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("animalclass"))
    {
        return Err("请选择 .animalclass 离线课包。".into());
    }
    let source = File::open(source_path).map_err(|error| format!("课包无法打开：{error}"))?;
    let mut archive = ZipArchive::new(source).map_err(|error| format!("课包格式无效：{error}"))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(format!("课包条目过多，最多支持 {MAX_ZIP_ENTRIES} 个条目。"));
    }

    let manifest: PackManifest = {
        let item = archive
            .by_name("offline/manifest.json")
            .map_err(|_| "课包缺少 offline/manifest.json。".to_string())?;
        if item.size() > MAX_MANIFEST_BYTES {
            return Err("课包 manifest.json 超过 4MB 限制。".into());
        }
        let mut value = Vec::new();
        item.take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut value)
            .map_err(|error| error.to_string())?;
        if value.len() as u64 > MAX_MANIFEST_BYTES {
            return Err("课包 manifest.json 超过 4MB 限制。".into());
        }
        let value = String::from_utf8(value).map_err(|error| format!("课包清单无效：{error}"))?;
        serde_json::from_str(&value).map_err(|error| format!("课包清单无效：{error}"))?
    };

    if manifest.file_count != manifest.files.len() as u64 {
        return Err("课包清单中的 fileCount 与 files 数量不一致。".into());
    }
    let mut manifest_total_bytes = 0_u64;
    let mut manifest_paths = HashSet::with_capacity(manifest.files.len());
    for spec in &manifest.files {
        validate_relative_path(&spec.path, false)?;
        if !manifest_paths.insert(path_key(&spec.path, false)) {
            return Err(format!("课包清单包含重复路径：{}", spec.path));
        }
        if !is_valid_sha256(&spec.sha256) {
            return Err(format!("课包资源 SHA-256 无效：{}", spec.path));
        }
        manifest_total_bytes = manifest_total_bytes
            .checked_add(spec.size)
            .ok_or_else(|| "课包资源总大小超出限制。".to_string())?;
    }
    if manifest_total_bytes != manifest.total_bytes {
        return Err("课包清单中的 totalBytes 与资源大小总和不一致。".into());
    }
    if manifest_total_bytes > MAX_EXTRACTED_BYTES {
        return Err("课包解压后超过 4GB 限制。".into());
    }

    let mut archive_paths = HashSet::with_capacity(archive.len());
    let mut archive_total_bytes = 0_u64;
    for index in 0..archive.len() {
        let item = archive.by_index(index).map_err(|error| error.to_string())?;
        validate_relative_path(item.name(), item.is_dir())?;
        if !archive_paths.insert(path_key(item.name(), item.is_dir())) {
            return Err(format!("课包包含重复路径：{}", item.name()));
        }
        archive_total_bytes = archive_total_bytes
            .checked_add(item.size())
            .ok_or_else(|| "课包解压后超过 4GB 限制。".to_string())?;
        if archive_total_bytes > MAX_EXTRACTED_BYTES {
            return Err("课包解压后超过 4GB 限制。".into());
        }
    }
    for spec in &manifest.files {
        if !archive_paths.contains(&path_key(&spec.path, false)) {
            return Err(format!("课包缺少资源：{}", spec.path));
        }
    }

    let temporary = create_unique_directory(target_root, "import")?;
    let result = (|| -> Result<(), String> {
        let mut extracted_bytes = 0_u64;
        for index in 0..archive.len() {
            let mut item = archive.by_index(index).map_err(|error| error.to_string())?;
            let relative = validate_relative_path(item.name(), item.is_dir())?;
            let output = temporary.join(relative);
            if item.is_dir() {
                fs::create_dir_all(&output).map_err(|error| error.to_string())?;
                continue;
            }
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut file = File::create(&output).map_err(|error| error.to_string())?;
            let written = io::copy(&mut item, &mut file).map_err(|error| error.to_string())?;
            extracted_bytes = extracted_bytes
                .checked_add(written)
                .ok_or_else(|| "课包解压后超过 4GB 限制。".to_string())?;
            if extracted_bytes > MAX_EXTRACTED_BYTES {
                return Err("课包解压后超过 4GB 限制。".into());
            }
            if written != item.size() {
                return Err(format!("课包资源解压大小不匹配：{}", item.name()));
            }
            file.flush().map_err(|error| error.to_string())?;
        }
        for spec in &manifest.files {
            let relative = validate_relative_path(&spec.path, false)?;
            let path = temporary.join(relative);
            let metadata =
                fs::metadata(&path).map_err(|_| format!("课包缺少资源：{}", spec.path))?;
            if !metadata.is_file() || metadata.len() != spec.size {
                return Err(format!("课包资源大小不匹配：{}", spec.path));
            }
            if !sha256_file(&path)?.eq_ignore_ascii_case(&spec.sha256) {
                return Err(format!("课包资源校验失败：{}", spec.path));
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = remove_path(&temporary);
        return Err(error);
    }

    let directory_name = safe_pack_directory(&manifest.pack_id);
    if directory_name.is_empty() {
        let _ = remove_path(&temporary);
        return Err("课包 packId 无效。".into());
    }
    let target = target_root.join(directory_name);
    let backup = if target.exists() {
        match unique_path(target_root, "replace") {
            Ok(path) => Some(path),
            Err(error) => {
                let _ = remove_path(&temporary);
                return Err(error);
            }
        }
    } else {
        None
    };
    if let Some(backup) = &backup {
        if let Err(error) = fs::rename(&target, backup) {
            let _ = remove_path(&temporary);
            return Err(format!("旧课包无法暂存：{error}"));
        }
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        let restore = backup.as_ref().map(|path| {
            fs::rename(path, &target).map_err(|restore_error| restore_error.to_string())
        });
        let _ = remove_path(&temporary);
        return match restore {
            Some(Ok(())) => Err(format!("新课包无法保存：{error}")),
            Some(Err(restore_error)) => Err(format!(
                "新课包无法保存：{error}；旧课包恢复失败：{restore_error}"
            )),
            None => Err(format!("新课包无法保存：{error}")),
        };
    }
    if let Some(backup) = backup {
        if let Err(error) = remove_path(&backup) {
            return Err(format!("课包已保存，但旧课包备份清理失败：{error}"));
        }
    }
    Ok(manifest)
}

#[tauri::command]
fn list_courses(app: tauri::AppHandle) -> Result<Vec<CourseSummary>, String> {
    list_course_values(&app)
}

#[tauri::command]
async fn import_course(app: tauri::AppHandle, path: String) -> Result<CourseSummary, String> {
    let target_root = courses_root(&app)?;
    let source_path = PathBuf::from(path);
    let manifest = tauri::async_runtime::spawn_blocking(move || {
        extract_and_verify(&source_path, &target_root)
    })
    .await
    .map_err(|error| format!("课包导入任务失败：{error}"))??;
    Ok(CourseSummary::from(&manifest))
}

#[tauri::command]
fn delete_course(app: tauri::AppHandle, pack_id: String) -> Result<(), String> {
    let target = courses_root(&app)?.join(safe_pack_directory(&pack_id));
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn initial_course_file() -> Option<String> {
    std::env::args().find(|value| value.to_lowercase().ends_with(".animalclass"))
}

fn range_bounds(value: Option<&str>, size: usize) -> Option<(usize, usize)> {
    let raw = value?.strip_prefix("bytes=")?;
    if raw.contains(',') {
        return None;
    }
    let (first, last) = raw.split_once('-')?;
    if first.is_empty() {
        let suffix = last.parse::<usize>().ok()?.min(size);
        return (suffix > 0).then_some((size - suffix, size.saturating_sub(1)));
    }
    let start = first.parse::<usize>().ok()?;
    let end = if last.is_empty() {
        size.saturating_sub(1)
    } else {
        last.parse::<usize>().ok()?.min(size.saturating_sub(1))
    };
    (start < size && end >= start).then_some((start, end))
}

fn serve_course(root: PathBuf, listener: TcpListener) -> Result<(), String> {
    let server = Server::from_listener(listener, None).map_err(|error| error.to_string())?;
    for request in server.incoming_requests() {
        let raw_path = request.url().split('?').next().unwrap_or("/");
        let decoded = percent_decode_str(raw_path).decode_utf8_lossy();
        let relative = decoded.trim_start_matches('/');
        let relative = if relative.is_empty() || relative.ends_with('/') {
            format!("{relative}index.html")
        } else {
            relative.to_string()
        };
        if relative.split('/').any(|part| part == "..") {
            let _ = request.respond(Response::empty(StatusCode(400)));
            continue;
        }
        let path = root.join(&relative);
        let bytes = match fs::read(&path) {
            Ok(value) => value,
            Err(_) => {
                let _ = request.respond(Response::empty(StatusCode(404)));
                continue;
            }
        };
        let range_value = request
            .headers()
            .iter()
            .find(|header| header.field.equiv("Range"))
            .map(|header| header.value.as_str());
        let bounds = range_bounds(range_value, bytes.len());
        let (status, body, content_range) = if let Some((start, end)) = bounds {
            (
                StatusCode(206),
                bytes[start..=end].to_vec(),
                Some(format!("bytes {start}-{end}/{}", bytes.len())),
            )
        } else {
            (StatusCode(200), bytes, None)
        };
        let mut response = Response::from_data(body).with_status_code(status);
        let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string();
        response.add_header(Header::from_bytes("Content-Type", mime).unwrap());
        response.add_header(Header::from_bytes("Accept-Ranges", "bytes").unwrap());
        response.add_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
        if let Some(value) = content_range {
            response.add_header(Header::from_bytes("Content-Range", value).unwrap());
        }
        let _ = request.respond(response);
    }
    Ok(())
}

#[tauri::command]
async fn start_course(app: tauri::AppHandle, pack_id: String) -> Result<(), String> {
    let root = courses_root(&app)?.join(safe_pack_directory(&pack_id));
    let manifest = read_manifest(&root)?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    thread::spawn(move || {
        let _ = serve_course(root, listener);
    });
    let url = tauri::Url::parse(&format!("http://127.0.0.1:{port}/{}", manifest.entrypoint))
        .map_err(|error| error.to_string())?;
    let label = format!("classroom-{}", manifest.revision);
    if let Some(window) = app.get_webview_window(&label) {
        window.navigate(url).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title(format!("《{}》 · 动物乐队课堂", manifest.title))
        .inner_size(1280.0, 820.0)
        .min_inner_size(900.0, 640.0)
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = argv
                .into_iter()
                .find(|value| value.to_lowercase().ends_with(".animalclass"))
            {
                let _ = app.emit("course-file-opened", path);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![
            list_courses,
            import_course,
            delete_course,
            initial_course_file,
            start_course
        ])
        .run(tauri::generate_context!())
        .expect("动物乐队课堂启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    fn test_root(name: &str) -> PathBuf {
        let root = unique_path(&std::env::temp_dir(), name).expect("test temp path");
        fs::create_dir_all(&root).expect("test temp directory");
        root
    }

    fn sha256_bytes(value: &[u8]) -> String {
        let mut digest = Sha256::new();
        digest.update(value);
        hex::encode(digest.finalize())
    }

    fn write_pack(
        path: &Path,
        pack_id: &str,
        entries: &[(&str, &[u8])],
        sha256: Option<&str>,
        file_count: Option<u64>,
        total_bytes: Option<u64>,
    ) {
        let files: Vec<_> = entries
            .iter()
            .map(|(entry_path, bytes)| {
                json!({
                    "path": entry_path,
                    "size": bytes.len(),
                    "sha256": sha256.map(str::to_owned).unwrap_or_else(|| sha256_bytes(bytes)),
                })
            })
            .collect();
        let total = entries
            .iter()
            .map(|(_, bytes)| bytes.len() as u64)
            .sum::<u64>();
        let manifest = json!({
            "packId": pack_id,
            "revision": "revision-1",
            "preparationId": "preparation-1",
            "songId": "song-1",
            "title": "测试课程",
            "entrypoint": "app/classroom/index.html",
            "fileCount": file_count.unwrap_or(entries.len() as u64),
            "totalBytes": total_bytes.unwrap_or(total),
            "files": files,
        });
        let file = File::create(path).expect("test pack file");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (entry_path, bytes) in entries {
            writer
                .start_file(*entry_path, options)
                .expect("test zip entry");
            writer.write_all(bytes).expect("test zip contents");
        }
        writer
            .start_file("offline/manifest.json", options)
            .expect("test manifest entry");
        writer
            .write_all(manifest.to_string().as_bytes())
            .expect("test manifest contents");
        let output = writer.finish().expect("test zip finish");
        drop(output);
    }

    #[test]
    fn imports_lowercase_and_uppercase_extensions() {
        let root = test_root("import-extension");
        let lower = root.join("course.animalclass");
        let upper = root.join("course.ANIMALCLASS");
        write_pack(
            &lower,
            "pack-extension",
            &[("offline/data.txt", b"hello")],
            None,
            None,
            None,
        );
        write_pack(
            &upper,
            "pack-extension",
            &[("offline/data.txt", b"hello")],
            None,
            None,
            None,
        );

        let courses = root.join("courses");
        fs::create_dir_all(&courses).expect("course root");
        assert_eq!(
            extract_and_verify(&lower, &courses)
                .expect("lowercase import")
                .pack_id,
            "pack-extension"
        );
        assert_eq!(
            extract_and_verify(&upper, &courses)
                .expect("uppercase import")
                .pack_id,
            "pack-extension"
        );
        assert!(courses.join("pack-extension/offline/data.txt").is_file());
        assert!(!fs::read_dir(&courses).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".replace-")
        }));
        let _ = remove_path(&root);
    }

    #[test]
    fn rejects_bad_sha256_without_leaving_import_directory() {
        let root = test_root("import-sha");
        let pack = root.join("bad.animalclass");
        write_pack(
            &pack,
            "pack-sha",
            &[("offline/data.txt", b"hello")],
            Some(&"0".repeat(64)),
            None,
            None,
        );
        let courses = root.join("courses");
        fs::create_dir_all(&courses).expect("course root");
        let error = extract_and_verify(&pack, &courses).expect_err("bad sha must fail");
        assert!(error.contains("校验失败"));
        assert!(!fs::read_dir(&courses).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".import-")
        }));
        let _ = remove_path(&root);
    }

    #[test]
    fn rejects_windows_reserved_traversal_and_backslash_paths() {
        for (name, entry_path) in [
            ("reserved", "offline/CON.txt"),
            ("traversal", "offline/../data.txt"),
            ("backslash", "offline\\data.txt"),
        ] {
            let root = test_root(name);
            let pack = root.join("unsafe.animalclass");
            write_pack(
                &pack,
                "pack-unsafe",
                &[(entry_path, b"hello")],
                None,
                None,
                None,
            );
            let courses = root.join("courses");
            fs::create_dir_all(&courses).expect("course root");
            assert!(
                extract_and_verify(&pack, &courses).is_err(),
                "{name} must fail"
            );
            let _ = remove_path(&root);
        }
    }

    #[test]
    fn failed_verification_removes_import_directory() {
        let root = test_root("import-cleanup");
        let pack = root.join("wrong-size.animalclass");
        write_pack(
            &pack,
            "pack-cleanup",
            &[("offline/data.txt", b"hello")],
            None,
            None,
            Some(6),
        );
        let courses = root.join("courses");
        fs::create_dir_all(&courses).expect("course root");
        assert!(extract_and_verify(&pack, &courses).is_err());
        assert!(!fs::read_dir(&courses).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".import-")
        }));
        let _ = remove_path(&root);
    }

    #[test]
    fn rejects_manifest_count_and_total_mismatches() {
        let root = test_root("manifest-counts");
        let courses = root.join("courses");
        fs::create_dir_all(&courses).expect("course root");
        let count_pack = root.join("count.animalclass");
        write_pack(
            &count_pack,
            "pack-count",
            &[("offline/data.txt", b"hello")],
            None,
            Some(2),
            None,
        );
        assert!(extract_and_verify(&count_pack, &courses)
            .expect_err("count mismatch must fail")
            .contains("fileCount"));

        let total_pack = root.join("total.animalclass");
        write_pack(
            &total_pack,
            "pack-total",
            &[("offline/data.txt", b"hello")],
            None,
            None,
            Some(6),
        );
        assert!(extract_and_verify(&total_pack, &courses)
            .expect_err("total mismatch must fail")
            .contains("totalBytes"));
        let _ = remove_path(&root);
    }
}
