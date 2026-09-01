use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{webview::WebviewWindowBuilder, Emitter, Manager, WebviewUrl};
use tiny_http::{Header, Response, Server, StatusCode};
use zip::ZipArchive;

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

fn extract_and_verify(source_path: &Path, target_root: &Path) -> Result<PackManifest, String> {
    if source_path.extension().and_then(|value| value.to_str()) != Some("animalclass") {
        return Err("请选择 .animalclass 离线课包。".into());
    }
    let source = File::open(source_path).map_err(|error| format!("课包无法打开：{error}"))?;
    let mut archive = ZipArchive::new(source).map_err(|error| format!("课包格式无效：{error}"))?;
    let manifest: PackManifest = {
        let mut item = archive
            .by_name("offline/manifest.json")
            .map_err(|_| "课包缺少 offline/manifest.json。".to_string())?;
        let mut value = String::new();
        item.read_to_string(&mut value)
            .map_err(|error| error.to_string())?;
        serde_json::from_str(&value).map_err(|error| format!("课包清单无效：{error}"))?
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let temporary = target_root.join(format!(".import-{stamp}"));
    fs::create_dir_all(&temporary).map_err(|error| error.to_string())?;
    let result = (|| -> Result<(), String> {
        for index in 0..archive.len() {
            let mut item = archive.by_index(index).map_err(|error| error.to_string())?;
            let relative = item
                .enclosed_name()
                .ok_or_else(|| "课包包含不安全路径。".to_string())?
                .to_path_buf();
            let output = temporary.join(relative);
            if item.is_dir() {
                fs::create_dir_all(&output).map_err(|error| error.to_string())?;
                continue;
            }
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut file = File::create(&output).map_err(|error| error.to_string())?;
            std::io::copy(&mut item, &mut file).map_err(|error| error.to_string())?;
            file.flush().map_err(|error| error.to_string())?;
        }
        for spec in &manifest.files {
            let relative = Path::new(&spec.path);
            if relative.is_absolute() || spec.path.split('/').any(|part| part == "..") {
                return Err("课包清单包含不安全路径。".into());
            }
            let path = temporary.join(relative);
            let metadata =
                fs::metadata(&path).map_err(|_| format!("课包缺少资源：{}", spec.path))?;
            if metadata.len() != spec.size {
                return Err(format!("课包资源大小不匹配：{}", spec.path));
            }
            if sha256_file(&path)? != spec.sha256 {
                return Err(format!("课包资源校验失败：{}", spec.path));
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }
    let target = target_root.join(safe_pack_directory(&manifest.pack_id));
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
    Ok(manifest)
}

#[tauri::command]
fn list_courses(app: tauri::AppHandle) -> Result<Vec<CourseSummary>, String> {
    list_course_values(&app)
}

#[tauri::command]
fn import_course(app: tauri::AppHandle, path: String) -> Result<CourseSummary, String> {
    let manifest = extract_and_verify(Path::new(&path), &courses_root(&app)?)?;
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
fn start_course(app: tauri::AppHandle, pack_id: String) -> Result<(), String> {
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
